"""
Feature factory — vectorized, lookahead-free.

All rolling operations use BACKWARD-looking windows only.
np.gradient is NOT used (centered differences = 1-step lookahead).
All stored features are stationary ratios/differences, not raw price levels.
"""

from __future__ import annotations

import numpy as np
import polars as pl


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_features(prices: pl.DataFrame, symbol: str) -> pl.DataFrame:
    """
    Given a single-symbol price DataFrame with columns [date, close, volume, high, low, open],
    returns a long-format DataFrame [symbol, date, feature, value].
    All features are strictly backward-looking at every point in time.
    """
    if len(prices) < 30:
        return pl.DataFrame(schema={"symbol": pl.Utf8, "date": pl.Date, "feature": pl.Utf8, "value": pl.Float64})

    df = prices.sort("date")
    close = df["close"].to_numpy().astype(np.float64)
    volume = df["volume"].to_numpy().astype(np.float64)
    high = df["high"].to_numpy().astype(np.float64)
    low = df["low"].to_numpy().astype(np.float64)
    open_ = df["open"].to_numpy().astype(np.float64) if "open" in df.columns else close.copy()
    dates = df["date"].to_list()
    n = len(close)

    feat: dict[str, np.ndarray] = {}

    # --- Log returns (strictly backward) ---
    ret = np.empty(n)
    ret[0] = np.nan
    ret[1:] = np.log(close[1:] / close[:-1])

    feat["log_return_1d"] = ret
    feat["return_5d"]   = _rolling_return(close, 5)
    feat["return_21d"]  = _rolling_return(close, 21)
    feat["return_63d"]  = _rolling_return(close, 63)
    feat["return_126d"] = _rolling_return(close, 126)
    feat["return_252d"] = _rolling_return(close, 252)

    # --- Momentum (Jegadeesh-Titman: skip-1) ---
    feat["momentum_12_1"] = _rolling_return(close, 252) - _rolling_return(close, 21)
    feat["momentum_6_1"]  = _rolling_return(close, 126) - _rolling_return(close, 21)
    feat["momentum_3_1"]  = _rolling_return(close, 63)  - _rolling_return(close, 21)

    # --- Price-to-SMA ratios (stationary) — raw SMA levels NOT stored ---
    for w in [10, 20, 50, 100, 200]:
        sma = _rolling_mean_fast(close, w)
        feat[f"price_to_sma{w}"] = close / (sma + 1e-10) - 1.0   # z around 0

    # --- MACD as histogram only (normalised by price) ---
    ema12 = _ema(close, 12)
    ema26 = _ema(close, 26)
    macd  = ema12 - ema26
    macd_signal = _ema(macd, 9)
    feat["macd_hist_pct"] = (macd - macd_signal) / (close + 1e-10)   # stationary

    # --- RSI ---
    for w in [14, 21]:
        feat[f"rsi_{w}"] = _rsi(close, w)

    # --- Bollinger %B and width (both stationary) ---
    sma20 = _rolling_mean_fast(close, 20)
    std20 = _rolling_std_fast(close, 20)
    feat["bb_pct_20"]   = (close - (sma20 - 2 * std20)) / (4 * std20 + 1e-10)
    feat["bb_width_20"] = 4 * std20 / (sma20 + 1e-10)

    # --- ATR% (stationary) ---
    tr = _true_range(open_, high, low, close)
    for w in [14, 21]:
        feat[f"atr_pct_{w}"] = _rolling_mean_fast(tr, w) / (close + 1e-10)

    # --- Realized vol surfaces (annualised) ---
    for w in [10, 21, 63]:
        feat[f"vol_realized_{w}d"]    = _rolling_std_fast(ret, w) * np.sqrt(252)
        feat[f"vol_garman_klass_{w}d"] = _garman_klass_vol(open_, high, low, close, w)
        feat[f"vol_parkinson_{w}d"]    = _parkinson_vol(high, low, w)

    # --- Vol regime ratio ---
    feat["vol_ratio_10_63"] = (feat["vol_realized_10d"] + 1e-10) / (feat["vol_realized_63d"] + 1e-10)
    feat["vol_ratio_21_63"] = (feat["vol_realized_21d"] + 1e-10) / (feat["vol_realized_63d"] + 1e-10)

    # --- Backward-difference kinematics (NO np.gradient — no lookahead) ---
    log_price = np.log(close)
    # velocity[i]     = log_price[i] - log_price[i-1]  (= ret)
    # acceleration[i] = velocity[i] - velocity[i-1]
    # jerk[i]         = acceleration[i] - acceleration[i-1]
    velocity     = np.empty(n); velocity[0]     = np.nan
    acceleration = np.empty(n); acceleration[:2] = np.nan
    jerk         = np.empty(n); jerk[:3]         = np.nan
    velocity[1:]     = log_price[1:] - log_price[:-1]
    acceleration[2:] = velocity[2:] - velocity[1:-1]
    jerk[3:]         = acceleration[3:] - acceleration[2:-1]
    feat["velocity"]     = velocity
    feat["acceleration"] = acceleration
    feat["jerk"]         = jerk

    # --- Regression slopes (closed-form, vectorized) ---
    for w in [21, 63, 126]:
        feat[f"reg_slope_{w}d"] = _rolling_reg_slope_fast(log_price, w)
        feat[f"reg_r2_{w}d"]    = _rolling_reg_r2_fast(log_price, w)

    # --- Volume features (stationary) ---
    vol_sma20 = _rolling_mean_fast(volume, 20)
    feat["volume_ratio_20d"] = volume / (vol_sma20 + 1e-10)
    # OBV normalised to its own 20-day SMA ratio (makes it stationary)
    obv_raw = _obv(close, volume)
    feat["obv_sma_ratio"] = obv_raw / (_rolling_mean_fast(np.abs(obv_raw), 20) + 1e-10)
    feat["volume_slope_10d"] = _rolling_reg_slope_fast(volume, 10)

    # --- 52-week channel (stationary ratios) ---
    high_52w = _rolling_max_fast(high, 260)
    low_52w  = _rolling_min_fast(low, 260)
    feat["pct_from_high_52w"] = (close - high_52w) / (high_52w + 1e-10)
    feat["pct_from_low_52w"]  = (close - low_52w)  / (low_52w  + 1e-10)

    # --- Variance-ratio test (replaces broken Hurst R/S) ---
    # VR(q) = Var(q-period return) / (q * Var(1-period return))
    # VR > 1 → momentum; VR < 1 → mean-reversion; VR = 1 → random walk
    for q in [5, 21]:
        feat[f"vr_{q}"] = _variance_ratio(ret, q, window=63)

    # --- OU half-life (backward OLS, correct) ---
    feat["ou_halflife_21d"] = _rolling_ou_halflife(log_price, 21)
    feat["ou_halflife_63d"] = _rolling_ou_halflife(log_price, 63)

    # --- Drawdown metrics ---
    feat["drawdown"]          = _drawdown(close)
    feat["max_drawdown_63d"]  = _rolling_max_drawdown_fast(close, 63)
    feat["max_drawdown_252d"] = _rolling_max_drawdown_fast(close, 252)

    # --- Risk-adjusted return (Calmar proxy) ---
    dd63 = feat["max_drawdown_63d"]
    feat["calmar_63d"] = feat["return_63d"] / (-dd63 + 1e-10)

    # --- Return distribution shape ---
    for w in [21, 63]:
        feat[f"ret_skew_{w}d"] = _rolling_skew_fast(ret, w)
        feat[f"ret_kurt_{w}d"] = _rolling_kurt_fast(ret, w)

    # --- Assemble long-format ---
    records = []
    for name, arr in feat.items():
        if len(arr) != n:
            continue
        for i in range(n):
            v = arr[i]
            if np.isfinite(v):
                records.append((symbol, dates[i], name, float(v)))

    return pl.DataFrame(
        records,
        schema={"symbol": pl.Utf8, "date": pl.Date, "feature": pl.Utf8, "value": pl.Float64},
        orient="row",
    )


# ---------------------------------------------------------------------------
# Vectorized rolling primitives — no Python loops on inner loops
# ---------------------------------------------------------------------------

def _rolling_mean_fast(x: np.ndarray, w: int) -> np.ndarray:
    """O(n) rolling mean via cumsum."""
    out = np.full(len(x), np.nan)
    cs = np.nancumsum(x)
    out[w - 1] = cs[w - 1] / w
    out[w:] = (cs[w:] - cs[:-w]) / w
    return out


def _rolling_std_fast(x: np.ndarray, w: int) -> np.ndarray:
    """O(n) rolling std (ddof=1) via two-pass cumsum."""
    out = np.full(len(x), np.nan)
    n = len(x)
    cs  = np.nancumsum(x)
    cs2 = np.nancumsum(x ** 2)
    for i in range(w - 1, n):
        s  = cs[i]  - (cs[i - w] if i >= w else 0)
        s2 = cs2[i] - (cs2[i - w] if i >= w else 0)
        var = (s2 - s * s / w) / (w - 1)
        out[i] = np.sqrt(max(var, 0.0))
    return out


def _rolling_max_fast(x: np.ndarray, w: int) -> np.ndarray:
    from collections import deque
    out = np.full(len(x), np.nan)
    dq: deque[int] = deque()
    for i in range(len(x)):
        while dq and x[dq[-1]] <= x[i]:
            dq.pop()
        dq.append(i)
        if dq[0] <= i - w:
            dq.popleft()
        if i >= w - 1:
            out[i] = x[dq[0]]
    return out


def _rolling_min_fast(x: np.ndarray, w: int) -> np.ndarray:
    from collections import deque
    out = np.full(len(x), np.nan)
    dq: deque[int] = deque()
    for i in range(len(x)):
        while dq and x[dq[-1]] >= x[i]:
            dq.pop()
        dq.append(i)
        if dq[0] <= i - w:
            dq.popleft()
        if i >= w - 1:
            out[i] = x[dq[0]]
    return out


def _rolling_return(close: np.ndarray, w: int) -> np.ndarray:
    out = np.full(len(close), np.nan)
    valid = close > 0
    for i in range(w, len(close)):
        if valid[i] and valid[i - w]:
            out[i] = close[i] / close[i - w] - 1.0
    return out


def _rolling_reg_slope_fast(x: np.ndarray, w: int) -> np.ndarray:
    """
    Closed-form OLS slope using cumulative sums — O(n), no per-window linregress.
    slope = (n·Σty - Σt·Σy) / (n·Σt² - (Σt)²)
    t is 0..w-1 so Σt = w(w-1)/2, Σt² = w(w-1)(2w-1)/6.
    """
    out = np.full(len(x), np.nan)
    n = len(x)
    t = np.arange(w, dtype=np.float64)
    sum_t  = t.sum()
    sum_t2 = (t ** 2).sum()
    denom  = w * sum_t2 - sum_t ** 2

    if abs(denom) < 1e-10:
        return out

    # Weighted cumsum: Σ(t_local * y_window)
    # t_local for window ending at i is [0,1,...,w-1] mapped to [i-w+1,...,i]
    # We use a sliding weighted sum.
    # Precompute: cs_ty[i] = Σ_{k=0}^{i} k * x[i-k] (this is hard to vectorise directly)
    # Instead: cs_y[i] = Σ x[i-w+1..i], cs_ty[i] = Σ j*x[i-w+1+j] for j=0..w-1
    # Use stride tricks to build (n-w+1, w) view, then dot with t.
    if n < w:
        return out
    shape   = (n - w + 1, w)
    strides = (x.strides[0], x.strides[0])
    windows = np.lib.stride_tricks.as_strided(x, shape=shape, strides=strides)
    sum_y   = windows.sum(axis=1)
    sum_ty  = windows @ t          # dot with [0,1,...,w-1]
    slopes  = (w * sum_ty - sum_t * sum_y) / denom
    out[w - 1:] = slopes
    return out


def _rolling_reg_r2_fast(x: np.ndarray, w: int) -> np.ndarray:
    """R² of rolling linear regression against time index."""
    out = np.full(len(x), np.nan)
    n = len(x)
    if n < w:
        return out
    t = np.arange(w, dtype=np.float64)
    sum_t  = t.sum()
    sum_t2 = (t ** 2).sum()
    denom  = w * sum_t2 - sum_t ** 2
    if abs(denom) < 1e-10:
        return out

    shape   = (n - w + 1, w)
    strides = (x.strides[0], x.strides[0])
    windows = np.lib.stride_tricks.as_strided(x, shape=shape, strides=strides)
    sum_y   = windows.sum(axis=1)
    sum_ty  = windows @ t
    sum_y2  = (windows ** 2).sum(axis=1)
    slope   = (w * sum_ty - sum_t * sum_y) / denom
    intercept = (sum_y - slope * sum_t) / w
    y_hat = intercept[:, None] + slope[:, None] * t[None, :]
    ss_res = ((windows - y_hat) ** 2).sum(axis=1)
    ss_tot = sum_y2 - sum_y ** 2 / w
    r2 = np.where(ss_tot > 1e-10, 1.0 - ss_res / ss_tot, 0.0)
    out[w - 1:] = np.clip(r2, 0.0, 1.0)
    return out


def _rolling_skew_fast(x: np.ndarray, w: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        s = x[i - w + 1 : i + 1]
        valid = s[np.isfinite(s)]
        if len(valid) < 4:
            continue
        m = valid.mean()
        std = valid.std(ddof=1)
        if std < 1e-10:
            continue
        out[i] = float(((valid - m) ** 3).mean() / std ** 3)
    return out


def _rolling_kurt_fast(x: np.ndarray, w: int) -> np.ndarray:
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        s = x[i - w + 1 : i + 1]
        valid = s[np.isfinite(s)]
        if len(valid) < 4:
            continue
        m = valid.mean()
        std = valid.std(ddof=1)
        if std < 1e-10:
            continue
        out[i] = float(((valid - m) ** 4).mean() / std ** 4 - 3.0)  # excess kurtosis
    return out


def _ema(x: np.ndarray, span: int) -> np.ndarray:
    alpha = 2.0 / (span + 1)
    out = np.full(len(x), np.nan)
    start = int(np.argmax(np.isfinite(x)))
    out[start] = x[start]
    for i in range(start + 1, len(x)):
        if np.isfinite(x[i]):
            out[i] = alpha * x[i] + (1.0 - alpha) * out[i - 1]
        else:
            out[i] = out[i - 1]
    return out


def _rsi(close: np.ndarray, w: int) -> np.ndarray:
    delta = np.empty(len(close)); delta[0] = np.nan
    delta[1:] = close[1:] - close[:-1]
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = _rolling_mean_fast(gain, w)
    avg_loss = _rolling_mean_fast(loss, w)
    rs = avg_gain / (avg_loss + 1e-10)
    return 100.0 - 100.0 / (1.0 + rs)


def _true_range(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    prev_close = np.roll(close, 1)
    prev_close[0] = open_[0]
    return np.maximum(high - low, np.maximum(np.abs(high - prev_close), np.abs(low - prev_close)))


def _obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    direction = np.sign(np.diff(close, prepend=close[0]))
    return np.cumsum(direction * volume).astype(np.float64)


def _garman_klass_vol(open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray, w: int) -> np.ndarray:
    log_hl = np.log((high + 1e-10) / (low + 1e-10)) ** 2
    log_co = np.log((close + 1e-10) / (open_ + 1e-10)) ** 2
    gk = 0.5 * log_hl - (2.0 * np.log(2.0) - 1.0) * log_co
    return np.sqrt(np.maximum(_rolling_mean_fast(gk, w) * 252, 0.0))


def _parkinson_vol(high: np.ndarray, low: np.ndarray, w: int) -> np.ndarray:
    log_hl = np.log((high + 1e-10) / (low + 1e-10)) ** 2
    pk = log_hl / (4.0 * np.log(2.0))
    return np.sqrt(np.maximum(_rolling_mean_fast(pk, w) * 252, 0.0))


def _drawdown(close: np.ndarray) -> np.ndarray:
    running_max = np.maximum.accumulate(close)
    return (close - running_max) / (running_max + 1e-10)


def _rolling_max_drawdown_fast(close: np.ndarray, w: int) -> np.ndarray:
    """O(n·w) rolling max drawdown — unavoidably O(w) per window."""
    out = np.full(len(close), np.nan)
    for i in range(w - 1, len(close)):
        sub  = close[i - w + 1 : i + 1]
        peak = np.maximum.accumulate(sub)
        out[i] = ((sub - peak) / (peak + 1e-10)).min()
    return out


def _variance_ratio(ret: np.ndarray, q: int, window: int = 63) -> np.ndarray:
    """
    Rolling variance ratio VR(q) = Var(q-period ret) / (q * Var(1-period ret)).
    VR > 1: momentum; VR < 1: mean-reversion; VR ≈ 1: random walk.
    Computed on a rolling `window`-day lookback.
    """
    n = len(ret)
    out = np.full(n, np.nan)
    for i in range(window + q - 1, n):
        r1 = ret[i - window + 1 : i + 1]
        r1 = r1[np.isfinite(r1)]
        if len(r1) < q + 10:
            continue
        var1 = r1.var(ddof=1)
        if var1 < 1e-10:
            continue
        rq = np.array([r1[j:j + q].sum() for j in range(len(r1) - q + 1)])
        varq = rq.var(ddof=1)
        out[i] = varq / (q * var1)
    return out


def _rolling_ou_halflife(log_price: np.ndarray, w: int) -> np.ndarray:
    """Ornstein-Uhlenbeck mean-reversion half-life via backward OLS."""
    n = len(log_price)
    out = np.full(n, np.nan)
    for i in range(w, n):
        sub = log_price[i - w : i + 1]
        if np.any(np.isnan(sub)):
            continue
        y = np.diff(sub)      # Δlog_price
        x = sub[:-1]          # lagged log_price
        x_dm = x - x.mean()
        y_dm = y - y.mean()
        denom = (x_dm ** 2).sum()
        if denom < 1e-10:
            continue
        slope = (x_dm * y_dm).sum() / denom
        if slope < 0:
            out[i] = -np.log(2.0) / slope
    return out
