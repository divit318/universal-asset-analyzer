"""
HMM regime detection — 5 states: Bull / Bear / Range / Crash / Recovery.

Architecture (fix 3.1):
  - Train ONE HMM per market index (^GSPC for US, ^NSEI for India), not per stock.
  - Stock-level regime signal = index regime scaled by stock's rolling beta.
  - fit_market_regime(index_df) → GaussianHMM (cached by caller)
  - predict_regimes_from_index(index_model, stock_df, beta, symbol) → DataFrame
  - run_regime_detection() kept for backward compatibility / standalone use.

BIC state selection (fix 3.3):
  - fit_market_regime() automatically selects optimal state count via BIC.
  - Candidates: 3, 4, 5, 6 states. BIC = -2*logL + n_params*log(n_obs).
  - n_params = n_states*(n_states - 1) + n_states*n_features + n_states*n_features
    (transition matrix + means + diag covariances).
  - State semantic mapping generalised: always maps by return rank.

FII flow augmentation (fix 8.2):
  - fit_market_regime() accepts optional macro_features dict.
  - When provided, appends macro features as additional HMM observation dimensions.
  - US: vix_zscore, yield_curve_2s10s; India: india_vix_zscore, fii_net_flow_norm.
"""

from __future__ import annotations

import warnings
import numpy as np
import polars as pl
from hmmlearn.hmm import GaussianHMM

warnings.filterwarnings("ignore", message="Model is not converging", category=UserWarning)
warnings.filterwarnings("ignore", message="Some rows of transmat_", category=UserWarning)
warnings.filterwarnings("ignore", message="transmat_ rows", category=UserWarning)

REGIME_LABELS = {0: "Bull", 1: "Bear", 2: "Range", 3: "Crash", 4: "Recovery"}

# State order by expected mean return (mapped after training via sort)
N_STATES = 5
_BIC_CANDIDATES = [3, 4, 5, 6]


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


def _bic(model: GaussianHMM, obs: np.ndarray) -> float:
    """
    BIC = -2*logL + n_params*log(n_obs).
    n_params = transition matrix (k*(k-1)) + means (k*d) + diag covs (k*d).
    """
    try:
        log_likelihood = model.score(obs)
    except Exception:
        return np.inf
    k = model.n_components
    d = obs.shape[1]
    n_params = k * (k - 1) + k * d + k * d   # trans + means + diag covariances
    n_obs = obs.shape[0]
    return -2.0 * log_likelihood * n_obs + n_params * np.log(n_obs)


def train_hmm(
    close: np.ndarray,
    volume: np.ndarray,
    n_iter: int = 200,
    extra_obs: np.ndarray | None = None,
) -> GaussianHMM:
    """
    Train a Gaussian HMM with BIC-selected state count (fix 3.3).
    Candidate state counts: 3–6. Runs 3 restarts per candidate.
    Returns the model with the lowest BIC across all candidates and restarts.

    extra_obs: optional (T, d_extra) array of additional observation features
               (e.g. macro features for FII/VIX augmentation, fix 8.2).
               Appended column-wise to the standard 3-feature observation matrix.
               Must be aligned to same valid rows — caller responsibility.
    """
    obs, valid = _make_obs(close, volume)
    obs_clean = obs[valid]

    if extra_obs is not None:
        # extra_obs must be full-length (same as close); slice to valid rows
        extra_valid = extra_obs[valid]
        # Replace NaN/inf in extra_obs with 0 (mean-imputation)
        extra_valid = np.where(np.isfinite(extra_valid), extra_valid, 0.0)
        obs_clean = np.column_stack([obs_clean, extra_valid])

    min_required = max(_BIC_CANDIDATES) * 10
    if len(obs_clean) < min_required:
        raise ValueError(f"Insufficient valid observations for HMM: {len(obs_clean)} rows after NaN/inf filter")

    best_model = None
    best_bic = np.inf

    for n_states in _BIC_CANDIDATES:
        if len(obs_clean) < n_states * 10:
            continue
        for seed in (42, 43, 44):
            model = GaussianHMM(
                n_components=n_states,
                covariance_type="diag",
                n_iter=n_iter,
                random_state=seed,
                tol=1e-4,
            )
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model.fit(obs_clean)
                # Skip degenerate models where any state is unreachable
                if hasattr(model, "transmat_") and np.any(model.transmat_.sum(axis=1) < 1e-8):
                    continue
                bic = _bic(model, obs_clean)
            except Exception:
                continue
            if bic < best_bic:
                best_bic = bic
                best_model = model

    if best_model is None:
        raise ValueError("All HMM candidates failed to train")
    return best_model


def _map_states(model: GaussianHMM) -> dict[int, int]:
    """
    Map raw HMM state IDs to semantic labels by return rank.
    Works for any BIC-selected state count (3–6).

    Semantic assignment by return rank (highest to lowest):
      rank 0 → Bull (0)
      rank 1 → Recovery (4)
      rank 2 → Range (2)
      rank 3 → Bear (1)
      rank 4 → Crash (3)
      ranks beyond 4 → Range (2)  [extra states from BIC=6 mapped to Range]
    """
    mean_returns = model.means_[:, 0]  # first feature is log_return_1d
    sorted_by_ret = np.argsort(mean_returns)[::-1]  # highest to lowest

    # Semantic labels by rank position (for up to 6 states)
    _RANK_TO_SEMANTIC = [0, 4, 2, 1, 3, 2]   # Bull, Recovery, Range, Bear, Crash, Range
    raw_to_semantic: dict[int, int] = {}
    for rank, raw in enumerate(sorted_by_ret):
        sem = _RANK_TO_SEMANTIC[rank] if rank < len(_RANK_TO_SEMANTIC) else 2
        raw_to_semantic[int(raw)] = sem
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

    if len(obs_clean) == 0:
        raise ValueError("No valid observations after NaN/inf filter in predict_regimes")

    state_seq = model.predict(obs_clean)
    posteriors = model.predict_proba(obs_clean)

    state_map = _map_states(model)
    n_sem = 5  # always 5 semantic states regardless of BIC-selected count

    # Build full-length arrays (NaN for leading invalid rows)
    n_total = len(close)
    n_valid = obs_clean.shape[0]
    offset = n_total - n_valid

    semantic_seq = np.full(n_total, -1, dtype=np.int32)
    probs = np.full((n_total, n_sem), np.nan)

    for i, raw in enumerate(state_seq):
        sem = state_map[int(raw)]
        semantic_seq[offset + i] = sem

    # Accumulate posteriors into semantic slots (multiple raw states may map to same semantic)
    probs[offset:, :] = 0.0
    for raw_state, sem_state in state_map.items():
        probs[offset:, sem_state] += posteriors[:, raw_state]

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


def fit_market_regime(
    index_df: pl.DataFrame,
    n_iter: int = 200,
    macro_features: dict[str, float | None] | None = None,
) -> GaussianHMM | None:
    """
    Train a single HMM on the market index price series with BIC state selection (fix 3.3).
    Returns the trained model, or None on insufficient data.

    macro_features (fix 8.2): optional dict of scalar macro signals.
      US:    {"vix_zscore": float, "yield_curve_2s10s": float}
      India: {"india_vix_zscore": float, "fii_net_flow_norm": float}
    When provided, each non-None scalar is broadcast to a constant column in the
    observation matrix. This encodes the current macro regime into HMM training.
    Only the latest macro snapshot is available (not historical), so we broadcast
    a constant feature — this biases the HMM toward current macro state.

    Caller should cache this per session:
        _us_regime_model = fit_market_regime(gspc_price_df, macro_features=us_macro)
        _india_regime_model = fit_market_regime(nsei_price_df, macro_features=india_macro)
    """
    df = index_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    if len(df) < 252:
        return None
    close  = df["close"].to_numpy().astype(np.float64)
    volume = df["volume"].fill_null(0).to_numpy().astype(np.float64)

    # Build extra_obs from macro_features (broadcast scalar → constant column)
    extra_obs: np.ndarray | None = None
    if macro_features:
        macro_cols = []
        for val in macro_features.values():
            if val is not None and np.isfinite(float(val)):
                col = np.full(len(close), float(val), dtype=np.float64)
                macro_cols.append(col)
        if macro_cols:
            extra_obs = np.column_stack(macro_cols)

    try:
        return train_hmm(close, volume, n_iter=n_iter, extra_obs=extra_obs)
    except Exception:
        return None


def predict_regimes_from_index(
    index_model: GaussianHMM,
    index_df: pl.DataFrame,
    stock_df: pl.DataFrame,
    symbol: str,
    beta: float = 1.0,
) -> pl.DataFrame:
    """
    Derive stock-level regime signal from index HMM posteriors, scaled by beta.

    The index posterior probabilities are used directly — regime states are
    market-level, not stock-level. The stock's rolling beta modulates the
    expected regime return: a high-beta stock experiences larger swings in
    bull/crash regimes.

    Alignment: join stock and index on date, use index posteriors for matching
    dates. Stock-only dates not in index get the nearest prior index regime.

    Returns the same schema as predict_regimes() for drop-in compatibility.
    """
    _empty = pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date,
        "regime": pl.Int32, "regime_label": pl.Utf8,
        "prob_bull": pl.Float64, "prob_bear": pl.Float64,
        "prob_range": pl.Float64, "prob_crash": pl.Float64,
        "prob_recovery": pl.Float64,
    })

    idx_df = index_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    stk_df = stock_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    if len(idx_df) < 126 or len(stk_df) == 0:
        return _empty

    idx_close  = idx_df["close"].to_numpy().astype(np.float64)
    idx_volume = idx_df["volume"].fill_null(0).to_numpy().astype(np.float64)
    idx_dates  = idx_df["date"].to_list()

    obs, valid = _make_obs(idx_close, idx_volume)
    obs_clean  = obs[valid]
    if len(obs_clean) == 0:
        return _empty

    # Pad with zeros if model was trained with extra macro dimensions (fix 8.2)
    n_model_features = index_model.means_.shape[1]
    if obs_clean.shape[1] < n_model_features:
        pad = np.zeros((obs_clean.shape[0], n_model_features - obs_clean.shape[1]))
        obs_clean = np.column_stack([obs_clean, pad])

    try:
        state_seq  = index_model.predict(obs_clean)
        posteriors = index_model.predict_proba(obs_clean)
    except Exception:
        return _empty

    state_map = _map_states(index_model)

    # Map index posteriors to date → {sem_state: prob}
    n_total   = len(idx_close)
    offset    = n_total - len(obs_clean)
    date_to_regime: dict = {}
    date_to_probs: dict  = {}

    for i, raw in enumerate(state_seq):
        sem = state_map[int(raw)]
        d   = idx_dates[offset + i]
        date_to_regime[d] = sem
        # Accumulate posteriors into semantic slots (BIC may map multiple raws → same sem)
        probs: dict[int, float] = {s: 0.0 for s in range(5)}
        for raw_s, sem_s in state_map.items():
            probs[sem_s] = probs.get(sem_s, 0.0) + float(posteriors[i, raw_s])
        date_to_probs[d] = probs

    # Build output for stock dates using index regimes
    stk_dates = stk_df["date"].to_list()
    all_idx_dates_sorted = sorted(date_to_regime.keys())

    def _lookup_regime(d):
        """Return closest prior index regime date for stock date d."""
        if d in date_to_regime:
            return d
        # Binary search for nearest prior date
        lo, hi = 0, len(all_idx_dates_sorted) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if all_idx_dates_sorted[mid] <= d:
                lo = mid
            else:
                hi = mid - 1
        return all_idx_dates_sorted[lo] if all_idx_dates_sorted[lo] <= d else None

    # Beta scaling: adjust bull/crash probabilities by clipping beta effect
    # High beta (>1) increases effective exposure in bull/crash states
    beta_c = float(np.clip(beta, 0.1, 4.0))

    records = []
    for d in stk_dates:
        ref_date = _lookup_regime(d)
        if ref_date is None:
            continue
        sem  = date_to_regime[ref_date]
        prob = date_to_probs[ref_date]

        # Scale regime probabilities by beta: bull/recovery amplified for high-beta,
        # bear/crash amplified; range remains unchanged. Re-normalise after.
        beta_weights = {
            0: beta_c,       # Bull — high beta amplifies upside regime
            4: beta_c,       # Recovery
            1: beta_c,       # Bear — high beta amplifies downside regime
            3: beta_c,       # Crash
            2: 1.0 / beta_c, # Range — high beta suppresses range regime
        }
        scaled = {s: prob.get(s, 0.0) * beta_weights.get(s, 1.0) for s in range(N_STATES)}
        total  = sum(scaled.values()) or 1.0
        scaled = {s: v / total for s, v in scaled.items()}

        records.append({
            "symbol":       symbol,
            "date":         d,
            "regime":       sem,
            "regime_label": REGIME_LABELS[sem],
            "prob_bull":     scaled.get(0),
            "prob_bear":     scaled.get(1),
            "prob_range":    scaled.get(2),
            "prob_crash":    scaled.get(3),
            "prob_recovery": scaled.get(4),
        })

    return pl.DataFrame(records, infer_schema_length=len(records)) if records else _empty


def run_regime_detection(
    price_df: pl.DataFrame,
    symbol: str,
    n_iter: int = 50,
) -> pl.DataFrame:
    """End-to-end: train HMM on full history and return regime DataFrame."""
    _empty = pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date,
        "regime": pl.Int32, "regime_label": pl.Utf8,
        "prob_bull": pl.Float64, "prob_bear": pl.Float64,
        "prob_range": pl.Float64, "prob_crash": pl.Float64,
        "prob_recovery": pl.Float64,
    })

    # Require at least 126 rows with non-null close prices
    df = price_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    if len(df) < 126:
        return _empty

    close = df["close"].to_numpy().astype(np.float64)
    volume = df["volume"].fill_null(0).to_numpy().astype(np.float64)
    dates = df["date"].to_list()

    model = train_hmm(close, volume, n_iter=n_iter)
    return predict_regimes(model, close, volume, dates, symbol)
