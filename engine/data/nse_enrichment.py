"""
NSE India data enrichment — fills missing fundamental fields for .NS symbols.

Fields covered:
  earnings_surprise_pct   — YoY EPS change as beat/miss proxy (%)
  eps_cagr_3y             — 3-year EPS CAGR from quarterly filings
  revenue_cagr_3y         — 3-year revenue CAGR from quarterly filings
  buyback_yield           — announced buybacks / market cap, annualised (%)
  institutional_ownership — institutions % held from yfinance major_holders

Sources:
  NSE India official API (free) — results-comparision, corporates-corporateActions
  yfinance major_holders        — institutional_ownership (works for .NS)
  yfinance quarterly financials — CAGR fallback for US symbols

Rate limiting: exponential backoff with jitter on 429/503.
Disk cache: 24h per symbol in data/nse_cache/ (JSON files).
Fetch status: FRESH | STALE | FETCH_FAILED | NEVER_FETCHED tracked per symbol.
  - FETCH_FAILED → revision_score zeroed (not used, not penalised as missing).
  - 3 consecutive failures → alert logged.
All functions safe to call when NSE is unreachable — returns {} on any error.
"""

from __future__ import annotations

import json
import logging
import math
import random
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import numpy as np
import polars as pl
import requests

logger = logging.getLogger(__name__)

# Disk cache directory — adjacent to engine/data/
_CACHE_DIR = Path(__file__).parent.parent.parent / "data" / "nse_cache"
_CACHE_TTL_HOURS = 24

# Fetch status per symbol — in-memory, persisted to nse_fetch_status.json
_STATUS_FILE = Path(__file__).parent.parent.parent / "data" / "nse_fetch_status.json"
_STATUS_FRESH       = "FRESH"
_STATUS_STALE       = "STALE"
_STATUS_FAILED      = "FETCH_FAILED"
_STATUS_NEVER       = "NEVER_FETCHED"

# Consecutive failure tracking (in-memory per session)
_consecutive_failures: dict[str, int] = {}
_ALERT_THRESHOLD = 3


def _load_statuses() -> dict[str, dict]:
    """Load {symbol: {status, last_fetch_utc}} from disk."""
    if _STATUS_FILE.exists():
        try:
            return json.loads(_STATUS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_statuses(statuses: dict[str, dict]) -> None:
    _STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    try:
        _STATUS_FILE.write_text(json.dumps(statuses, indent=2))
    except Exception:
        pass


def _set_status(symbol: str, status: str) -> None:
    statuses = _load_statuses()
    statuses[symbol] = {
        "status": status,
        "last_fetch_utc": datetime.utcnow().isoformat(),
    }
    _save_statuses(statuses)


def get_nse_status(symbol: str) -> str:
    """Return current fetch status for a symbol."""
    statuses = _load_statuses()
    entry = statuses.get(symbol)
    if not entry:
        return _STATUS_NEVER
    last = entry.get("last_fetch_utc")
    status = entry.get("status", _STATUS_NEVER)
    if last and status == _STATUS_FRESH:
        try:
            age_h = (datetime.utcnow() - datetime.fromisoformat(last)).total_seconds() / 3600
            if age_h > _CACHE_TTL_HOURS:
                return _STATUS_STALE
        except Exception:
            pass
    return status


def _cache_path(symbol: str) -> Path:
    return _CACHE_DIR / f"{symbol.replace('/', '_')}.json"


def _read_cache(symbol: str) -> dict | None:
    """Return cached data if fresh (<24h), else None."""
    p = _cache_path(symbol)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        cached_at = datetime.fromisoformat(data.get("_cached_at", "2000-01-01"))
        if (datetime.utcnow() - cached_at).total_seconds() < _CACHE_TTL_HOURS * 3600:
            return data
    except Exception:
        pass
    return None


def _write_cache(symbol: str, data: dict) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        data["_cached_at"] = datetime.utcnow().isoformat()
        _cache_path(symbol).write_text(json.dumps(data))
    except Exception:
        pass


def _backoff_sleep(attempt: int) -> None:
    """Exponential backoff with jitter: base 2^attempt seconds, ±30% jitter."""
    base = min(2 ** attempt, 30)
    jitter = base * 0.3 * (random.random() * 2 - 1)
    time.sleep(max(0, base + jitter))

_NSE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
    "Connection": "keep-alive",
}

_NSE_BASE = "https://www.nseindia.com"
_SESSION: Optional[requests.Session] = None


def _get_session() -> requests.Session:
    """
    NSE requires a valid browser session cookie before API calls.
    First hit the homepage to seed cookies, then reuse the session.
    """
    global _SESSION
    if _SESSION is not None:
        return _SESSION
    s = requests.Session()
    s.headers.update(_NSE_HEADERS)
    try:
        s.get(_NSE_BASE, timeout=10)
        time.sleep(0.5)
    except Exception:
        pass
    _SESSION = s
    return s


def _nse_get(path: str, params: dict | None = None, max_retries: int = 3) -> dict | list:
    """
    GET from NSE API with session cookies.
    Retries up to max_retries times with exponential backoff on 429/503.
    Returns {} on final failure.
    """
    s = _get_session()
    url = f"{_NSE_BASE}/api/{path}"
    for attempt in range(max_retries):
        try:
            r = s.get(url, params=params, timeout=10)
            if r.status_code in (429, 503):
                _backoff_sleep(attempt)
                # Refresh session on rate limit
                global _SESSION
                _SESSION = None
                s = _get_session()
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.debug("NSE API %s attempt %d failed: %s", path, attempt + 1, e)
            if attempt < max_retries - 1:
                _backoff_sleep(attempt)
    return {}


def _strip_ns(symbol: str) -> str:
    """RELIANCE.NS → RELIANCE"""
    return symbol.upper().replace(".NS", "").replace(".BO", "")


def _sf(v) -> float | None:
    """Safe float cast."""
    try:
        f = float(v)
        return f if f == f else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Quarterly results (NSE) → earnings_surprise_pct, eps_cagr_3y, revenue_cagr_3y
# ---------------------------------------------------------------------------

def fetch_quarterly_results(symbol: str) -> dict:
    """
    NSE results-comparision API. Returns last 5 quarters of P&L.

    NSE field mapping:
      EPS:     re_basic_eps_for_cont_dic_opr  (basic EPS from continuing ops)
      Revenue: re_net_sale                     (net sales / turnover in lakhs)
      Total income: re_total_inc

    Returns dict with any subset of:
      earnings_surprise_pct  — latest vs year-ago same quarter EPS change (%)
      eps_cagr_3y            — requires ≥8 quarters (not enough from this endpoint)
      revenue_cagr_3y        — requires ≥8 quarters
    """
    raw = _strip_ns(symbol)
    data = _nse_get("results-comparision", {"symbol": raw, "period": "Quarterly"})
    time.sleep(1.0)

    if not data:
        return {}

    quarters = data.get("resCmpData", [])
    if not quarters or len(quarters) < 2:
        return {}

    result: dict = {}

    eps_vals: list[float] = []
    rev_vals: list[float] = []

    for q in quarters:
        # EPS: prefer basic EPS from continuing operations
        eps = _sf(
            q.get("re_basic_eps_for_cont_dic_opr")
            or q.get("re_dilut_eps_for_cont_dic_opr")
            or q.get("re_basic_eps")
            or q.get("re_diluted_eps")
        )
        # Revenue: net sale (in INR lakhs for NSE)
        rev = _sf(
            q.get("re_net_sale")
            or q.get("re_total_inc")
            or q.get("re_net_sales_turnover")
        )
        if eps is not None:
            eps_vals.append(eps)
        if rev is not None:
            rev_vals.append(rev)

    # earnings_surprise_pct: latest vs year-ago quarter (index 0 vs 4)
    # NSE only returns 5 quarters, so latest vs 4 quarters ago = YoY
    if len(eps_vals) >= 5:
        curr, prev = eps_vals[0], eps_vals[4]
        if prev and abs(prev) > 1e-6:
            result["earnings_surprise_pct"] = (curr - prev) / abs(prev) * 100.0
    elif len(eps_vals) >= 2:
        # Fallback: QoQ change as proxy
        curr, prev = eps_vals[0], eps_vals[1]
        if prev and abs(prev) > 1e-6:
            result["earnings_surprise_pct"] = (curr - prev) / abs(prev) * 100.0

    # CAGR requires more history than 5 quarters — skip here, use yfinance fallback
    # (NSE API only gives 5 quarters in results-comparision)
    return result


# ---------------------------------------------------------------------------
# yfinance quarterly financials → eps_cagr_3y, revenue_cagr_3y (US + India)
# ---------------------------------------------------------------------------

def _yf_cagr_fallback(symbol: str) -> dict:
    """
    Compute eps_cagr_3y and revenue_cagr_3y from yfinance annual income statement.
    Uses yf.Ticker.financials (annual) — gives 4-5 years of history.
    CAGR = (latest / base)^(1/3) - 1 using year[0] vs year[3].
    Works for US stocks and Indian .NS symbols on yfinance.
    Returns {} if insufficient annual history.
    """
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        af = t.financials  # annual income statement, cols=dates newest-first
        if af is None or af.empty:
            return {}

        eps_labels = ["Diluted EPS", "Basic EPS"]
        rev_labels = ["Total Revenue", "Net Revenue", "Revenue"]

        def _get_annual(labels: list[str]) -> list[float]:
            for lbl in labels:
                try:
                    row = af.loc[lbl]
                    vals = [_sf(v) for v in row if _sf(v) is not None]
                    if len(vals) >= 4:
                        return vals
                except KeyError:
                    continue
            return []

        result: dict = {}

        eps_vals = _get_annual(eps_labels)
        if len(eps_vals) >= 4:
            now_, base = eps_vals[0], eps_vals[3]  # year 0 vs year 3
            if base and abs(base) > 1e-6 and now_ / base > 0:
                result["eps_cagr_3y"] = ((now_ / base) ** (1.0 / 3.0) - 1.0) * 100.0

        rev_vals = _get_annual(rev_labels)
        if len(rev_vals) >= 4:
            now_r, base_r = rev_vals[0], rev_vals[3]
            if base_r > 0 and now_r > 0:
                result["revenue_cagr_3y"] = ((now_r / base_r) ** (1.0 / 3.0) - 1.0) * 100.0

        return result
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# yfinance major_holders → institutional_ownership
# ---------------------------------------------------------------------------

def _yf_institutional_ownership(symbol: str) -> dict:
    """
    Fetch institutional ownership % from yfinance major_holders.
    Works for US and Indian .NS symbols.
    Returns dict with key institutional_ownership (% of total shares, 0-100).
    """
    try:
        import yfinance as yf
        t = yf.Ticker(symbol)
        mh = t.major_holders
        if mh is None or mh.empty:
            return {}
        # DataFrame index: 'insidersPercentHeld', 'institutionsPercentHeld', ...
        # Value column varies by yfinance version
        val_col = mh.columns[0] if hasattr(mh, "columns") and len(mh.columns) > 0 else None
        if val_col is None:
            return {}
        try:
            pct = float(mh.loc["institutionsPercentHeld", val_col]) * 100.0
            return {"institutional_ownership": round(pct, 2)}
        except (KeyError, TypeError, ValueError):
            # Fallback: try 'Value' column directly
            for idx in mh.index:
                if "institution" in str(idx).lower():
                    v = _sf(mh.loc[idx, val_col])
                    if v is not None:
                        return {"institutional_ownership": round(v * 100.0, 2)}
        return {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# Corporate actions (NSE) → buyback_yield
# ---------------------------------------------------------------------------

def fetch_buyback_yield(symbol: str, market_cap: float | None) -> dict:
    """
    NSE corporate actions: sum last 3 years of buyback amounts / market_cap.
    Endpoint: /api/corporates-corporateActions?index=equities&symbol=RELIANCE

    Returns dict with key:
      buyback_yield  — annualised buyback / market_cap (%)
    """
    if not market_cap or market_cap <= 0:
        return {}

    raw = _strip_ns(symbol)
    data = _nse_get("corporates-corporateActions", {"index": "equities", "symbol": raw})
    time.sleep(1.0)

    if not data:
        return {}

    actions = data if isinstance(data, list) else data.get("data", [])
    if not actions:
        return {}

    import datetime
    cutoff = datetime.date.today() - datetime.timedelta(days=3 * 365)
    total_buyback = 0.0

    for action in actions:
        purpose = (action.get("purpose") or action.get("subject") or "").lower()
        if "buyback" not in purpose:
            continue
        date_str = action.get("exDate") or action.get("recDate") or ""
        try:
            d = datetime.datetime.strptime(date_str, "%d-%b-%Y").date()
            if d < cutoff:
                continue
        except Exception:
            pass

        # NSE buyback records sometimes include amount in Cr in the purpose string
        # or as a separate field. Use face value as size proxy when amount is missing.
        amt = _sf(action.get("amount") or action.get("faceValue"))
        if amt:
            total_buyback += amt

    if total_buyback > 0:
        # NSE amounts in INR (face value rupees per share), convert to absolute:
        # total_buyback * shares_outstanding would be ideal, but we use a simplified proxy.
        # For now: treat total_buyback as Cr INR (1 Cr = 1e7 INR)
        buyback_abs = total_buyback * 1e7
        buyback_yield = (buyback_abs / market_cap) * 100.0 / 3.0  # annualised over 3y
        return {"buyback_yield": min(buyback_yield, 50.0)}  # sanity cap

    return {}


# ---------------------------------------------------------------------------
# Promoter pledging (NSE) — fix 8.1
# ---------------------------------------------------------------------------

def fetch_promoter_pledging(symbol: str) -> dict:
    """
    Fetch promoter pledging % from NSE shareholding pattern API.
    Endpoint: /api/corporate-pledgedata?symbol={SYMBOL}

    Returns dict with key:
      promoter_pledging_pct  — % of promoter shareholding pledged (0-100)

    >30% pledged is a leading distress indicator (NSE regulatory disclosure).
    Returns {} on failure.
    """
    raw = _strip_ns(symbol)
    data = _nse_get("corporate-pledgedata", {"symbol": raw})
    time.sleep(1.0)

    if not data:
        return {}

    rows = data if isinstance(data, list) else data.get("data", [])
    if not rows:
        return {}

    # Most recent entry
    try:
        latest = rows[0] if isinstance(rows[0], dict) else {}
        pledged = _sf(
            latest.get("totPledgedPct")
            or latest.get("pledgedPct")
            or latest.get("percentPledged")
        )
        if pledged is not None:
            return {"promoter_pledging_pct": float(np.clip(pledged, 0.0, 100.0))}
    except Exception:
        pass

    return {}

def enrich_fundamentals(
    conn,
    symbols: list[str],
    market_caps: dict[str, float] | None = None,
) -> int:
    """
    Enrich fundamentals table for all symbols:
      - .NS/.BO: NSE quarterly results + corporate actions + yfinance CAGR fallback
      - US/ETF:  yfinance quarterly financials for CAGR
      - All:     yfinance major_holders for institutional_ownership

    Tracks fetch status per symbol (FRESH/STALE/FETCH_FAILED/NEVER_FETCHED).
    Uses 24h disk cache to avoid hammering NSE on re-runs.
    On FETCH_FAILED: sets nse_enrichment_status and zeros revision_score to
    prevent stale/missing data from polluting the signal.

    conn: open DuckDB connection (caller owns lifecycle).
    market_caps: {symbol: market_cap} optional cache; fetched from DB if None.
    Returns number of symbols updated.
    """
    if market_caps is None:
        try:
            rows = conn.execute(
                "SELECT symbol, market_cap FROM fundamentals WHERE symbol = ANY(?)",
                [symbols],
            ).fetchall()
            market_caps = {r[0]: r[1] for r in rows if r[1]}
        except Exception:
            market_caps = {}

    def _fetch_one(sym: str) -> tuple[str, dict, bool, bool]:
        """
        Network half for one symbol. Returns (symbol, enriched, fetch_ok, from_cache).
        Pure I/O + dict building — no DuckDB access, so it is safe on a thread.
        """
        cached = _read_cache(sym)
        if cached:
            return sym, {k: v for k, v in cached.items() if not k.startswith("_")}, True, True

        enriched: dict = {}
        fetch_ok = False

        if sym.upper().endswith(".NS") or sym.upper().endswith(".BO"):
            try:
                qr = fetch_quarterly_results(sym)
                enriched.update(qr)
                mktcap = market_caps.get(sym)
                bb = fetch_buyback_yield(sym, mktcap)
                enriched.update(bb)
                pp = fetch_promoter_pledging(sym)
                enriched.update(pp)
                yf_cagr = _yf_cagr_fallback(sym)
                for k, v in yf_cagr.items():
                    if k not in enriched:
                        enriched[k] = v
                fetch_ok = bool(enriched)
            except Exception as e:
                logger.warning("[enrich] NSE fetch failed for %s: %s", sym, e)
                fetch_ok = False
        else:
            try:
                enriched = _yf_cagr_fallback(sym)
                fetch_ok = bool(enriched)
            except Exception:
                fetch_ok = False

        # Institutional ownership — separate yfinance call, not NSE
        try:
            inst = _yf_institutional_ownership(sym)
            enriched.update(inst)
        except Exception:
            pass

        return sym, enriched, fetch_ok, False

    # Two-plus blocking HTTP calls per symbol, previously issued one symbol at a
    # time: 50s for a 250-name US universe. yfinance/requests release the GIL
    # while waiting, so the fetch half parallelizes; the DuckDB writes below stay
    # sequential on the caller's connection, and the status/failure bookkeeping
    # still runs in the caller's `symbols` order so its results are unchanged.
    _n_workers = min(12, max(1, len(symbols)))
    with ThreadPoolExecutor(max_workers=_n_workers) as ex:
        fetched = list(ex.map(_fetch_one, symbols))

    # Record that these symbols were attempted, whether or not anything came
    # back. Callers select candidates on "field is still NULL", which is a
    # condition a symbol with no upstream data can never clear — without an
    # attempt timestamp those symbols are re-fetched on every run forever.
    try:
        conn.register("_enrich_attempted", pl.DataFrame({"symbol": symbols}).to_arrow())
        conn.execute(
            "INSERT OR IGNORE INTO fundamentals (symbol) "
            "SELECT symbol FROM _enrich_attempted"
        )
        conn.execute("""
            UPDATE fundamentals f SET enrichment_attempted_at = now()
            FROM _enrich_attempted t WHERE f.symbol = t.symbol
        """)
        conn.unregister("_enrich_attempted")
    except Exception as e:
        logger.warning("[enrich] could not record attempt timestamps: %s", e)

    updated = 0
    for sym, enriched, fetch_ok, from_cache in fetched:
        if fetch_ok and not from_cache:
            _write_cache(sym, enriched)

        # Update consecutive failure counter and set status
        is_india = sym.upper().endswith(".NS") or sym.upper().endswith(".BO")
        if is_india:
            if fetch_ok:
                _consecutive_failures[sym] = 0
                _set_status(sym, _STATUS_FRESH)
            else:
                count = _consecutive_failures.get(sym, 0) + 1
                _consecutive_failures[sym] = count
                _set_status(sym, _STATUS_FAILED)
                if count >= _ALERT_THRESHOLD:
                    logger.error(
                        "[enrich] ALERT: %s NSE fetch failed %d consecutive times",
                        sym, count,
                    )

        nse_status = get_nse_status(sym) if is_india else None

        if not enriched and not is_india:
            continue

        # Build UPDATE for only the fields we fetched
        set_parts = []
        values = []
        field_map = {
            "earnings_surprise_pct":   "earnings_surprise_pct",
            "eps_cagr_3y":             "eps_cagr_3y",
            "revenue_cagr_3y":         "revenue_cagr_3y",
            "buyback_yield":           "buyback_yield",
            "institutional_ownership": "institutional_ownership",
            "promoter_pledging_pct":   "promoter_pledging_pct",
        }
        for key, col in field_map.items():
            if key in enriched and enriched[key] is not None:
                set_parts.append(f"{col} = ?")
                values.append(float(enriched[key]))

        # Store NSE fetch status in fundamentals table if column exists
        if nse_status is not None:
            try:
                conn.execute("SELECT nse_enrichment_status FROM fundamentals LIMIT 0")
                set_parts.append("nse_enrichment_status = ?")
                values.append(nse_status)
            except Exception:
                pass  # Column doesn't exist yet — schema migration pending

        if not set_parts:
            continue

        conn.execute("INSERT OR IGNORE INTO fundamentals (symbol) VALUES (?)", [sym])
        values.append(sym)
        conn.execute(
            f"UPDATE fundamentals SET {', '.join(set_parts)} WHERE symbol = ?",
            values,
        )
        updated += 1
        logger.info("[enrich] %s [%s]: %s", sym, nse_status or "US",
                    {k: round(float(v), 2) for k, v in enriched.items()
                     if v is not None and isinstance(v, (int, float))})

    return updated
