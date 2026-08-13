"""
Vectorized Monte Carlo DCF valuation.
50k paths, GBM revenue model with mean-reversion, NumPy/Accelerate-linked BLAS.

Memory budget for 50k paths × 10 years × float64:
  - shock matrix: 50k × 10 × 8 bytes = 4 MB — allocated once, reused per call.
  - revenue matrix: same.
Total peak per call: ~20 MB. Safe on 8GB+ M-series.

Critical fix vs original:
  - RNG is passed in, NOT re-seeded per symbol. Seeding rng=np.random.default_rng(42)
    inside the function meant every symbol got identical stochastic paths.
    The caller (daily_run) must pass a single shared rng seeded once per session.
"""

from __future__ import annotations

import numpy as np
import polars as pl


N_PATHS          = 50_000
PROJECTION_YEARS = 10
# Pre-allocate shock matrix once at module level (reused across all calls)
# Shape: (N_PATHS, PROJECTION_YEARS). Populated per call.
_SHOCK_MATRIX    = np.empty((N_PATHS, PROJECTION_YEARS), dtype=np.float64)


def compute_rolling_beta(
    price_df: pl.DataFrame,
    index_df: pl.DataFrame,
    window_days: int = 252,
) -> float:
    """
    252-day rolling OLS beta of stock vs index using most recent window.
    Blume-Vasicek shrinkage: beta_adj = 0.67 * beta_raw + 0.33 * 1.0

    Requires both DataFrames to have 'date' (pl.Date) and 'close' columns.
    Returns 1.0 on insufficient data or numerical failure.
    """
    if price_df is None or index_df is None:
        return 1.0

    # Align on shared dates, take last window_days rows
    stock = price_df.sort("date").select(["date", "close"]).rename({"close": "s"})
    index = index_df.sort("date").select(["date", "close"]).rename({"close": "i"})
    joined = stock.join(index, on="date", how="inner").sort("date").tail(window_days)

    if len(joined) < 60:
        return 1.0

    s_close = joined["s"].to_numpy().astype(np.float64)
    i_close = joined["i"].to_numpy().astype(np.float64)

    # Daily log returns
    s_ret = np.diff(np.log(s_close))
    i_ret = np.diff(np.log(i_close))

    # Filter non-finite
    mask = np.isfinite(s_ret) & np.isfinite(i_ret)
    s_ret, i_ret = s_ret[mask], i_ret[mask]
    if len(s_ret) < 30:
        return 1.0

    # OLS: beta = Cov(s, i) / Var(i)
    i_mean = i_ret.mean()
    s_mean = s_ret.mean()
    var_i  = float(np.sum((i_ret - i_mean) ** 2))
    if var_i < 1e-12:
        return 1.0
    cov_si = float(np.sum((s_ret - s_mean) * (i_ret - i_mean)))
    beta_raw = cov_si / var_i

    # Blume-Vasicek shrinkage toward 1.0
    beta_adj = 0.67 * beta_raw + 0.33 * 1.0
    return float(np.clip(beta_adj, 0.1, 4.0))


def compute_wacc(
    beta: float           = 1.0,
    risk_free: float      = 0.044,   # 10-year Treasury
    erp: float            = 0.055,   # Equity risk premium (Damodaran 2025)
    debt_weight: float    = 0.1,
    cost_of_debt: float   = 0.05,
    tax_rate: float       = 0.21,
) -> float:
    """CAPM-based WACC. Clamped to [4%, 20%] to prevent degenerate DCF."""
    cost_of_equity = risk_free + beta * erp
    equity_weight  = 1.0 - debt_weight
    wacc = equity_weight * cost_of_equity + debt_weight * cost_of_debt * (1.0 - tax_rate)
    return float(np.clip(wacc, 0.04, 0.20))


# Sector-specific terminal growth rates (fix 4.3)
# Source: Damodaran sector terminal growth estimates, 2025
# India adjustment: +1pp PPP differential (India nominal GDP growth premium)
_SECTOR_TERMINAL_GROWTH: dict[str, float] = {
    "Technology":               0.030,
    "Information Technology":   0.030,
    "Communication Services":   0.025,
    "Consumer Discretionary":   0.025,
    "Consumer Staples":         0.020,
    "Health Care":              0.025,
    "Financials":               0.020,
    "Industrials":              0.020,
    "Materials":                0.015,
    "Real Estate":              0.015,
    "Utilities":                0.015,
    "Energy":                   0.015,
}
_DEFAULT_TERMINAL_GROWTH = 0.025


def get_terminal_growth(sector: str | None = None, is_india: bool = False) -> float:
    """
    Return sector-specific terminal growth rate.
    India stocks get +1pp PPP adjustment.
    """
    base = _SECTOR_TERMINAL_GROWTH.get(sector or "", _DEFAULT_TERMINAL_GROWTH)
    if is_india:
        base += 0.01
    return float(np.clip(base, 0.005, 0.06))


def _sample_growth_paths(
    base_growth: float,
    n_paths: int,
    rng: np.random.Generator,
    lr_mean: float = 0.05,
) -> np.ndarray:
    """
    Ornstein-Uhlenbeck growth path to long-run mean.
    Uses Euler-Maruyama discretization: g_{t+1} = g_t + θ(μ - g_t) + σ·ε
    θ=0.3 (half-life ≈ 2 years), σ=0.08.

    lr_mean (fix 4.3): India uses 0.10 (nominal GDP growth), US uses 0.05.
    Returns terminal growth rate per path after 10 mean-reversion steps.
    """
    theta   = 0.30
    sigma_g = 0.08

    g = np.full(n_paths, base_growth, dtype=np.float64)
    for _ in range(PROJECTION_YEARS):
        g += theta * (lr_mean - g) + sigma_g * rng.standard_normal(n_paths)
    return np.clip(g, -0.20, 0.50)


def run_mc_dcf(
    revenue: float,
    revenue_growth: float,
    fcf_margin: float,
    shares_outstanding: float,
    wacc: float                 = 0.09,
    terminal_growth: float      = 0.025,
    rng: np.random.Generator    | None = None,
    n_paths: int                = N_PATHS,
    lr_mean_growth: float       = 0.05,
) -> dict:
    """
    Vectorized N_PATHS-path DCF.

    Args:
        revenue:           TTM revenue (USD).
        revenue_growth:    Latest YoY revenue growth as fraction.
        fcf_margin:        Latest FCF/revenue as fraction.
        shares_outstanding: Share count (units, not millions).
        wacc:              Discount rate.
        terminal_growth:   Gordon terminal growth rate.
        rng:               Shared numpy Generator. If None, creates a new one
                           (use only for standalone testing — daily_run passes one).
        n_paths:           Number of Monte Carlo paths.

    Returns:
        dict with p10/p25/p50/p75/p90 intrinsic values per share and metadata.
    """
    if rng is None:
        rng = np.random.default_rng()   # non-deterministic if no seed passed

    # --- Sample growth and margin uncertainty ---
    growth_paths = _sample_growth_paths(revenue_growth, n_paths, rng, lr_mean=lr_mean_growth)

    margin_noise   = 0.05 * rng.standard_normal(n_paths)
    margin_paths   = np.clip(fcf_margin + margin_noise, 0.01, 0.60)

    # --- Pre-allocate shock matrix (per-year GBM shocks on revenue) ---
    # Shape: (n_paths, PROJECTION_YEARS)
    annual_vol = 0.12  # revenue vol
    raw_shocks = rng.standard_normal((n_paths, PROJECTION_YEARS))
    # Log-normal shock: exp(σ·ε - 0.5σ²) so E[shock]=1
    shock_matrix = np.exp(annual_vol * raw_shocks - 0.5 * annual_vol ** 2)

    # --- Discount factors (scalar, not per-path — wacc is fixed) ---
    discount = np.array([1.0 / (1.0 + wacc) ** t for t in range(1, PROJECTION_YEARS + 1)])

    # --- Vectorized projection ---
    # base_rev: (n_paths,)
    base_rev = np.full(n_paths, revenue, dtype=np.float64)
    pv_fcfs  = np.zeros(n_paths, dtype=np.float64)

    for t in range(PROJECTION_YEARS):
        # Linear growth fade from base to 3% terminal over PROJECTION_YEARS
        fade    = (PROJECTION_YEARS - (t + 1)) / PROJECTION_YEARS
        yr_growth = growth_paths * fade + 0.03 * (1.0 - fade)

        base_rev  = base_rev * (1.0 + yr_growth) * shock_matrix[:, t]
        fcf_yr    = base_rev * margin_paths
        pv_fcfs  += fcf_yr * discount[t]

    # --- Terminal value: Gordon Growth Model ---
    terminal_fcf = base_rev * margin_paths * (1.0 + terminal_growth)
    # Prevent negative terminal value (base_rev can drift negative in tail paths)
    terminal_fcf = np.maximum(terminal_fcf, 0.0)
    terminal_val = terminal_fcf / max(wacc - terminal_growth, 0.001)
    pv_terminal  = terminal_val * discount[-1]

    total_value = pv_fcfs + pv_terminal

    # Per-share
    per_share = total_value / max(shares_outstanding, 1.0)
    per_share = per_share[np.isfinite(per_share) & (per_share >= 0)]

    if len(per_share) < 100:
        return None  # insufficient valid paths — caller handles gracefully

    # Cap at 99th percentile to remove tail blow-ups, keep p90 meaningful
    cap = float(np.percentile(per_share, 99))
    per_share = np.minimum(per_share, cap)

    return {
        "p10": float(np.percentile(per_share, 10)),
        "p25": float(np.percentile(per_share, 25)),
        "p50": float(np.percentile(per_share, 50)),
        "p75": float(np.percentile(per_share, 75)),
        "p90": float(np.percentile(per_share, 90)),
        "wacc":              wacc,
        "terminal_growth":   terminal_growth,
        "n_valid_paths":     len(per_share),
        "path_survival_rate": len(per_share) / n_paths,
    }


def compute_mc_upside(current_price: float, mc_result: dict) -> float:
    """Upside/(downside) to p50 intrinsic value as fraction."""
    if current_price <= 0:
        return 0.0
    return (mc_result["p50"] - current_price) / current_price


def build_mc_valuation_from_fundamentals(
    fund: dict,
    current_price: float,
    shares_outstanding: float | None = None,
    rng: np.random.Generator | None = None,
    price_df: pl.DataFrame | None = None,
    index_df: pl.DataFrame | None = None,
    symbol: str = "",
) -> dict | None:
    """
    Build MC valuation from DuckDB fundamentals row (snake_case keys).

    Revenue derivation priority (fix 4.2):
      1. EDGAR XBRL TTM revenue  — most reliable for US stocks
      2. ebitda / (operating_margin / 100)  — fallback
      3. ebitda alone as revenue proxy       — last resort

    Beta derivation priority:
      1. 252-day rolling OLS vs index_df with Blume-Vasicek shrinkage
      2. Fallback: 1.0

    Terminal growth (fix 4.3):
      Sector-specific from _SECTOR_TERMINAL_GROWTH table.
      India symbols (+.NS/.BO) get +1pp PPP adjustment.

    OU long-run mean (fix 4.3):
      India: μ_LR = 10% (matches India nominal GDP growth premium).
      US:    μ_LR = 5%.
    """
    # Revenue: EDGAR first for US, then yfinance-derived fallback
    revenue: float | None = None
    _revenue_source = "yfinance"
    is_india = symbol.endswith(".NS") or symbol.endswith(".BO")
    if symbol and not is_india:
        try:
            from engine.data.edgar_loader import get_edgar_revenue
            edgar_rev = get_edgar_revenue(symbol)
            if edgar_rev is not None and np.isfinite(edgar_rev) and edgar_rev > 0:
                revenue = edgar_rev
                _revenue_source = "edgar"
        except Exception:
            pass

    if revenue is None:
        op_margin = fund.get("operating_margin")
        ebitda    = fund.get("ebitda")
        if ebitda and np.isfinite(float(ebitda)) and float(ebitda) > 0:
            if op_margin and np.isfinite(float(op_margin)) and float(op_margin) > 1.0:
                revenue = float(ebitda) / (float(op_margin) / 100.0)
            else:
                revenue = float(ebitda)

    # Currency alignment for Indian stocks (fix: yfinance returns EBITDA/revenue in USD
    # for .NS symbols while market_cap and current_price are in INR).
    # Detection: if is_india and revenue << market_cap by factor >50, the revenue is
    # likely in USD. Scale by approximate USD/INR rate (derived from market_cap/price ratio
    # vs total_revenue ratio). Use market_cap-to-revenue ratio as sanity check.
    if is_india and revenue is not None and current_price > 0:
        mktcap = fund.get("market_cap")
        if mktcap and np.isfinite(float(mktcap)) and float(mktcap) > 0:
            # Market cap is in INR; revenue from yfinance is in USD
            # USD/INR ≈ 83. If revenue*83 is closer to expected revenue scale, rescale.
            # Heuristic: P/S ratio. For large-cap IT, P/S is typically 3–8x.
            # If revenue is in USD: P/S_apparent = mktcap_inr / revenue_usd ≈ 83 * true_P/S
            ps_apparent = float(mktcap) / revenue
            if ps_apparent > 100:
                # Revenue is almost certainly in USD; convert to INR at ~83
                _usdinr = 83.0
                try:
                    from engine.data.macro_loader import _yf_close as _yfc
                    _rates = _yfc("INR=X", period="5d")
                    if _rates is not None and len(_rates) > 0:
                        _usdinr = float(_rates[-1])
                except Exception:
                    pass
                revenue = revenue * _usdinr

    if revenue is None:
        return None

    rev_growth = float(fund.get("revenue_growth_yoy") or 0.0) / 100.0
    fcf_margin = float(fund.get("fcf_margin") or 5.0) / 100.0
    debt_eq    = float(fund.get("debt_to_equity") or 0.3)
    debt_weight = min(debt_eq / (1.0 + abs(debt_eq)), 0.60)

    beta = compute_rolling_beta(price_df, index_df) if price_df is not None and index_df is not None else 1.0
    # India: higher risk-free rate (~6.5% 10Y GOI), ERP (~6%), and the
    # 25.17% corporate rate (22% base + surcharge + cess), not the US 21%.
    if is_india:
        wacc = compute_wacc(beta=beta, risk_free=0.065, erp=0.06, debt_weight=debt_weight, tax_rate=0.2517)
    else:
        wacc = compute_wacc(beta=beta, debt_weight=debt_weight)

    # Sector-specific terminal growth (fix 4.3)
    sector = fund.get("sector") or fund.get("gics_sector")
    terminal_growth = get_terminal_growth(sector=sector, is_india=is_india)

    # OU long-run mean: India 10%, US 5% (fix 4.3)
    lr_mean_growth = 0.10 if is_india else 0.05

    if shares_outstanding is None or shares_outstanding <= 0:
        # Try to derive from market_cap / current_price before falling back
        mktcap = fund.get("market_cap")
        if mktcap and np.isfinite(float(mktcap)) and float(mktcap) > 0 and current_price > 0:
            shares_outstanding = float(mktcap) / current_price
        else:
            shares_outstanding = 1_000_000_000  # 1B fallback — caller should pass real shares

    result = run_mc_dcf(
        revenue=revenue,
        revenue_growth=rev_growth,
        fcf_margin=fcf_margin,
        shares_outstanding=shares_outstanding,
        wacc=wacc,
        terminal_growth=terminal_growth,
        rng=rng,
        lr_mean_growth=lr_mean_growth,
    )

    if result is None:
        return None

    result["upside_to_p50"]   = compute_mc_upside(current_price, result)
    result["current_price"]  = current_price
    result["beta_used"]      = beta
    result["revenue_source"] = _revenue_source
    return result
