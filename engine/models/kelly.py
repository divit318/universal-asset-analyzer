"""
Kelly criterion + Equal Risk Contribution (ERC) portfolio optimizer.
Fractional Kelly (0.25x) with vol targeting overlay.
"""

from __future__ import annotations

import numpy as np
import polars as pl
from scipy.optimize import minimize


KELLY_FRACTION = 0.25   # fractional Kelly multiplier
MAX_POSITION = 0.15     # cap any single position at 15%
MIN_POSITION = 0.0      # no short selling
VOL_TARGET = 0.12       # 12% annualized portfolio vol target


def fractional_kelly(
    expected_returns: np.ndarray,
    cov_matrix: np.ndarray,
    kelly_fraction: float = KELLY_FRACTION,
    max_pos: float = MAX_POSITION,
) -> np.ndarray:
    """
    Full Kelly: w* = Σ^{-1} * μ / (μᵀ Σ^{-1} μ), then scale by kelly_fraction.
    Clips to [0, max_pos] and renormalizes.
    """
    n = len(expected_returns)
    try:
        cov_inv = np.linalg.pinv(cov_matrix)
        w_full = cov_inv @ expected_returns
        # Normalize to long-only
        w_full = np.clip(w_full, 0, None)
        total = w_full.sum()
        if total > 0:
            w_full = w_full / total
        else:
            w_full = np.ones(n) / n
    except np.linalg.LinAlgError:
        w_full = np.ones(n) / n

    w_kelly = kelly_fraction * w_full
    # Remaining weight to cash (implicit)
    w_kelly = np.clip(w_kelly, 0, max_pos)
    total = w_kelly.sum()
    if total > 0:
        w_kelly = w_kelly / total
    return w_kelly


def equal_risk_contribution(
    cov_matrix: np.ndarray,
    max_iter: int = 1000,
    tol: float = 1e-8,
) -> np.ndarray:
    """
    Equal Risk Contribution (Risk Parity) via CCD/gradient descent.
    Each asset contributes equally to portfolio variance.
    """
    n = cov_matrix.shape[0]
    w = np.ones(n) / n

    def portfolio_vol(w: np.ndarray) -> float:
        return float(np.sqrt(w @ cov_matrix @ w))

    def risk_contributions(w: np.ndarray) -> np.ndarray:
        pv = portfolio_vol(w)
        if pv < 1e-10:
            return np.zeros(n)
        mrc = cov_matrix @ w  # marginal risk contributions
        return w * mrc / pv   # risk contributions

    def erc_objective(w: np.ndarray) -> float:
        rc = risk_contributions(w)
        target = np.full(n, rc.sum() / n)
        return float(np.sum((rc - target) ** 2))

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}]
    bounds = [(0.0, MAX_POSITION)] * n

    result = minimize(
        erc_objective,
        w,
        method="SLSQP",
        bounds=bounds,
        constraints=constraints,
        options={"maxiter": max_iter, "ftol": tol},
    )

    if result.success:
        w_opt = result.x
        w_opt = np.clip(w_opt, 0, MAX_POSITION)
        return w_opt / w_opt.sum()
    return w


def vol_target_scale(
    weights: np.ndarray,
    cov_matrix: np.ndarray,
    target_vol: float = VOL_TARGET,
) -> np.ndarray:
    """
    Scale portfolio weights to hit target annual volatility.
    """
    port_vol = float(np.sqrt(weights @ cov_matrix @ weights))
    if port_vol < 1e-10:
        return weights
    scale = min(target_vol / port_vol, 2.0)  # cap leverage at 2x
    return weights * scale


def compute_position_sizes(
    symbols: list[str],
    factor_scores: dict[str, float],
    price_map: dict[str, pl.DataFrame],
    method: str = "erc",
) -> dict[str, float]:
    """
    Compute optimal position sizes for a universe of symbols.

    Args:
        symbols: list of symbols
        factor_scores: {symbol: composite_factor_score} for return expectations
        price_map: {symbol: price_df} for covariance estimation
        method: "kelly" | "erc" | "blend" (0.5 kelly + 0.5 erc)

    Returns:
        {symbol: weight} summing to <= 1.0
    """
    n = len(symbols)
    if n == 0:
        return {}

    # Build return vector from factor scores (z-scores → expected excess return)
    # Map z-score to expected annual return: each z-unit ≈ 3% alpha
    mu = np.array([factor_scores.get(s, 0.0) * 0.03 for s in symbols])
    # Add small risk-free floor
    mu = mu + 0.02

    # Estimate covariance from rolling 63-day returns
    return_matrix = _build_return_matrix(symbols, price_map, window=63)
    if return_matrix is None or return_matrix.shape[0] < 20:
        # Fall back to diagonal (equal vol assumption)
        vols = np.full(n, 0.20)
        cov = np.diag(vols ** 2)
    else:
        cov = np.cov(return_matrix.T) * 252
        if cov.ndim == 0:
            cov = np.array([[float(cov)]])

    if method == "kelly":
        weights = fractional_kelly(mu, cov)
    elif method == "erc":
        weights = equal_risk_contribution(cov)
    else:  # blend
        w_kelly = fractional_kelly(mu, cov)
        w_erc = equal_risk_contribution(cov)
        weights = 0.5 * w_kelly + 0.5 * w_erc
        weights = weights / weights.sum()

    weights = vol_target_scale(weights, cov, VOL_TARGET)

    return {symbols[i]: float(np.clip(weights[i], 0, MAX_POSITION)) for i in range(n)}


def _build_return_matrix(
    symbols: list[str],
    price_map: dict[str, pl.DataFrame],
    window: int = 63,
) -> np.ndarray | None:
    """Build T×N return matrix from recent price data."""
    cols = []
    for sym in symbols:
        df = price_map.get(sym)
        if df is None or len(df) < window + 1:
            return None
        close = df.sort("date")["close"].tail(window + 1).to_numpy().astype(np.float64)
        ret = np.diff(np.log(close))
        cols.append(ret)
    if not cols:
        return None
    return np.column_stack(cols)


def kelly_fraction_single(
    prob_up: float,
    expected_gain: float,
    expected_loss: float,
    kelly_frac: float = KELLY_FRACTION,
    live_ic: float | None = None,
) -> float:
    """
    Simple Kelly for binary outcome: f = (p*b - q) / b
    where b = expected_gain / expected_loss.

    IC-adaptive scaling (fix 9.1):
    When live_ic is provided, the Kelly fraction is scaled by IC strength:
      ic_scale = max(0, live_ic) / IC_REFERENCE  (IC_REFERENCE = 0.05)
      kelly_frac_effective = kelly_frac * clip(ic_scale, 0, 1)

    This ensures Kelly→0 as live_IC→0, preventing position sizing on
    a model that has lost predictive content.
    """
    if expected_loss <= 0 or expected_gain <= 0:
        return 0.0
    b = expected_gain / expected_loss
    q = 1.0 - prob_up
    f = (prob_up * b - q) / b

    effective_frac = kelly_frac
    if live_ic is not None:
        IC_REFERENCE = 0.05  # IC at which full Kelly fraction is applied
        ic_scale = float(np.clip(max(0.0, live_ic) / IC_REFERENCE, 0.0, 1.0))
        effective_frac = kelly_frac * ic_scale

    return float(np.clip(f * effective_frac, 0.0, MAX_POSITION))
