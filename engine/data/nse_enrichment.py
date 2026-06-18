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

Rate limiting: 1s between NSE requests (avoid 429).
All functions safe to call when NSE is unreachable — returns {} on any error.
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

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


def _nse_get(path: str, params: dict | None = None) -> dict | list:
    """GET from NSE API with session cookies. Returns {} on failure."""
    s = _get_session()
    url = f"{_NSE_BASE}/api/{path}"
    try:
        r = s.get(url, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.debug("NSE API %s failed: %s", path, e)
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
# Public entry point
# ---------------------------------------------------------------------------

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

    updated = 0
    for sym in symbols:
        enriched: dict = {}

        if sym.upper().endswith(".NS") or sym.upper().endswith(".BO"):
            # Indian symbol — NSE APIs first, then yfinance fallback
            qr = fetch_quarterly_results(sym)
            enriched.update(qr)

            mktcap = market_caps.get(sym)
            bb = fetch_buyback_yield(sym, mktcap)
            enriched.update(bb)

            # CAGR from yfinance quarterly financials (works for NSE)
            yf_cagr = _yf_cagr_fallback(sym)
            for k, v in yf_cagr.items():
                if k not in enriched:
                    enriched[k] = v
        else:
            # US / ETF — yfinance quarterly financials
            enriched = _yf_cagr_fallback(sym)

        # Institutional ownership works for all symbols via yfinance
        inst = _yf_institutional_ownership(sym)
        enriched.update(inst)

        if not enriched:
            continue

        # Build UPDATE for only the fields we fetched
        set_parts = []
        values = []
        field_map = {
            "earnings_surprise_pct":  "earnings_surprise_pct",
            "eps_cagr_3y":            "eps_cagr_3y",
            "revenue_cagr_3y":        "revenue_cagr_3y",
            "buyback_yield":          "buyback_yield",
            "institutional_ownership": "institutional_ownership",
        }
        for key, col in field_map.items():
            if key in enriched and enriched[key] is not None:
                set_parts.append(f"{col} = ?")
                values.append(float(enriched[key]))

        if not set_parts:
            continue

        # Ensure row exists, then update
        conn.execute("INSERT OR IGNORE INTO fundamentals (symbol) VALUES (?)", [sym])
        values.append(sym)
        conn.execute(
            f"UPDATE fundamentals SET {', '.join(set_parts)} WHERE symbol = ?",
            values,
        )
        updated += 1
        logger.info("[enrich] %s: %s", sym,
                    {k: round(v, 2) for k, v in enriched.items() if v is not None})

    return updated
