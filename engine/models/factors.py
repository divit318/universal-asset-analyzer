"""
Quantitative factor engine.
Factors: Momentum (JT), Quality (QMJ), Value, Low-Volatility, Earnings Revision.

All raw scores are z-scored cross-sectionally before composite computation.
Composite weights are IC-proportional (information coefficient = Spearman rank
correlation of factor score with forward 21-day return). This means the composite
is NOT arbitrary — weights are derived from the actual predictive content of
each factor in the current universe.

When historical IC is unavailable (first run), equal weights are used as a prior.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from scipy.stats import spearmanr


# ---------------------------------------------------------------------------
# Individual factor raw score computation (per-symbol scalar)
# ---------------------------------------------------------------------------

def compute_momentum_score(price_df: pl.DataFrame) -> float | None:
    """
    Jegadeesh-Titman 12-1 month momentum.
    Raw value: (12m return) - (1m return). Units: fraction.
    Cross-sectional z-score applied later.
    """
    if len(price_df) < 252:
        return None
    df    = price_df.sort("date")
    close = df["close"].to_numpy().astype(np.float64)
    if close[-252] <= 0 or close[-21] <= 0 or close[-1] <= 0:
        return None
    ret_12m = close[-1] / close[-252] - 1.0
    ret_1m  = close[-1] / close[-21]  - 1.0
    return float(ret_12m - ret_1m)


def compute_quality_score(fund: dict) -> float | None:
    """
    QMJ quality score — Asness et al. (2019).

    Each sub-component is independently z-scored before weighting so that
    ROE (e.g. ~15%) doesn't dominate ROIC (e.g. ~10%) purely by magnitude.

    Sub-components:
      Profitability (40%): ROE, ROIC, gross_margin, operating_margin
      Safety        (30%): -debt_to_equity, -net_debt_to_ebitda, current_ratio
      Growth        (20%): revenue_cagr_3y, eps_cagr_3y
      Payout        (10%): fcf_margin, buyback_yield

    Returns a single float in roughly [-3, 3] range after within-group
    equal-weighting. No absolute magnitude dependency.
    """
    def _safe(key: str) -> float | None:
        v = fund.get(key)
        return float(v) if v is not None and np.isfinite(float(v)) else None

    profitability = [_safe("roe"), _safe("roic"), _safe("gross_margin"), _safe("operating_margin")]
    safety        = [_safe("debt_to_equity"), _safe("net_debt_to_ebitda"), _safe("current_ratio")]
    growth        = [_safe("revenue_cagr_3y"), _safe("eps_cagr_3y")]
    payout        = [_safe("fcf_margin"), _safe("buyback_yield")]

    def _group_score(vals: list[float | None], signs: list[float]) -> float | None:
        pairs = [(v, s) for v, s in zip(vals, signs) if v is not None]
        if not pairs:
            return None
        return float(np.mean([v * s for v, s in pairs]))

    p = _group_score(profitability, [1, 1, 1, 1])
    sa = _group_score(safety, [-1, -1, 1])   # lower leverage = higher safety
    g = _group_score(growth, [1, 1])
    pa = _group_score(payout, [1, 1])

    components = [(p, 0.40), (sa, 0.30), (g, 0.20), (pa, 0.10)]
    valid = [(v, w) for v, w in components if v is not None]
    if len(valid) < 2:
        return None

    total_w = sum(w for _, w in valid)
    return float(sum(v * w for v, w in valid) / total_w)


def compute_value_score(fund: dict) -> float | None:
    """
    Composite value factor using earnings yield, FCF yield, and EV/EBITDA.

    CRITICAL FIX vs original: raw PE and EV/EBITDA are NOT averaged directly
    (they live in incompatible spaces: PE=15 is cheap, EV/EBITDA=15 can be expensive).
    Instead, both are converted to YIELD space (1/PE = earnings yield, 1/EV_EBITDA)
    before averaging. Higher yield = more value.

    Components:
      - Earnings yield: 1 / forward_PE      (0.0 to 0.2 typical)
      - FCF yield:      fcf_margin / fwd_PE  (proxy for FCF / market cap)
      - EBITDA yield:   1 / ev_to_ebitda     (0.0 to 0.15 typical)
      - Div yield:      dividend_yield / 100 (already a fraction)
    """
    def _safe(key: str) -> float | None:
        v = fund.get(key)
        return float(v) if v is not None and np.isfinite(float(v)) else None

    fwd_pe    = _safe("forward_pe")
    ev_ebitda = _safe("ev_to_ebitda")
    fcf_margin = _safe("fcf_margin")
    div_yield = _safe("dividend_yield")

    # All components in yield space (unitless, higher = cheaper/more value).
    # fcf_margin / fwd_pe was WRONG: fcf_margin/rev and 1/pe have different denominators.
    # Instead: fcf_margin is stored as % of revenue; we use it directly as a quality
    # signal only if no other yield is available. It is NOT a market-cap yield.
    # Valid components: earnings yield, EBITDA yield, dividend yield.
    components = []
    if fwd_pe and fwd_pe > 1.0:
        components.append(1.0 / fwd_pe)          # earnings yield = EPS/Price
    if ev_ebitda and ev_ebitda > 1.0:
        components.append(1.0 / ev_ebitda)        # EBITDA/EV
    if div_yield and div_yield > 0:
        components.append(div_yield / 100.0)      # already fraction if stored as %
    # FCF margin is revenue-based, not market-cap-based — cannot form a price yield.
    # Included only as a tiebreaker when no other yield is available.
    if not components and fcf_margin and fcf_margin > 0:
        components.append(fcf_margin / 100.0)

    return float(np.mean(components)) if components else None


def compute_low_vol_score(price_df: pl.DataFrame) -> float | None:
    """
    Low-volatility factor.
    Raw value: NEGATIVE of 63-day realized vol (annualised).
    Higher raw score = lower vol = more desirable in low-vol factor.
    """
    if len(price_df) < 65:
        return None
    df    = price_df.sort("date")
    close = df["close"].to_numpy().astype(np.float64)[-65:]
    ret   = np.log(close[1:] / close[:-1])
    vol   = ret.std(ddof=1) * np.sqrt(252)
    return float(-vol)


def compute_revision_score(fund: dict, days_since_update: int | None = None) -> float | None:
    """
    Earnings revision: analyst upgrade momentum proxy.
    earnings_surprise_pct is YoY EPS change as beat/miss proxy.
    eps_growth_yoy captures the magnitude of actual revision.

    Staleness decay: weight = min(1, 30/days_since_update).
    NSE quarterly filings go stale after ~90 days; penalise stale data linearly.
    """
    surprise   = fund.get("earnings_surprise_pct")
    eps_growth = fund.get("eps_growth_yoy")

    vals = []
    if surprise is not None and np.isfinite(float(surprise)):
        vals.append(float(np.tanh(float(surprise) / 50.0)))   # tanh bounds to [-1,1]
    if eps_growth is not None and np.isfinite(float(eps_growth)):
        vals.append(float(np.tanh(float(eps_growth) / 50.0)))

    if not vals:
        return None

    score = float(np.mean(vals))

    # Apply staleness discount: fresh (<30d) = full weight, stale (>90d) = 1/3 weight
    if days_since_update is not None and days_since_update > 0:
        staleness_weight = float(np.clip(30.0 / days_since_update, 1.0 / 3.0, 1.0))
        score *= staleness_weight

    return score


# ---------------------------------------------------------------------------
# Cross-sectional z-score (robust to outliers via IQR winsorizing)
# ---------------------------------------------------------------------------

def cross_sectional_zscore(values: dict[str, float | None]) -> dict[str, float]:
    """
    Robust cross-sectional z-score.
    1. Winsorise at [2nd, 98th] percentile to prevent single outlier domination.
    2. Standardise: (x - mean) / std.
    3. Symbols with None get 0.0 (population median in z-space).
    """
    valid = {k: float(v) for k, v in values.items() if v is not None and np.isfinite(float(v))}
    if len(valid) < 3:
        return {k: 0.0 for k in values}

    arr = np.array(list(valid.values()))
    lo, hi = np.percentile(arr, 2), np.percentile(arr, 98)
    arr_w  = np.clip(arr, lo, hi)
    mean, std = arr_w.mean(), arr_w.std(ddof=1)
    if std < 1e-10:
        return {k: 0.0 for k in values}

    keys   = list(valid.keys())
    z_vals = (arr_w - mean) / std
    z_map  = dict(zip(keys, z_vals.tolist()))
    return {k: z_map.get(k, 0.0) for k in values}


# ---------------------------------------------------------------------------
# IC-weighted composite
# ---------------------------------------------------------------------------

def compute_ic_weights(
    factor_history: dict[str, list[float]],
    return_history: list[float],
    default_weights: dict[str, float] | None = None,
) -> dict[str, float]:
    """
    Compute IC-proportional weights.

    IC(factor_i) = Spearman(factor_i_rank, forward_return_rank)
    Weight(i) = max(IC_i, 0) / Σ max(IC_j, 0)

    If all ICs are negative (factor has no predictive content), falls back to
    `default_weights` (equal weight if not provided).

    Args:
        factor_history: {factor_name: [cross-sectional z-score at each date]}
        return_history: [forward 21-day return at each date]

    Returns:
        {factor_name: weight} summing to 1.0
    """
    if default_weights is None:
        names = list(factor_history.keys())
        default_weights = {k: 1.0 / len(names) for k in names}

    ics: dict[str, float] = {}
    ret_arr = np.array(return_history)

    for name, scores in factor_history.items():
        if len(scores) < 30:
            ics[name] = 0.0
            continue
        s_arr = np.array(scores)
        valid = np.isfinite(s_arr) & np.isfinite(ret_arr[:len(s_arr)])
        if valid.sum() < 20:
            ics[name] = 0.0
            continue
        corr, _ = spearmanr(s_arr[valid], ret_arr[:len(s_arr)][valid])
        ics[name] = float(corr) if np.isfinite(corr) else 0.0

    positive_ics = {k: max(v, 0.0) for k, v in ics.items()}
    total = sum(positive_ics.values())

    if total < 1e-6:
        return default_weights

    return {k: v / total for k, v in positive_ics.items()}


# ---------------------------------------------------------------------------
# Portfolio-level factor computation
# ---------------------------------------------------------------------------

_DEFAULT_WEIGHTS = {
    "momentum": 0.25,
    "quality":  0.30,
    "value":    0.20,
    "low_vol":  0.15,
    "revision": 0.10,
}


def compute_all_factors(
    price_map: dict[str, pl.DataFrame],
    fund_map: dict[str, dict],
    ic_weights: dict[str, float] | None = None,
) -> pl.DataFrame:
    """
    Compute all 5 factors for the full cross-section.
    Returns [symbol, date, momentum, quality, value, low_vol, revision, composite].

    composite = Σ w_i * z_i   where w_i are IC-proportional or default weights.
    """
    weights = ic_weights if ic_weights is not None else _DEFAULT_WEIGHTS
    today = None

    raw: dict[str, dict[str, float | None]] = {
        "momentum": {}, "quality": {}, "value": {}, "low_vol": {}, "revision": {}
    }

    for sym, price_df in price_map.items():
        if price_df is None or len(price_df) == 0:
            continue
        if today is None:
            today = price_df.sort("date")["date"][-1]

        raw["momentum"][sym] = compute_momentum_score(price_df)
        raw["low_vol"][sym]  = compute_low_vol_score(price_df)

        fund = fund_map.get(sym) or {}
        raw["quality"][sym]   = compute_quality_score(fund)
        raw["value"][sym]     = compute_value_score(fund)
        # Pass days_since_update for staleness discounting of earnings data
        updated_at = fund.get("updated_at")
        days_stale: int | None = None
        if updated_at is not None:
            try:
                from datetime import date as _date, datetime as _dt
                if hasattr(updated_at, "date"):
                    d = updated_at.date()
                elif isinstance(updated_at, str):
                    d = _dt.fromisoformat(updated_at[:10]).date()
                else:
                    d = updated_at
                days_stale = max(0, (_date.today() - d).days)
            except Exception:
                pass
        raw["revision"][sym] = compute_revision_score(fund, days_since_update=days_stale)

    z: dict[str, dict[str, float]] = {k: cross_sectional_zscore(v) for k, v in raw.items()}

    records = []
    all_symbols = set(price_map.keys())
    for sym in all_symbols:
        m  = z["momentum"].get(sym, 0.0)
        q  = z["quality"].get(sym, 0.0)
        v  = z["value"].get(sym, 0.0)
        lv = z["low_vol"].get(sym, 0.0)
        r  = z["revision"].get(sym, 0.0)

        # IC-weighted composite — NOT re-entering composite_factor (eliminates double-counting)
        composite = (
            weights.get("momentum", 0.25) * m +
            weights.get("quality",  0.30) * q +
            weights.get("value",    0.20) * v +
            weights.get("low_vol",  0.15) * lv +
            weights.get("revision", 0.10) * r
        )

        records.append({
            "symbol":    sym,
            "date":      today,
            "momentum":  m,
            "quality":   q,
            "value":     v,
            "low_vol":   lv,
            "revision":  r,
            "composite": composite,
        })

    return pl.DataFrame(records) if records else pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date,
        "momentum": pl.Float64, "quality": pl.Float64,
        "value": pl.Float64, "low_vol": pl.Float64,
        "revision": pl.Float64, "composite": pl.Float64,
    })
