"""
Macro feature loader for HMM regime model augmentation (fix 3.2).

US features:
  vix_level        : VIX spot (^VIX close)
  vix_zscore       : 63-day rolling z-score of VIX
  vix_term_slope   : VIX9D - VIX (front-heavy contango = risk-off)
  yield_curve_2s10s: 10Y - 2Y Treasury spread (negative = inversion)
  hy_5d_return     : 5-day log-return of HY proxy (HYG ETF)

India features:
  india_vix_zscore : 63-day rolling z-score of India VIX (^INDIAVIX)
  usdinr_3d_change : 3-day log-change in USD/INR (INR=X)
  fii_net_flow_norm: FII net buy/sell normalised by 20-day avg (NSE endpoint)

All fetched via yfinance; NSE FII flow via NSE India public API.
Returns None values for any fetch failure — callers must handle gracefully.
"""

from __future__ import annotations

import warnings
from datetime import date, timedelta

import numpy as np

warnings.filterwarnings("ignore")


def _yf_close(ticker: str, period: str = "3mo") -> np.ndarray | None:
    """Fetch closing prices for a ticker via yfinance. Returns None on failure."""
    try:
        import yfinance as yf
        df = yf.download(ticker, period=period, progress=False, auto_adjust=True)
        if df.empty or "Close" not in df.columns:
            return None
        arr = df["Close"].dropna().to_numpy().astype(np.float64)
        return arr if len(arr) >= 5 else None
    except Exception:
        return None


def _rolling_zscore(arr: np.ndarray, window: int = 63) -> float | None:
    """Z-score of last value vs rolling window."""
    if len(arr) < window:
        return None
    window_data = arr[-window:]
    mean = window_data.mean()
    std  = window_data.std(ddof=1)
    if std < 1e-8:
        return 0.0
    return float((arr[-1] - mean) / std)


def fetch_us_macro_features() -> dict[str, float | None]:
    """
    Fetch US macro features for HMM augmentation.
    All values normalised or bounded to be directly usable as HMM observations.
    Returns dict with keys: vix_level, vix_zscore, vix_term_slope,
                            yield_curve_2s10s, hy_5d_return.
    """
    result: dict[str, float | None] = {
        "vix_level":         None,
        "vix_zscore":        None,
        "vix_term_slope":    None,
        "yield_curve_2s10s": None,
        "hy_5d_return":      None,
    }

    # VIX spot
    vix = _yf_close("^VIX", period="6mo")
    if vix is not None and len(vix) > 0:
        result["vix_level"]  = float(vix[-1])
        result["vix_zscore"] = _rolling_zscore(vix, window=63)

    # VIX term structure: VIX9D (9-day) vs VIX (30-day)
    # Negative slope (VIX9D > VIX) = front-loaded fear = risk-off signal
    vix9 = _yf_close("^VIX9D", period="1mo")
    if vix9 is not None and vix is not None:
        result["vix_term_slope"] = float(vix9[-1] - vix[-1])

    # 2s10s yield curve: ^TNX (10Y) - ^IRX (13-week proxy for 2Y)
    tnx = _yf_close("^TNX", period="3mo")
    irx = _yf_close("^IRX", period="3mo")
    if tnx is not None and irx is not None and len(tnx) > 0 and len(irx) > 0:
        result["yield_curve_2s10s"] = float(tnx[-1] - irx[-1])

    # HY proxy: HYG 5-day log-return
    hyg = _yf_close("HYG", period="1mo")
    if hyg is not None and len(hyg) >= 6:
        result["hy_5d_return"] = float(np.log(hyg[-1] / hyg[-6]))

    return result


def fetch_india_macro_features() -> dict[str, float | None]:
    """
    Fetch India macro features for HMM augmentation.
    Returns dict with keys: india_vix_zscore, usdinr_3d_change, fii_net_flow_norm.
    """
    result: dict[str, float | None] = {
        "india_vix_zscore":   None,
        "usdinr_3d_change":   None,
        "fii_net_flow_norm":  None,
    }

    # India VIX
    ivix = _yf_close("^INDIAVIX", period="6mo")
    if ivix is not None:
        result["india_vix_zscore"] = _rolling_zscore(ivix, window=63)

    # USD/INR 3-day change
    usdinr = _yf_close("INR=X", period="1mo")
    if usdinr is not None and len(usdinr) >= 4:
        result["usdinr_3d_change"] = float(np.log(usdinr[-1] / usdinr[-4]))

    # FII net flow from NSE
    fii = fetch_fii_flow_nse()
    result["fii_net_flow_norm"] = fii

    return result


def fetch_fii_flow_nse() -> float | None:
    """
    Fetch FII net buy/sell from NSE India public API endpoint.
    Returns FII net flow normalised by 20-day average absolute flow.
    Returns None on fetch failure.

    Endpoint: https://www.nseindia.com/api/fiidiiTradeReact
    Data format: list of dicts with 'category', 'buyValue', 'sellValue' per date.
    """
    try:
        import requests

        url     = "https://www.nseindia.com/api/fiidiiTradeReact"
        headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept":     "application/json",
            "Referer":    "https://www.nseindia.com/",
        }
        # Session needed for NSE cookie
        session = requests.Session()
        session.get("https://www.nseindia.com/", headers=headers, timeout=10)
        resp = session.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # Extract FII rows
        fii_flows = []
        for row in data:
            if not isinstance(row, dict):
                continue
            category = str(row.get("category", "")).upper()
            if "FII" not in category and "FPI" not in category:
                continue
            try:
                buy  = float(str(row.get("buyValue", "0")).replace(",", ""))
                sell = float(str(row.get("sellValue", "0")).replace(",", ""))
                fii_flows.append(buy - sell)
            except (ValueError, TypeError):
                continue

        if not fii_flows:
            return None

        flows_arr = np.array(fii_flows[-20:], dtype=np.float64)
        avg_abs   = np.mean(np.abs(flows_arr)) or 1.0
        return float(np.clip(flows_arr[-1] / avg_abs, -3.0, 3.0))

    except Exception:
        return None
