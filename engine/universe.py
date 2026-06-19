"""
Dynamic universe discovery via yfinance screener + curated fallback lists.

Universe presets:
  nifty50             — Nifty 50 (screener: NSI, top 50 by mktcap)
  india_largecap      — NSE large-cap (mktcap > 2B USD, top 100)
  india_midcap        — NSE mid-cap (500M–2B USD, top 100)
  india_smallcap      — NSE small-cap (50M–500M USD, top 100)
  india_best          — Best recommendation scan: all NSE with quality filter
  us_largecap         — NASDAQ + NYSE top 100 by mktcap
  us_midcap           — US mid-cap (2B–10B)
  us_smallcap         — US small-cap (300M–2B)
  us_growth           — Predefined yf growth_technology_stocks + undervalued_growth
  etf                 — Top ETFs (US + India proxy ETFs)
  mf                  — Top mutual funds
  full_india          — india_largecap + india_midcap
  full_us             — us_largecap + us_midcap
  global              — full_us + full_india

All functions return plain list[str] of yfinance ticker symbols.
Falls back to curated lists if screener is unavailable.

SURVIVORSHIP BIAS WARNING:
  USE_POINT_IN_TIME_UNIVERSE = False (default).
  When False, all universes reflect CURRENT composition — survivorship bias is active.
  Backtest CAGRs are inflated by ~6pp/yr vs Nifty 50 TRI (audit finding, 2026-06).
  To use point-in-time composition, set USE_POINT_IN_TIME_UNIVERSE = True and
  provide a dated CSV at engine/data/pit_universe/{universe_name}.csv with columns:
    effective_date,symbol  (one row per constituent per effective date)
"""

from __future__ import annotations

import csv
import logging
import warnings
from datetime import date
from pathlib import Path
from typing import Callable

# ---------------------------------------------------------------------------
# Point-in-time universe config
# ---------------------------------------------------------------------------

USE_POINT_IN_TIME_UNIVERSE: bool = False
_PIT_DIR = Path(__file__).parents[1] / "engine" / "data" / "pit_universe"

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Curated fallback lists (used when screener fails)
# ---------------------------------------------------------------------------

_NIFTY50_FALLBACK = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "BHARTIARTL.NS", "ICICIBANK.NS",
    "INFY.NS", "SBIN.NS", "HINDUNILVR.NS", "ITC.NS", "LT.NS",
    "BAJFINANCE.NS", "HCLTECH.NS", "KOTAKBANK.NS", "AXISBANK.NS", "WIPRO.NS",
    "ASIANPAINT.NS", "MARUTI.NS", "SUNPHARMA.NS", "TITAN.NS", "ULTRACEMCO.NS",
    "NESTLEIND.NS", "POWERGRID.NS", "NTPC.NS", "TECHM.NS", "DIVISLAB.NS",
    "TATAMOTORS.NS", "TATASTEEL.NS", "JSWSTEEL.NS", "HINDALCO.NS", "COALINDIA.NS",
    "ONGC.NS", "BPCL.NS", "CIPLA.NS", "DRREDDY.NS", "EICHERMOT.NS",
    "ADANIENT.NS", "ADANIPORTS.NS", "BAJAJFINSV.NS", "BAJAJ-AUTO.NS", "HEROMOTOCO.NS",
    "APOLLOHOSP.NS", "BRITANNIA.NS", "GRASIM.NS", "INDUSINDBK.NS", "M&M.NS",
    "SBILIFE.NS", "HDFCLIFE.NS", "TATACONSUM.NS", "ZOMATO.NS", "SHRIRAMFIN.NS",
]

_INDIA_MIDCAP_FALLBACK = [
    "PERSISTENT.NS", "LTIM.NS", "MPHASIS.NS", "COFORGE.NS", "KPITTECH.NS",
    "TATAELXSI.NS", "HAPPSTMNDS.NS", "CHOLAFIN.NS", "BAJAJHLDNG.NS",
    "DMART.NS", "TRENT.NS", "PAGEIND.NS", "MANYAVAR.NS", "NYKAA.NS",
    "TORNTPHARM.NS", "ALKEM.NS", "AUROPHARMA.NS", "MAXHEALTH.NS",
    "SIEMENS.NS", "ABB.NS", "CUMMINSIND.NS", "THERMAX.NS",
    "IRFC.NS", "PFC.NS", "RECLTD.NS", "AMBUJACEM.NS", "ACC.NS",
    "POLYCAB.NS", "HAVELLS.NS", "VOLTAS.NS", "WHIRLPOOL.NS",
    "MANAPPURAM.NS", "MUTHOOTFIN.NS", "LICHSGFIN.NS",
    "INDIAMART.NS", "JUSTDIAL.NS", "MAPMYINDIA.NS",
]

_INDIA_SMALLCAP_FALLBACK = [
    "ROUTE.NS", "HAPPSTMNDS.NS", "CARTRADE.NS", "EASEMYTRIP.NS",
    "IXIGO.NS", "PAYTM.NS", "NUVAMA.NS", "ANANTRAJ.NS",
    "KAYNES.NS", "SYRMA.NS", "AVALON.NS", "IDEAFORGE.NS",
    "LATENTVIEW.NS", "XCHANGING.NS", "RATEGAIN.NS",
    "HLEGLAS.NS", "OLECTRA.NS", "GREENPANEL.NS",
]

_US_LARGECAP_FALLBACK = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "XOM", "LLY", "JNJ", "MA", "AVGO", "PG", "HD",
    "MRK", "CVX", "ABBV", "COST", "KO", "PEP", "ADBE", "CRM", "TMO", "ACN",
    "WMT", "NFLX", "AMD", "ORCL", "CSCO", "TXN", "QCOM", "INTC", "NOW",
    "AMAT", "LRCX", "KLAC", "GS", "MS", "BAC", "WFC", "SCHW",
    "CAT", "DE", "GE", "HON", "RTX", "UNP", "FDX", "UPS",
]

_US_MIDCAP_FALLBACK = [
    "PLTR", "COIN", "RBLX", "DKNG", "UBER", "ABNB", "DASH", "SPOT",
    "TWLO", "BILL", "DDOG", "SNOW", "MDB", "NET", "CFLT", "APP",
    "DUOL", "CELH", "HIMS", "GTLB", "PANW", "CRWD", "FTNT", "ZS",
    "ISRG", "DXCM", "IDXX", "VEEV", "PODD", "EW", "BSX",
    "NEE", "DUK", "ISRG", "COF", "USB", "PNC", "TFC",
]

_ETF_FALLBACK = [
    "SPY", "QQQ", "IWM", "DIA", "VTI", "SCHB",
    "EEM", "VWO", "INDA", "FXI",
    "TLT", "IEF", "SHY", "AGG",
    "GLD", "SLV", "USO", "DBC",
    "SOXX", "SMH", "XLK", "XLF", "XLE", "XLV", "XLI",
    "ARKK", "ARKG", "ARKF",
    "VGT", "VXUS", "BNDX",
]

_MF_FALLBACK = [
    "FXAIX", "VFIAX", "SPAXX", "FZROX", "FZILX",
    "VTSAX", "VGTSX", "VBTLX",
    "PRWCX", "DODGX", "PRDGX",
]


# ---------------------------------------------------------------------------
# Screener-based discovery
# ---------------------------------------------------------------------------

def _screener_symbols(query_fn: Callable, count: int, fallback: list[str]) -> list[str]:
    """
    Run a screener query fn with pagination (yfinance caps at 25/page).
    Falls back to curated list on any error.
    query_fn(offset, page_size) -> yfinance screen() result dict
    """
    try:
        PAGE = 25
        syms: list[str] = []
        seen: set[str] = set()
        for offset in range(0, count, PAGE):
            result = query_fn(offset, min(PAGE, count - offset))
            batch = [q["symbol"] for q in result.get("quotes", []) if q.get("symbol")]
            if not batch:
                break
            for s in batch:
                if s not in seen:
                    seen.add(s)
                    syms.append(s)
        if syms:
            return syms
    except Exception as e:
        logger.warning("Screener failed, using fallback: %s", e)
    return list(fallback[:count])


def _screen_nse(min_mktcap: float, max_mktcap: float | None, offset: int, page_size: int) -> dict:
    from yfinance.screener import screen, EquityQuery
    parts = [
        EquityQuery("eq", ["exchange", "NSI"]),
        EquityQuery("gt", ["intradaymarketcap", min_mktcap]),
    ]
    if max_mktcap is not None:
        parts.append(EquityQuery("lt", ["intradaymarketcap", max_mktcap]))
    q = EquityQuery("and", parts)
    return screen(q, sortField="intradaymarketcap", sortAsc=False, count=page_size, offset=offset)


def _screen_us(min_mktcap: float, max_mktcap: float | None, offset: int, page_size: int) -> dict:
    """
    Alternates between NASDAQ and NYSE pages so both exchanges are covered.
    offset is split evenly between exchanges.
    """
    from yfinance.screener import screen, EquityQuery
    nasdaq_parts = [
        EquityQuery("eq", ["exchange", "NMS"]),
        EquityQuery("gt", ["intradaymarketcap", min_mktcap]),
    ]
    nyse_parts = [
        EquityQuery("eq", ["exchange", "NYQ"]),
        EquityQuery("gt", ["intradaymarketcap", min_mktcap]),
    ]
    if max_mktcap is not None:
        nasdaq_parts.append(EquityQuery("lt", ["intradaymarketcap", max_mktcap]))
        nyse_parts.append(EquityQuery("lt", ["intradaymarketcap", max_mktcap]))

    half_size = max(1, page_size // 2)
    half_offset = offset // 2
    r1 = screen(EquityQuery("and", nasdaq_parts), sortField="intradaymarketcap", sortAsc=False,
                count=half_size, offset=half_offset)
    r2 = screen(EquityQuery("and", nyse_parts), sortField="intradaymarketcap", sortAsc=False,
                count=half_size, offset=half_offset)
    # Merge into a single result dict for _screener_symbols to consume
    combined = r1.get("quotes", []) + r2.get("quotes", [])
    return {"quotes": combined}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_nifty50(count: int = 50) -> list[str]:
    return _screener_symbols(
        lambda off, pg: _screen_nse(2_000_000_000, None, off, pg),
        count,
        _NIFTY50_FALLBACK,
    )[:count]


def get_india_largecap(count: int = 100) -> list[str]:
    """NSE stocks with mktcap > 2B USD (approx Nifty 100 range)."""
    return _screener_symbols(
        lambda off, pg: _screen_nse(2_000_000_000, None, off, pg),
        count,
        _NIFTY50_FALLBACK + _INDIA_MIDCAP_FALLBACK,
    )


def get_india_midcap(count: int = 100) -> list[str]:
    """NSE stocks 500M–2B USD mktcap."""
    return _screener_symbols(
        lambda off, pg: _screen_nse(500_000_000, 2_000_000_000, off, pg),
        count,
        _INDIA_MIDCAP_FALLBACK,
    )


def get_india_smallcap(count: int = 100) -> list[str]:
    """NSE stocks 50M–500M USD mktcap."""
    return _screener_symbols(
        lambda off, pg: _screen_nse(50_000_000, 500_000_000, off, pg),
        count,
        _INDIA_SMALLCAP_FALLBACK,
    )


def get_india_best(count: int = 200) -> list[str]:
    """
    'Best recommendation' scan: all NSE stocks above 50M mktcap.
    The engine's cross-sectional scoring surfaces top names.
    """
    return _screener_symbols(
        lambda off, pg: _screen_nse(50_000_000, None, off, pg),
        count,
        _NIFTY50_FALLBACK + _INDIA_MIDCAP_FALLBACK + _INDIA_SMALLCAP_FALLBACK,
    )


def get_us_largecap(count: int = 100) -> list[str]:
    """NASDAQ + NYSE stocks mktcap > 10B USD."""
    return _screener_symbols(
        lambda off, pg: _screen_us(10_000_000_000, None, off, pg),
        count,
        _US_LARGECAP_FALLBACK,
    )


def get_us_midcap(count: int = 100) -> list[str]:
    """US stocks 2B–10B USD mktcap."""
    return _screener_symbols(
        lambda off, pg: _screen_us(2_000_000_000, 10_000_000_000, off, pg),
        count,
        _US_MIDCAP_FALLBACK,
    )


def get_us_smallcap(count: int = 100) -> list[str]:
    """US stocks 300M–2B USD mktcap."""
    return _screener_symbols(
        lambda off, pg: _screen_us(300_000_000, 2_000_000_000, off, pg),
        count,
        _US_MIDCAP_FALLBACK,
    )


def get_us_growth(count: int = 80) -> list[str]:
    """yfinance predefined: growth tech + undervalued growth, paginated."""
    try:
        from yfinance.screener import screen
        seen: set[str] = set()
        syms: list[str] = []
        half = count // 2
        for name, target in [("growth_technology_stocks", half), ("undervalued_growth_stocks", half)]:
            for offset in range(0, target, 25):
                r = screen(name, count=min(25, target - offset), offset=offset)
                for q in r.get("quotes", []):
                    s = q.get("symbol")
                    if s and s not in seen:
                        seen.add(s)
                        syms.append(s)
                if len(r.get("quotes", [])) < 25:
                    break
        if syms:
            return syms
    except Exception as e:
        logger.warning("US growth screener failed: %s", e)
    return list(_US_MIDCAP_FALLBACK[:count])


def get_etfs(count: int = 50) -> list[str]:
    """Top ETFs from yfinance predefined screeners + core India/macro ETFs."""
    try:
        from yfinance.screener import screen
        seen: set[str] = set()
        syms: list[str] = []
        half = count // 2
        for name, target in [("top_etfs_us", half), ("top_performing_etfs", half)]:
            for offset in range(0, target, 25):
                r = screen(name, count=min(25, target - offset), offset=offset)
                for q in r.get("quotes", []):
                    s = q.get("symbol")
                    if s and s not in seen:
                        seen.add(s)
                        syms.append(s)
                if len(r.get("quotes", [])) < 25:
                    break
        # Core macro/India ETFs always included
        for extra in ["SPY", "QQQ", "IWM", "INDA", "EEM", "GLD", "TLT", "VTI", "SOXX", "XLK"]:
            if extra not in seen:
                seen.add(extra)
                syms.append(extra)
        return syms[:count] if syms else list(_ETF_FALLBACK[:count])
    except Exception as e:
        logger.warning("ETF screener failed: %s", e)
    return list(_ETF_FALLBACK[:count])


def get_mutual_funds(count: int = 30) -> list[str]:
    """Top mutual funds from yfinance predefined screener."""
    try:
        from yfinance.screener import screen
        seen: set[str] = set()
        syms: list[str] = []
        for offset in range(0, count, 25):
            r = screen("top_mutual_funds", count=min(25, count - offset), offset=offset)
            for q in r.get("quotes", []):
                s = q.get("symbol")
                if s and s not in seen:
                    seen.add(s)
                    syms.append(s)
            if len(r.get("quotes", [])) < 25:
                break
        return syms if syms else list(_MF_FALLBACK[:count])
    except Exception as e:
        logger.warning("MF screener failed: %s", e)
    return list(_MF_FALLBACK[:count])


# ---------------------------------------------------------------------------
# Named universe dispatch
# ---------------------------------------------------------------------------

_UNIVERSE_REGISTRY: dict[str, tuple[Callable[[], list[str]], str]] = {
    "nifty50":          (get_nifty50,                   "India — Nifty 50"),
    "india_largecap":   (get_india_largecap,             "India — Large Cap (mktcap > ₹17k Cr)"),
    "india_midcap":     (get_india_midcap,               "India — Mid Cap"),
    "india_smallcap":   (get_india_smallcap,             "India — Small Cap"),
    "india_best":       (get_india_best,                 "India — Best Recommendations (full scan)"),
    "full_india":       (lambda: get_india_largecap(100) + get_india_midcap(100),
                                                         "India — Large + Mid Cap"),
    "us_largecap":      (get_us_largecap,                "US — Large Cap (mktcap > $10B)"),
    "us_midcap":        (get_us_midcap,                  "US — Mid Cap"),
    "us_smallcap":      (get_us_smallcap,                "US — Small Cap"),
    "us_growth":        (get_us_growth,                  "US — Growth Tech + Undervalued Growth"),
    "full_us":          (lambda: get_us_largecap(100) + get_us_midcap(100),
                                                         "US — Large + Mid Cap"),
    "etf":              (get_etfs,                       "ETFs (US + global)"),
    "mf":               (get_mutual_funds,               "Mutual Funds"),
    "global":           (lambda: get_us_largecap(100) + get_india_largecap(50) + get_india_midcap(50),
                                                         "Global — US + India"),
}


def _load_pit_universe(name: str, as_of: date | None = None) -> list[str] | None:
    """
    Load point-in-time universe from CSV.
    CSV format: effective_date (YYYY-MM-DD), symbol
    Returns symbols active as of `as_of` date (defaults to today).
    Returns None if no CSV exists for this universe.
    """
    path = _PIT_DIR / f"{name}.csv"
    if not path.exists():
        return None
    as_of = as_of or date.today()
    constituents: list[tuple[date, str]] = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                d = date.fromisoformat(row["effective_date"])
                constituents.append((d, row["symbol"]))
            except (KeyError, ValueError):
                continue
    if not constituents:
        return None
    # Latest batch on or before as_of
    valid_dates = sorted({d for d, _ in constituents if d <= as_of}, reverse=True)
    if not valid_dates:
        return None
    latest = valid_dates[0]
    return [sym for d, sym in constituents if d == latest]


def get_universe_by_name(name: str, as_of: date | None = None) -> list[str]:
    """
    Fetch universe by preset name. Returns deduplicated list[str] of tickers.
    Raises ValueError for unknown names.

    When USE_POINT_IN_TIME_UNIVERSE=True, loads from dated CSV if available.
    When False, logs a survivorship bias warning and uses current screener.
    Audit finding (2026-06): current composition inflates CAGR by ~6pp/yr vs TRI.
    """
    name = name.lower().strip()
    if name not in _UNIVERSE_REGISTRY:
        valid = ", ".join(sorted(_UNIVERSE_REGISTRY.keys()))
        raise ValueError(f"Unknown universe '{name}'. Valid: {valid}")

    if USE_POINT_IN_TIME_UNIVERSE:
        pit = _load_pit_universe(name, as_of)
        if pit:
            syms = pit
        else:
            warnings.warn(
                f"USE_POINT_IN_TIME_UNIVERSE=True but no PIT CSV found for '{name}'. "
                f"Falling back to current screener. Place CSV at engine/data/pit_universe/{name}.csv",
                stacklevel=2,
            )
            fn, _ = _UNIVERSE_REGISTRY[name]
            syms = fn()
    else:
        logger.warning(
            "SURVIVORSHIP BIAS ACTIVE: universe '%s' fixed at current composition. "
            "Backtest returns inflated ~6pp/yr vs Nifty50 TRI. "
            "Set USE_POINT_IN_TIME_UNIVERSE=True with a dated CSV to suppress.",
            name,
        )
        fn, _ = _UNIVERSE_REGISTRY[name]
        syms = fn()

    seen: set[str] = set()
    result: list[str] = []
    for s in syms:
        if s not in seen:
            seen.add(s)
            result.append(s)
    return result


def list_universes() -> dict[str, str]:
    """Return {name: description} for all available universes."""
    return {k: v[1] for k, v in _UNIVERSE_REGISTRY.items()}
