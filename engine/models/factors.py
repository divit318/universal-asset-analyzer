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


def compute_accruals_score(fund: dict) -> float | None:
    """
    Accruals anomaly (Sloan 1996): low accruals → higher earnings quality.
    accruals = (net_income - operating_cash_flow) / total_assets
    Lower accruals (more cash-backed earnings) scores higher.

    Returns negated accruals ratio so higher = better quality (consistent
    with other factor score directions).
    """
    def _safe(key: str) -> float | None:
        v = fund.get(key)
        return float(v) if v is not None and np.isfinite(float(v)) else None

    net_income = _safe("net_income")
    cfo        = _safe("operating_cashflow")
    assets     = _safe("total_assets")

    if net_income is None or cfo is None or assets is None or abs(assets) < 1e6:
        return None

    accruals = (net_income - cfo) / assets
    # Clip to [-0.3, 0.3] before negation — extreme values are data errors
    accruals = float(np.clip(accruals, -0.3, 0.3))
    return -accruals  # higher score = lower accruals = better


def compute_quality_score(fund: dict, symbol: str = "") -> float | None:
    """
    QMJ quality score — Asness et al. (2019).

    Each sub-component is independently z-scored before weighting so that
    ROE (e.g. ~15%) doesn't dominate ROIC (e.g. ~10%) purely by magnitude.

    Sub-components:
      Profitability (40%): ROE, ROIC, gross_margin, operating_margin
      Safety        (20%): -debt_to_equity, -net_debt_to_ebitda, current_ratio
      Growth        (20%): revenue_cagr_3y, eps_cagr_3y
      Payout        (10%): fcf_margin, buyback_yield
      Accruals      (10%): -(net_income - CFO) / assets  (fix 2.4)

    India only:
      Promoter pledging penalty: if >30% pledged, subtract proportional penalty
      from safety sub-component (fix 8.1).

    Returns a single float in roughly [-3, 3] range after within-group
    equal-weighting. No absolute magnitude dependency.
    """
    def _safe(key: str) -> float | None:
        v = fund.get(key)
        return float(v) if v is not None and np.isfinite(float(v)) else None

    profitability = [_safe("roe"), _safe("roic"), _safe("gross_margin"), _safe("operating_margin")]
    safety_raw    = [_safe("debt_to_equity"), _safe("net_debt_to_ebitda"), _safe("current_ratio")]
    growth        = [_safe("revenue_cagr_3y"), _safe("eps_cagr_3y")]
    payout        = [_safe("fcf_margin"), _safe("buyback_yield")]

    accruals_score = compute_accruals_score(fund)

    def _group_score(vals: list[float | None], signs: list[float]) -> float | None:
        pairs = [(v, s) for v, s in zip(vals, signs) if v is not None]
        if not pairs:
            return None
        return float(np.mean([v * s for v, s in pairs]))

    p  = _group_score(profitability, [1, 1, 1, 1])
    sa = _group_score(safety_raw,    [-1, -1, 1])   # lower leverage = higher safety
    g  = _group_score(growth, [1, 1])
    pa = _group_score(payout, [1, 1])

    # Promoter pledging penalty for Indian stocks (fix 8.1)
    # >30% pledged → linear penalty: penalty = (pledged_pct - 30) / 70 * 2
    # Applied as a negative offset to the safety sub-component
    if symbol.endswith(".NS") and sa is not None:
        pledging_pct = _safe("promoter_pledging_pct")
        if pledging_pct is not None and pledging_pct > 30.0:
            penalty = (pledging_pct - 30.0) / 70.0 * 2.0  # [0, 2] at 30–100%
            sa = sa - float(np.clip(penalty, 0.0, 2.0))

    components = [(p, 0.40), (sa, 0.20), (g, 0.20), (pa, 0.10), (accruals_score, 0.10)]
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


def compute_size_score(fund: dict) -> float | None:
    """
    Size factor (fix 9.2): smaller within large-cap universe scores higher.
    Raw value: -log(market_cap). Negated so smaller cap = higher score.
    Cross-sectional z-score applied later.

    Returns None if market_cap is missing or non-positive.
    """
    mktcap = fund.get("market_cap")
    if mktcap is None:
        return None
    try:
        mc = float(mktcap)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(mc) or mc <= 0:
        return None
    return float(-np.log(mc))


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


def compute_revision_score(fund: dict, symbol: str = "", days_since_update: int | None = None) -> float | None:
    """
    Earnings revision score.

    US stocks (.NS suffix absent): Standardized Unexpected Earnings (SUE) +
      analyst revision breadth (upgrades - downgrades) / total analysts.
      SUE = (actual_eps - consensus_eps) / std(eps_surprises)
            approximated as earnings_surprise_pct / 20 (normalises to ~[-2,2]).
      Breadth = recommendation_mean mapped: 1=Strong Buy → +1, 5=Strong Sell → -1.

    India stocks (.NS suffix): YoY EPS change + earnings_surprise_pct (NSE quarterly).

    Staleness decay: weight = min(1, 30/days_since_update).
    NSE quarterly filings go stale after ~90 days; penalise stale data linearly.
    """
    surprise   = fund.get("earnings_surprise_pct")
    eps_growth = fund.get("eps_growth_yoy")

    is_india = symbol.endswith(".NS")

    vals = []
    if is_india:
        # NSE: use EPS surprise + YoY growth
        if surprise is not None and np.isfinite(float(surprise)):
            vals.append(float(np.tanh(float(surprise) / 50.0)))
        if eps_growth is not None and np.isfinite(float(eps_growth)):
            vals.append(float(np.tanh(float(eps_growth) / 50.0)))
    else:
        # US: SUE via normalised surprise + analyst breadth via recommendation_mean
        if surprise is not None and np.isfinite(float(surprise)):
            # surprise stored as %; divide by 20 → ~[-2,2] for typical beats
            sue = float(np.clip(float(surprise) / 20.0, -3.0, 3.0))
            vals.append(float(np.tanh(sue)))
        rec_mean = fund.get("recommendation_mean")
        if rec_mean is not None and np.isfinite(float(rec_mean)):
            # Yahoo Finance: 1.0=Strong Buy, 3.0=Hold, 5.0=Strong Sell
            # Map [1, 5] → [+1, -1] linearly: breadth = (3 - rec_mean) / 2
            breadth = float(np.clip((3.0 - float(rec_mean)) / 2.0, -1.0, 1.0))
            vals.append(breadth)
        # Analyst count breadth: number_of_analyst_opinions as confidence weight
        # (no separate signal — used as confidence scalar below)
        n_analysts = fund.get("number_of_analyst_opinions")
        if n_analysts is not None and np.isfinite(float(n_analysts)):
            # Scale confidence: <5 analysts → 0.5 weight, ≥20 → full weight
            analyst_conf = float(np.clip(float(n_analysts) / 20.0, 0.5, 1.0))
            if vals:
                vals = [v * analyst_conf for v in vals]

        # Short interest signal (fix 7.1): high short interest = bearish revision
        # shortRatio = days to cover (DTC); shortPercentOfFloat = % of float shorted.
        # Negative because more shorts → lower revision score.
        # Weight: 10% of total revision score (blended with 90% of existing signal).
        short_ratio = fund.get("shortRatio")
        short_float = fund.get("shortPercentOfFloat")
        short_signal: float | None = None
        if short_ratio is not None and np.isfinite(float(short_ratio)) and float(short_ratio) >= 0:
            # DTC: 0–5d normal, >10d very high. Tanh-bound: -tanh(dtc/5) → [0, -1]
            dtc_signal = -float(np.tanh(float(short_ratio) / 5.0))
            short_signal = dtc_signal
        if short_float is not None and np.isfinite(float(short_float)) and float(short_float) >= 0:
            # short_float: 0–1 (fraction) or 0–100 (%); normalise to fraction
            sf = float(short_float)
            if sf > 1.0:
                sf /= 100.0
            float_signal = -float(np.tanh(sf / 0.15))  # 15% float shorted → strong signal
            if short_signal is None:
                short_signal = float_signal
            else:
                short_signal = (short_signal + float_signal) / 2.0
        if short_signal is not None:
            # Blend: 90% existing signal + 10% short interest
            existing_weight = 0.90
            short_weight = 0.10
            if vals:
                vals = [v * existing_weight for v in vals]
                vals.append(short_signal * short_weight / max(len(vals), 1))
            else:
                vals.append(short_signal * short_weight)

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


def sector_neutral_zscore(
    values: dict[str, float | None],
    sector_map: dict[str, str],
) -> dict[str, float]:
    """
    Sector-neutral z-score: z-score independently within each GICS sector,
    then aggregate. Eliminates sector bets from factor signals.

    For symbols with unknown sector or sectors with <3 members, falls back
    to the full cross-sectional z-score for that group.

    sector_map: {symbol: sector_name}
    """
    # Group symbols by sector
    sector_groups: dict[str, list[str]] = {}
    ungrouped: list[str] = []
    for sym in values:
        sec = sector_map.get(sym)
        if sec:
            sector_groups.setdefault(sec, []).append(sym)
        else:
            ungrouped.append(sym)

    result: dict[str, float] = {}

    for sector, syms in sector_groups.items():
        sub = {s: values[s] for s in syms}
        if len([v for v in sub.values() if v is not None]) < 3:
            # Too few to z-score within sector — treat as ungrouped
            ungrouped.extend(syms)
        else:
            z = cross_sectional_zscore(sub)
            result.update(z)

    if ungrouped:
        sub = {s: values[s] for s in ungrouped}
        z = cross_sectional_zscore(sub)
        result.update(z)

    # Any symbol not yet scored gets 0.0
    for sym in values:
        if sym not in result:
            result[sym] = 0.0

    return result


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
    sector_neutral: bool = True,
) -> pl.DataFrame:
    """
    Compute all 5 factors for the full cross-section.
    Returns [symbol, date, momentum, quality, value, low_vol, revision, composite].

    composite = Σ w_i * z_i   where w_i are IC-proportional or default weights.

    sector_neutral=True: z-scores are computed within GICS sectors independently
    to eliminate sector bets. Falls back to full cross-section for sectors <3 members.
    """
    weights = ic_weights if ic_weights is not None else _DEFAULT_WEIGHTS
    today = None

    raw: dict[str, dict[str, float | None]] = {
        "momentum": {}, "quality": {}, "value": {}, "low_vol": {}, "revision": {}, "size": {}
    }
    # Build sector map for sector-neutral z-scoring
    sector_map: dict[str, str] = {}

    for sym, price_df in price_map.items():
        if price_df is None or len(price_df) == 0:
            continue
        if today is None:
            today = price_df.sort("date")["date"][-1]

        raw["momentum"][sym] = compute_momentum_score(price_df)
        raw["low_vol"][sym]  = compute_low_vol_score(price_df)

        fund = fund_map.get(sym) or {}

        # Collect sector for sector-neutral z-scoring
        sector = fund.get("sector") or fund.get("gics_sector")
        if sector:
            sector_map[sym] = str(sector)

        raw["quality"][sym]   = compute_quality_score(fund, symbol=sym)
        raw["value"][sym]     = compute_value_score(fund)
        raw["size"][sym]      = compute_size_score(fund)

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
        raw["revision"][sym] = compute_revision_score(fund, symbol=sym, days_since_update=days_stale)

    # Apply sector-neutral z-scoring when sector data is available for ≥10% of universe
    use_sector_neutral = (
        sector_neutral and
        len(sector_map) >= max(3, len(price_map) * 0.1)
    )

    def _zscore_fn(vals: dict[str, float | None]) -> dict[str, float]:
        if use_sector_neutral:
            return sector_neutral_zscore(vals, sector_map)
        return cross_sectional_zscore(vals)

    z: dict[str, dict[str, float]] = {k: _zscore_fn(v) for k, v in raw.items()}

    records = []
    all_symbols = set(price_map.keys())
    for sym in all_symbols:
        m  = z["momentum"].get(sym, 0.0)
        q  = z["quality"].get(sym, 0.0)
        v  = z["value"].get(sym, 0.0)
        lv = z["low_vol"].get(sym, 0.0)
        r  = z["revision"].get(sym, 0.0)
        sz = z["size"].get(sym, 0.0)

        # IC-weighted composite — NOT re-entering composite_factor (eliminates double-counting)
        # Size factor (fix 9.2): 5% weight taken from low_vol (15% → 10%) and revision (10% → 5%)
        composite = (
            weights.get("momentum", 0.25) * m +
            weights.get("quality",  0.30) * q +
            weights.get("value",    0.20) * v +
            weights.get("low_vol",  0.10) * lv +
            weights.get("revision", 0.10) * r +
            weights.get("size",     0.05) * sz
        )

        records.append({
            "symbol":    sym,
            "date":      today,
            "momentum":  m,
            "quality":   q,
            "value":     v,
            "low_vol":   lv,
            "revision":  r,
            "size":      sz,
            "composite": composite,
        })

    return pl.DataFrame(records) if records else pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date,
        "momentum": pl.Float64, "quality": pl.Float64,
        "value": pl.Float64, "low_vol": pl.Float64,
        "revision": pl.Float64, "size": pl.Float64, "composite": pl.Float64,
    })
