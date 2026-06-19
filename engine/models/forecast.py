"""
Probabilistic forecast engine.
LightGBM quantile regression — strictly walk-forward, no lookahead.
Predicts return distributions for horizons: [5, 10, 21, 63, 126] days.

Lookahead-free guarantees:
  - Feature matrix X[i] uses only data up to and including day i.
  - Target y[i] = log(close[i+h] / close[i]) is set to NaN for i > n-h-1.
  - Training uses X[:train_end] / y[:train_end] where train_end ensures no
    target row bleeds into its own feature computation.
  - prob_up is derived from the calibrated p10/p90 spread using a proper
    normal-approximation from the predicted quantile distribution, NOT a
    magic constant.
"""

from __future__ import annotations

import numpy as np
import polars as pl
import lightgbm as lgb


HORIZONS    = [5, 10, 21, 63, 126]
QUANTILES   = [0.10, 0.25, 0.50, 0.75, 0.90]
TRAIN_MIN   = 252


def _make_feature_matrix(df: pl.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """
    Build feature matrix X strictly from past data at each row.
    No cumulative non-stationary series (OBV, raw price levels) included.
    """
    df = df.sort("date")
    close  = df["close"].to_numpy().astype(np.float64)
    volume = df["volume"].fill_null(0).to_numpy().astype(np.float64)
    n = len(close)

    ret = np.empty(n); ret[0] = np.nan
    ret[1:] = np.log(close[1:] / close[:-1])

    feats: list[np.ndarray] = []

    # 1. Lagged log-returns (pure look-back)
    for lag in [1, 2, 3, 5, 10, 21]:
        f = np.full(n, np.nan)
        if lag == 1:
            f = ret.copy()
        else:
            # cumulative return over last `lag` days
            f[lag:] = np.array([ret[i - lag + 1: i + 1].sum() for i in range(lag, n)])
        feats.append(f)

    # 2. Rolling realised vol
    for w in [10, 21, 63]:
        f = np.full(n, np.nan)
        cs  = np.nancumsum(ret ** 2)
        cs1 = np.nancumsum(ret)
        for i in range(w - 1, n):
            s  = cs[i]  - (cs[i - w] if i >= w else 0.0)
            s1 = cs1[i] - (cs1[i - w] if i >= w else 0.0)
            f[i] = np.sqrt(max((s - s1 ** 2 / w) / (w - 1), 0.0)) * np.sqrt(252)
        feats.append(f)

    # 3. Price-to-SMA ratio
    from engine.features.factory import _rolling_mean_fast
    for w in [20, 50, 200]:
        sma = _rolling_mean_fast(close, w)
        feats.append(close / (sma + 1e-10) - 1.0)

    # 4. RSI-14
    gain = np.where(ret > 0, ret, 0.0)
    loss = np.where(ret < 0, -ret, 0.0)
    from engine.features.factory import _rolling_mean_fast as rmf
    avg_gain = rmf(gain, 14)
    avg_loss = rmf(loss, 14)
    rs = avg_gain / (avg_loss + 1e-10)
    feats.append(100.0 - 100.0 / (1.0 + rs))

    # 5. Volume ratio
    vol_sma = rmf(volume, 20)
    feats.append(volume / (vol_sma + 1e-10))

    X = np.column_stack(feats)
    dates = df["date"].to_numpy()
    return X, dates


def _make_targets(close: np.ndarray, horizon: int) -> np.ndarray:
    """
    Forward log-return for `horizon` days.
    y[i] = NaN for i >= n - horizon (no future data available).
    """
    n = len(close)
    y = np.full(n, np.nan)
    # Only fill rows where we actually have the future price
    valid_end = n - horizon
    for i in range(valid_end):
        if close[i] > 0 and close[i + horizon] > 0:
            y[i] = np.log(close[i + horizon] / close[i])
    return y


def _prob_up_from_quantiles(p10: float, p25: float, p50: float, p75: float, p90: float) -> float:
    """
    Derive P(return > 0) by fitting a Gaussian to the predicted quantiles
    (method of moments on mean and std from the IQR).

    IQR = p75 - p25 ≈ 1.349 * σ  (for normal distribution)
    mean ≈ p50

    This avoids the magic constant 0.5 + p50 * 5 from the original.
    """
    iqr = p75 - p25
    sigma = max(iqr / 1.349, 1e-6)
    # P(X > 0) where X ~ N(p50, sigma)
    z = p50 / sigma
    # Φ(z) via rational approximation
    return float(np.clip(_phi(z), 0.02, 0.98))


def _phi(z: float) -> float:
    """Standard normal CDF approximation (Abramowitz & Stegun)."""
    t = 1.0 / (1.0 + 0.2316419 * abs(z))
    poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
    p = 1.0 - 0.3989422804 * np.exp(-0.5 * z ** 2) * poly
    return p if z >= 0 else 1.0 - p


def fit_quantile_models(
    X: np.ndarray,
    y: np.ndarray,
    quantiles: list[float] = QUANTILES,
    symbol: str = "",
    horizon: int = 21,
) -> list[lgb.Booster]:
    """
    Fit one LightGBM quantile model per quantile.
    Uses chronological 80/20 split — NOT random — to preserve time order.
    Appends OOS calibration rows to oos_calibration_log.csv for drift tracking.
    """
    import csv
    from pathlib import Path

    valid = np.isfinite(X).all(axis=1) & np.isfinite(y)
    X_clean, y_clean = X[valid], y[valid]

    if len(X_clean) < 60:
        return []

    n_train = int(len(X_clean) * 0.80)
    dtrain = lgb.Dataset(X_clean[:n_train], label=y_clean[:n_train])
    dval   = lgb.Dataset(X_clean[n_train:], label=y_clean[n_train:], reference=dtrain)

    models = []
    for q in quantiles:
        params = {
            "objective": "quantile",
            "alpha": q,
            "metric": "quantile",
            "num_leaves": 15,
            "learning_rate": 0.05,
            "n_estimators": 300,
            "min_child_samples": 15,
            "subsample": 0.7,
            "colsample_bytree": 0.7,
            "reg_lambda": 1.0,
            "verbose": -1,
        }
        model = lgb.train(
            params,
            dtrain,
            valid_sets=[dval],
            callbacks=[
                lgb.early_stopping(30, verbose=False),
                lgb.log_evaluation(-1),
            ],
        )
        models.append(model)

    # OOS calibration log: append empirical coverage for proxy holdout (last 20%)
    # Flag symbol+horizon when |empirical_coverage - nominal| > 0.10
    if n_train < len(X_clean) and symbol:
        log_path = Path(__file__).parents[2] / "data" / "oos_calibration_log.csv"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        write_header = not log_path.exists()
        X_oos = X_clean[n_train:]
        y_oos = y_clean[n_train:]
        with open(log_path, "a", newline="") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["symbol","horizon","quantile","nominal","empirical_coverage","error","flag"])
            for model, q in zip(models, quantiles):
                preds = np.array([float(model.predict(X_oos[i:i+1])[0]) for i in range(len(X_oos))])
                empirical = float((y_oos < preds).mean())
                err = abs(empirical - q)
                flag = "FLAG" if err > 0.10 else "OK"
                writer.writerow([symbol, horizon, round(q,2), round(q,2), round(empirical,4), round(err,4), flag])

    return models


def _load_calibration_shifts(
    symbol: str,
    horizon: int,
    quantiles: list[float] = QUANTILES,
) -> dict[float, float]:
    """
    Load additive calibration shifts from oos_calibration_log.csv.

    When empirical_coverage deviates from nominal by > 0.05:
      - empirical > nominal: too many actuals fall below our prediction → prediction too HIGH → shift down
      - empirical < nominal: too few actuals fall below our prediction → prediction too LOW → shift up

    Returns {quantile: shift_fraction} where shift is multiplied by p90-p10 spread at call time.
    Uses last 10 observations per quantile. Requires ≥3 to apply any correction.
    """
    import csv as _csv
    from pathlib import Path

    log_path = Path(__file__).parents[2] / "data" / "oos_calibration_log.csv"
    if not log_path.exists():
        return {q: 0.0 for q in quantiles}

    rows_by_q: dict[float, list[float]] = {q: [] for q in quantiles}
    with open(log_path, newline="") as f:
        reader = _csv.DictReader(f)
        for row in reader:
            if row.get("symbol") == symbol and int(row.get("horizon", 0)) == horizon:
                try:
                    q = float(row["quantile"])
                    empirical = float(row["empirical_coverage"])
                    if q in rows_by_q:
                        rows_by_q[q].append(empirical)
                except (ValueError, KeyError):
                    continue

    shifts = {}
    for q in quantiles:
        obs = rows_by_q[q][-10:]  # most recent 10 only
        if len(obs) < 3:
            shifts[q] = 0.0
            continue
        error = float(np.mean(obs)) - q  # positive = overestimate (too high)
        shifts[q] = float(-error * 0.5) if abs(error) >= 0.05 else 0.0
    return shifts


def predict_distribution(
    models: list[lgb.Booster],
    X_row: np.ndarray,
    quantiles: list[float] = QUANTILES,
    symbol: str = "",
    horizon: int = 21,
) -> dict:
    """
    Predict return distribution for a single observation row.
    prob_up derived from Gaussian fit to quantiles — no magic constants.
    Enforces quantile monotonicity via isotonic projection (pool adjacent violators).
    Applies OOS calibration correction when oos_calibration_log.csv has ≥3 rows per quantile.
    """
    if X_row.ndim == 1:
        X_row = X_row.reshape(1, -1)

    raw_preds = np.array([float(m.predict(X_row)[0]) for m in models])

    # Isotonic projection: enforce p10 <= p25 <= p50 <= p75 <= p90
    raw_preds = _isotonic_project(raw_preds)

    # OOS calibration correction: shift each quantile proportional to coverage error
    if symbol:
        shifts = _load_calibration_shifts(symbol, horizon, quantiles)
        spread = float(raw_preds[-1] - raw_preds[0]) or 0.10  # p90 - p10 as scale
        for i, q in enumerate(quantiles):
            raw_preds[i] += shifts.get(q, 0.0) * spread
        raw_preds = _isotonic_project(raw_preds)

    keys = [f"p{int(q * 100)}" for q in quantiles]
    preds = dict(zip(keys, raw_preds.tolist()))

    preds["prob_up"] = _prob_up_from_quantiles(
        preds["p10"], preds["p25"], preds["p50"], preds["p75"], preds["p90"]
    )
    return preds


def _isotonic_project(y: np.ndarray) -> np.ndarray:
    """
    Pool-adjacent-violators (PAV) isotonic regression for non-decreasing output.
    Iterates until convergence — single forward pass is insufficient for
    non-local violations like [0.02, -0.01, 0.0, 0.015, 0.03].
    """
    y = y.astype(float).copy()
    n = len(y)
    # Represent solution as weighted blocks; merge violating adjacent blocks
    # each block: [start_index, end_index, mean_value, count]
    blocks: list[list] = [[i, i, y[i], 1] for i in range(n)]
    changed = True
    while changed:
        changed = False
        i = 0
        merged: list[list] = []
        while i < len(blocks):
            b = blocks[i]
            while (i + 1 < len(blocks)) and (blocks[i + 1][2] < b[2]):
                # Merge block i with i+1
                nxt = blocks[i + 1]
                total = b[3] + nxt[3]
                b = [b[0], nxt[1], (b[2] * b[3] + nxt[2] * nxt[3]) / total, total]
                i += 1
                changed = True
            merged.append(b)
            i += 1
        blocks = merged

    # Reconstruct flat array from blocks
    out = np.empty(n)
    for b in blocks:
        out[b[0]: b[1] + 1] = b[2]
    return out


def run_forecasts(
    price_df: pl.DataFrame,
    symbol: str,
    horizons: list[int] = HORIZONS,
) -> pl.DataFrame:
    """
    Lookahead-free forecast pipeline.

    Training guarantee:
    - For horizon h, train on X[:n-h-1] / y[:n-h-1].
    - Predict on X[-1:] (last available feature row).
    - No feature in X[-1:] uses any price beyond close[-1].
    """
    empty = pl.DataFrame(schema={
        "symbol": pl.Utf8, "date": pl.Date, "horizon_days": pl.Int32,
        "p10": pl.Float64, "p25": pl.Float64, "p50": pl.Float64,
        "p75": pl.Float64, "p90": pl.Float64, "prob_up": pl.Float64,
    })

    if len(price_df) < TRAIN_MIN:
        return empty

    df    = price_df.sort("date")
    close = df["close"].to_numpy().astype(np.float64)
    X, dates = _make_feature_matrix(df)

    # dates[-1] is a numpy datetime64 or datetime.date — cast to pl.Date-compatible Python date
    latest_date = df["date"][-1]   # polars Date scalar, safe for pl.DataFrame construction
    X_latest    = X[-1:].copy()

    # Verify X_latest has no NaN (if it does, we can't predict)
    if not np.isfinite(X_latest).all():
        return empty

    records = []
    for horizon in horizons:
        y = _make_targets(close, horizon)

        # train_end: last index where we have a valid target
        # y[i] requires close[i+horizon], so last valid i = n - horizon - 1
        train_end = len(close) - horizon - 1
        if train_end < TRAIN_MIN:
            continue

        # Critical: X and y are both indexed identically, training window is strictly past
        models = fit_quantile_models(X[:train_end], y[:train_end], symbol=symbol, horizon=horizon)
        if not models:
            continue

        dist = predict_distribution(models, X_latest, symbol=symbol, horizon=horizon)
        records.append({
            "symbol":       symbol,
            "date":         latest_date,
            "horizon_days": horizon,
            "p10":          dist["p10"],
            "p25":          dist["p25"],
            "p50":          dist["p50"],
            "p75":          dist["p75"],
            "p90":          dist["p90"],
            "prob_up":      dist["prob_up"],
        })

    if not records:
        return empty
    df_out = pl.DataFrame(records)
    # Ensure date column is pl.Date (not BLOB/object) regardless of how the scalar came in
    if df_out["date"].dtype != pl.Date:
        df_out = df_out.with_columns(pl.col("date").cast(pl.Date))
    return df_out
