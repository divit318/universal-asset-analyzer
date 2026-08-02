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

import hashlib
import pickle
import warnings
from pathlib import Path

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


def _trailing_mean(x: np.ndarray, w: int) -> np.ndarray:
    """Mean of the trailing <=w values at each index (expanding until w is reached)."""
    cs = np.concatenate(([0.0], np.cumsum(x)))
    idx = np.arange(len(x))
    lo = np.maximum(0, idx - w + 1)
    return (cs[idx + 1] - cs[lo]) / (idx - lo + 1)


def _make_obs(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """
    Build 3-feature observation matrix:
    [log_return_1d, realized_vol_5d, log_volume_ratio]

    Zero-volume handling: replace zeros with median volume before computing log ratio
    to avoid log(0) = -inf which propagates NaN into HMM startprob_.

    The two rolling windows are computed by cumulative sums rather than a Python
    comprehension per index. On a 1250-bar index series the comprehensions were
    ~40% of this function; it runs once per HMM fit and once per prediction, so
    they showed up directly in run time.
    """
    ret = np.diff(np.log(close), prepend=np.nan)

    # vol5[i] = population std of ret[i-4..i] * sqrt(252), NaN for i < 4.
    # ret[0] is NaN, so windows touching index 0 stay NaN — matching the
    # previous np.std() behaviour on a NaN-containing slice.
    vol5 = np.full(len(ret), np.nan)
    if len(ret) >= 5:
        win = np.lib.stride_tricks.sliding_window_view(ret, 5)
        vol5[4:] = win.std(axis=1) * np.sqrt(252)

    # Replace zero/negative volume with median to avoid log(0) = -inf
    vol_clean = volume.copy()
    median_vol = np.median(vol_clean[vol_clean > 0]) if np.any(vol_clean > 0) else 1.0
    vol_clean[vol_clean <= 0] = median_vol

    vol_ma20 = _trailing_mean(vol_clean, 20)
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


_HMM_CACHE_DIR = Path(__file__).parents[2] / "data" / "hmm_cache"


def _hmm_cache_key(index_key: str, index_df: pl.DataFrame, n_iter: int,
                   macro_features: dict[str, float | None] | None) -> str:
    """
    Fingerprint the inputs `train_hmm` would consume.

    Macro scalars are rounded to 2dp: they are broadcast as constant columns, so
    a third-decimal drift between two intraday quotes moves the fitted model by
    nothing an operator could observe, and fingerprinting at full precision
    would miss the cache on every single run.
    """
    last_date = index_df["date"][-1] if len(index_df) else "empty"
    macro = sorted(
        (k, round(float(v), 2)) for k, v in (macro_features or {}).items() if v is not None
    )
    raw = f"{index_key}|{last_date}|{len(index_df)}|{n_iter}|{macro}"
    return hashlib.sha256(raw.encode()).hexdigest()[:20]


def fit_market_regime(
    index_df: pl.DataFrame,
    n_iter: int = 200,
    macro_features: dict[str, float | None] | None = None,
    cache_key: str | None = None,
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

    # BIC selection trains 12 HMMs (4 candidate state counts x 3 seeds) over the
    # full index history. That is deterministic given the same bars, n_iter and
    # macro inputs — so within a session it is the same ~5s of work every run.
    # Cached on disk under that exact fingerprint; a new bar invalidates it.
    cache_path: Path | None = None
    if cache_key:
        cache_path = _HMM_CACHE_DIR / f"{_hmm_cache_key(cache_key, df, n_iter, macro_features)}.pkl"
        if cache_path.exists():
            try:
                with open(cache_path, "rb") as fh:
                    return pickle.load(fh)
            except Exception:
                cache_path.unlink(missing_ok=True)

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
        model = train_hmm(close, volume, n_iter=n_iter, extra_obs=extra_obs)
    except Exception:
        return None

    if cache_path is not None:
        try:
            _HMM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            tmp = cache_path.with_suffix(".pkl.tmp")
            with open(tmp, "wb") as fh:
                pickle.dump(model, fh)
            tmp.rename(cache_path)          # atomic: no half-written model is ever read
        except Exception:
            pass

    return model


_REGIME_SCHEMA = {
    "symbol": pl.Utf8, "date": pl.Date,
    "regime": pl.Int32, "regime_label": pl.Utf8,
    "prob_bull": pl.Float64, "prob_bear": pl.Float64,
    "prob_range": pl.Float64, "prob_crash": pl.Float64,
    "prob_recovery": pl.Float64,
}


class IndexRegimePosteriors:
    """
    The index-level half of `predict_regimes_from_index`, computed once.

    Regime states are market-level: for a given index and model, the posterior
    at each date is the *same number* for every stock in that market. The only
    per-stock input is beta, and it is applied afterwards. Before this class
    existed, every symbol re-ran `_make_obs` over the full index history plus
    `model.predict` and `model.predict_proba`, then rebuilt a 1250-entry dict of
    dicts — identical work, once per symbol. On a 250-name US universe that was
    ~27s of the ~48s regime stage, and it scaled linearly with universe size.

    Build one per (index, model) pair per run and pass it to
    `predict_regimes_from_index`.
    """

    __slots__ = ("dates", "regimes", "probs", "ok")

    def __init__(self, index_model: GaussianHMM, index_df: pl.DataFrame):
        self.ok = False
        self.dates: list = []
        self.regimes = np.empty(0, dtype=np.int32)
        self.probs = np.empty((0, N_STATES))

        idx_df = index_df.sort("date").filter(
            pl.col("close").is_not_null() & pl.col("close").gt(0)
        )
        if len(idx_df) < 126:
            return

        idx_close  = idx_df["close"].to_numpy().astype(np.float64)
        idx_volume = idx_df["volume"].fill_null(0).to_numpy().astype(np.float64)
        idx_dates  = idx_df["date"].to_list()

        obs, valid = _make_obs(idx_close, idx_volume)
        obs_clean  = obs[valid]
        if len(obs_clean) == 0:
            return

        # Pad with zeros if model was trained with extra macro dimensions (fix 8.2)
        n_model_features = index_model.means_.shape[1]
        if obs_clean.shape[1] < n_model_features:
            pad = np.zeros((obs_clean.shape[0], n_model_features - obs_clean.shape[1]))
            obs_clean = np.column_stack([obs_clean, pad])

        try:
            state_seq  = index_model.predict(obs_clean)
            posteriors = index_model.predict_proba(obs_clean)
        except Exception:
            return

        state_map = _map_states(index_model)
        offset = len(idx_close) - len(obs_clean)

        # Accumulate raw-state posteriors into semantic slots (BIC may map
        # multiple raw states onto the same semantic state).
        probs = np.zeros((len(obs_clean), N_STATES))
        for raw_s, sem_s in state_map.items():
            probs[:, sem_s] += posteriors[:, raw_s]

        sem_of_raw = np.array(
            [state_map[s] for s in range(index_model.n_components)], dtype=np.int32
        )

        # idx_dates is already ascending (sorted above), so this stays sorted —
        # which is what makes the per-stock lookup a plain searchsorted.
        self.dates   = idx_dates[offset:]
        self.regimes = sem_of_raw[state_seq.astype(int)]
        self.probs   = probs
        self.ok = True


def predict_regimes_from_index(
    index_model: GaussianHMM,
    index_df: pl.DataFrame,
    stock_df: pl.DataFrame,
    symbol: str,
    beta: float = 1.0,
    posteriors: IndexRegimePosteriors | None = None,
    max_rows: int | None = None,
) -> pl.DataFrame:
    """
    Derive stock-level regime signal from index HMM posteriors, scaled by beta.

    The index posterior probabilities are used directly — regime states are
    market-level, not stock-level. The stock's rolling beta modulates the
    expected regime return: a high-beta stock experiences larger swings in
    bull/crash regimes.

    Alignment: join stock and index on date, use index posteriors for matching
    dates. Stock-only dates not in index get the nearest prior index regime.

    `posteriors` is the shared per-market index inference; pass one to avoid
    recomputing it for every symbol. `max_rows` keeps only the most recent N
    stock dates — the callers of regime_daily read at most the last 90 days.

    Returns the same schema as predict_regimes() for drop-in compatibility.
    """
    _empty = pl.DataFrame(schema=_REGIME_SCHEMA)

    stk_df = stock_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    if len(stk_df) == 0:
        return _empty

    post = posteriors if posteriors is not None else IndexRegimePosteriors(index_model, index_df)
    if not post.ok:
        return _empty

    stk_dates = stk_df["date"].to_list()
    if max_rows is not None and len(stk_dates) > max_rows:
        stk_dates = stk_dates[-max_rows:]

    # Nearest prior index date for each stock date. searchsorted over the
    # already-sorted index dates replaces a per-date binary search in Python.
    pos = np.searchsorted(post.dates, stk_dates, side="right") - 1
    keep = pos >= 0
    if not keep.any():
        return _empty
    pos = pos[keep]
    kept_dates = [d for d, k in zip(stk_dates, keep) if k]

    # Beta scaling: bull/recovery/bear/crash amplified for high beta, range
    # suppressed; renormalised so the posterior still sums to 1.
    beta_c = float(np.clip(beta, 0.1, 4.0))
    weights = np.array([beta_c, beta_c, 1.0 / beta_c, beta_c, beta_c])

    scaled = post.probs[pos] * weights
    totals = scaled.sum(axis=1)
    totals[totals == 0.0] = 1.0
    scaled = scaled / totals[:, None]

    regimes = post.regimes[pos]

    return pl.DataFrame(
        {
            "symbol":        [symbol] * len(kept_dates),
            "date":          kept_dates,
            "regime":        regimes.astype(np.int32),
            "regime_label":  [REGIME_LABELS[int(r)] for r in regimes],
            "prob_bull":     scaled[:, 0],
            "prob_bear":     scaled[:, 1],
            "prob_range":    scaled[:, 2],
            "prob_crash":    scaled[:, 3],
            "prob_recovery": scaled[:, 4],
        },
        schema=_REGIME_SCHEMA,
    )


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
