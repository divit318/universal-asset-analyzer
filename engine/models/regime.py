"""HMM regime detection — 5 states: Bull / Bear / Range / Crash / Recovery."""

from __future__ import annotations

import numpy as np
import polars as pl
from hmmlearn.hmm import GaussianHMM

REGIME_LABELS = {0: "Bull", 1: "Bear", 2: "Range", 3: "Crash", 4: "Recovery"}

# State order by expected mean return (mapped after training via sort)
N_STATES = 5


def _make_obs(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """
    Build 3-feature observation matrix:
    [log_return_1d, realized_vol_5d, log_volume_ratio]

    Zero-volume handling: replace zeros with median volume before computing log ratio
    to avoid log(0) = -inf which propagates NaN into HMM startprob_.
    """
    ret = np.diff(np.log(close), prepend=np.nan)
    vol5 = np.array([
        ret[max(0, i - 4) : i + 1].std() * np.sqrt(252) if i >= 4 else np.nan
        for i in range(len(ret))
    ])
    # Replace zero/negative volume with median to avoid log(0) = -inf
    vol_clean = volume.copy()
    median_vol = np.median(vol_clean[vol_clean > 0]) if np.any(vol_clean > 0) else 1.0
    vol_clean[vol_clean <= 0] = median_vol

    vol_ma20 = np.array([
        vol_clean[max(0, i - 19) : i + 1].mean() if i >= 19 else vol_clean[:i + 1].mean()
        for i in range(len(vol_clean))
    ])
    log_vol_ratio = np.log(vol_clean / (vol_ma20 + 1e-10))

    obs = np.column_stack([ret, vol5, log_vol_ratio])
    # Remove rows with any NaN or Inf (leading rows, and any inf from log of bad prices)
    valid = ~np.any(~np.isfinite(obs), axis=1)
    return obs, valid


def train_hmm(close: np.ndarray, volume: np.ndarray, n_iter: int = 200) -> GaussianHMM:
    """
    Train a Gaussian HMM with N_STATES states.
    Returns trained model.
    """
    obs, valid = _make_obs(close, volume)
    obs_clean = obs[valid]

    model = GaussianHMM(
        n_components=N_STATES,
        covariance_type="diag",
        n_iter=n_iter,
        random_state=42,
        tol=1e-4,
    )
    model.fit(obs_clean)
    return model


def _map_states(model: GaussianHMM) -> dict[int, int]:
    """
    Map raw HMM state IDs to semantic labels 0-4 by sorting on mean return.
    Returns raw_state → semantic_state.
    """
    mean_returns = model.means_[:, 0]  # first feature is log_return_1d
    mean_vols = model.means_[:, 1]     # second feature is vol

    # Sort by return (desc): Bull=highest, Crash=lowest, then assign others by vol
    sorted_by_ret = np.argsort(mean_returns)[::-1]  # highest to lowest

    # Semantic assignment heuristic:
    # - highest return, moderate vol → Bull (0)
    # - lowest return, high vol → Crash (3)
    # - 2nd lowest return, moderate/low vol → Bear (1)
    # - mid return, lowest vol → Range (2)
    # - 2nd highest return, highest vol → Recovery (4)
    raw_to_semantic: dict[int, int] = {}
    n = N_STATES
    # Simple assignment: rank by return
    semantic_order = [0, 4, 2, 1, 3]  # Bull, Recovery, Range, Bear, Crash
    for rank, raw in enumerate(sorted_by_ret):
        raw_to_semantic[int(raw)] = semantic_order[rank]
    return raw_to_semantic


def predict_regimes(
    model: GaussianHMM,
    close: np.ndarray,
    volume: np.ndarray,
    dates: list,
    symbol: str,
) -> pl.DataFrame:
    """
    Run Viterbi + forward-backward on price series.
    Returns DuckDB-ready DataFrame [symbol, date, regime, regime_label, prob_*].
    """
    obs, valid = _make_obs(close, volume)
    obs_clean = obs[valid]

    state_seq = model.predict(obs_clean)
    posteriors = model.predict_proba(obs_clean)

    state_map = _map_states(model)

    # Build full-length arrays (NaN for leading invalid rows)
    n_total = len(close)
    n_valid = obs_clean.shape[0]
    offset = n_total - n_valid

    semantic_seq = np.full(n_total, -1, dtype=np.int32)
    probs = np.full((n_total, N_STATES), np.nan)

    for i, raw in enumerate(state_seq):
        sem = state_map[int(raw)]
        semantic_seq[offset + i] = sem

    # posteriors columns = raw state IDs 0..N_STATES-1 in model order
    for raw_state, sem_state in state_map.items():
        probs[offset:, sem_state] = posteriors[:, raw_state]

    records = []
    for i, date in enumerate(dates):
        sem = int(semantic_seq[i])
        if sem < 0:
            continue
        records.append({
            "symbol": symbol,
            "date": date,
            "regime": sem,
            "regime_label": REGIME_LABELS[sem],
            "prob_bull": float(probs[i, 0]) if np.isfinite(probs[i, 0]) else None,
            "prob_bear": float(probs[i, 1]) if np.isfinite(probs[i, 1]) else None,
            "prob_range": float(probs[i, 2]) if np.isfinite(probs[i, 2]) else None,
            "prob_crash": float(probs[i, 3]) if np.isfinite(probs[i, 3]) else None,
            "prob_recovery": float(probs[i, 4]) if np.isfinite(probs[i, 4]) else None,
        })

    return pl.DataFrame(records, infer_schema_length=len(records)) if records else pl.DataFrame(
        schema={
            "symbol": pl.Utf8, "date": pl.Date,
            "regime": pl.Int32, "regime_label": pl.Utf8,
            "prob_bull": pl.Float64, "prob_bear": pl.Float64,
            "prob_range": pl.Float64, "prob_crash": pl.Float64,
            "prob_recovery": pl.Float64,
        }
    )


def run_regime_detection(
    price_df: pl.DataFrame,
    symbol: str,
    n_iter: int = 200,
) -> pl.DataFrame:
    """End-to-end: train HMM on full history and return regime DataFrame."""
    if len(price_df) < 126:
        return pl.DataFrame(schema={
            "symbol": pl.Utf8, "date": pl.Date,
            "regime": pl.Int32, "regime_label": pl.Utf8,
            "prob_bull": pl.Float64, "prob_bear": pl.Float64,
            "prob_range": pl.Float64, "prob_crash": pl.Float64,
            "prob_recovery": pl.Float64,
        })

    df = price_df.sort("date")
    close = df["close"].to_numpy().astype(np.float64)
    volume = df["volume"].fill_null(0).to_numpy().astype(np.float64)
    dates = df["date"].to_list()

    model = train_hmm(close, volume, n_iter=n_iter)
    return predict_regimes(model, close, volume, dates, symbol)
