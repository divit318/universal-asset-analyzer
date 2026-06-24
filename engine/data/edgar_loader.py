"""
EDGAR revenue loader for US stocks (fix 4.2).

Fetches TTM revenue from SEC XBRL API (data.sec.gov) — more reliable than
the `ebitda / operating_margin` proxy used in monte_carlo.py for US names.

Endpoint: https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json
Concept:  us-gaap/Revenues or us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax

TTM = sum of last 4 quarterly (10-Q) filings, or the most recent annual (10-K).

CIK lookup: https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&...
  or faster: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK={ticker}&type=10-K&dateb=&owner=include&count=1&search_text=

Cache: 7-day disk cache in data/edgar_cache/ to avoid rate-limit (10 req/s SEC limit).
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta
from pathlib import Path

logger = logging.getLogger(__name__)

_CACHE_DIR = Path(__file__).parent.parent.parent / "data" / "edgar_cache"
_CACHE_TTL_DAYS = 7

_SEC_HEADERS = {
    "User-Agent": "UAA-Engine contact@example.com",  # SEC requires User-Agent with email
    "Accept":     "application/json",
}

# XBRL revenue concept hierarchy (try in order)
_REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
    "SalesRevenueGoodsNet",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
]


def _cache_path(ticker: str) -> Path:
    return _CACHE_DIR / f"{ticker.upper()}_revenue.json"


def _read_cache(ticker: str) -> dict | None:
    p = _cache_path(ticker)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        cached_at = datetime.fromisoformat(data.get("_cached_at", "2000-01-01"))
        if (datetime.utcnow() - cached_at).days < _CACHE_TTL_DAYS:
            return data
    except Exception:
        pass
    return None


def _write_cache(ticker: str, data: dict) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    data["_cached_at"] = datetime.utcnow().isoformat()
    try:
        _cache_path(ticker).write_text(json.dumps(data))
    except Exception:
        pass


def _get_cik(ticker: str) -> str | None:
    """
    Look up CIK for a ticker via SEC company search.
    Returns zero-padded 10-digit CIK string, or None on failure.
    """
    import requests
    url = f"https://efts.sec.gov/LATEST/search-index?q=%22{ticker}%22&dateRange=custom&startdt=2000-01-01&enddt=2025-12-31&forms=10-K"
    try:
        # Use the ticker→CIK mapping endpoint (more reliable)
        mapping_url = "https://www.sec.gov/files/company_tickers.json"
        r = requests.get(mapping_url, headers=_SEC_HEADERS, timeout=15)
        r.raise_for_status()
        data = r.json()
        ticker_upper = ticker.upper().replace("-", ".")  # BRK-B → BRK.B for SEC
        for _, entry in data.items():
            if entry.get("ticker", "").upper() in (ticker.upper(), ticker_upper):
                cik = str(entry["cik_str"]).zfill(10)
                return cik
        return None
    except Exception as e:
        logger.debug("CIK lookup failed for %s: %s", ticker, e)
        return None


def _fetch_revenue_from_facts(cik: str) -> float | None:
    """
    Fetch TTM revenue from EDGAR companyfacts JSON.
    Returns revenue in USD (not scaled), or None on failure.
    """
    import requests
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    try:
        r = requests.get(url, headers=_SEC_HEADERS, timeout=20)
        r.raise_for_status()
        facts = r.json()
        time.sleep(0.12)  # stay under 10 req/s SEC limit
    except Exception as e:
        logger.debug("EDGAR facts fetch failed for CIK %s: %s", cik, e)
        return None

    us_gaap = facts.get("facts", {}).get("us-gaap", {})

    for concept in _REVENUE_CONCEPTS:
        if concept not in us_gaap:
            continue
        units = us_gaap[concept].get("units", {})
        usd_entries = units.get("USD", [])
        if not usd_entries:
            continue

        # Filter for annual (10-K) or quarterly (10-Q) entries
        annual = [e for e in usd_entries if e.get("form") == "10-K" and e.get("val") is not None]
        quarterly = [e for e in usd_entries if e.get("form") == "10-Q" and e.get("val") is not None]

        # Try TTM from last 4 quarters.
        # Companies (e.g. NVDA) file both single-quarter AND cumulative YTD entries under the
        # same accession number. Filter to single-quarter entries (75–105 day period) before
        # summing. Accn-based dedup is NOT sufficient — same accn can carry both kinds.
        if len(quarterly) >= 4:
            from datetime import date as _date
            single_q = []
            for e in quarterly:
                start_s = e.get("start", "")
                end_s   = e.get("end", "")
                if start_s and end_s:
                    try:
                        period_days = (_date.fromisoformat(end_s) - _date.fromisoformat(start_s)).days
                        if 75 <= period_days <= 105:
                            single_q.append(e)
                    except ValueError:
                        pass

            # Sort by end date descending, dedup by (end, start) to remove identical rows
            single_q.sort(key=lambda x: x.get("end", ""), reverse=True)
            seen = set()
            deduped = []
            for e in single_q:
                key = (e.get("end", ""), e.get("start", ""))
                if key not in seen:
                    seen.add(key)
                    deduped.append(e)

            # Take last 4 unique single quarters
            if len(deduped) >= 4:
                ttm = sum(float(e["val"]) for e in deduped[:4])
                return ttm

        # Fallback: most recent annual — only if recent (within 18 months).
        # If the annual is stale, continue to try the next concept rather than
        # returning an outdated value (e.g. NVDA's FY2022 $26.9B vs actual ~$130B+).
        if annual:
            from datetime import date as _date
            annual.sort(key=lambda x: x.get("end", ""), reverse=True)
            try:
                annual_age_days = (_date.today() - _date.fromisoformat(annual[0]["end"])).days
            except ValueError:
                annual_age_days = 9999
            if annual_age_days <= 548:  # ~18 months
                return float(annual[0]["val"])
            # Annual is stale — try next concept

    return None


def get_edgar_revenue(ticker: str) -> float | None:
    """
    Get TTM revenue for a US stock from EDGAR XBRL API.
    Returns revenue in USD, or None if unavailable.
    Uses 7-day disk cache.

    Only relevant for US stocks (no .NS suffix). Callers should guard:
        if not symbol.endswith('.NS'):
            rev = get_edgar_revenue(symbol)
    """
    if ticker.endswith(".NS") or ticker.endswith(".BO"):
        return None

    cached = _read_cache(ticker)
    if cached and "revenue" in cached:
        return cached["revenue"]

    cik = _get_cik(ticker)
    if not cik:
        logger.debug("No CIK found for %s", ticker)
        _write_cache(ticker, {"revenue": None})
        return None

    rev = _fetch_revenue_from_facts(cik)
    _write_cache(ticker, {"revenue": rev, "cik": cik})

    if rev is not None:
        logger.info("[EDGAR] %s: TTM revenue = $%.1fM", ticker, rev / 1e6)
    return rev
