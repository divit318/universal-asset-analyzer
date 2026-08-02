"""
Prove the vectorized engine internals still produce the original numbers.

The 2026-07-31 Fast Run optimization replaced a dozen per-index Python loops in
`engine/features/factory.py` and `engine/models/regime.py` with batched numpy.
Those are the pieces where "faster" could quietly mean "different", so each one
is checked here against a verbatim copy of the implementation it replaced,
running on real price history out of engine.duckdb.

    python verify_engine_equivalence.py [--symbols N]

Exits non-zero on any mismatch. Expected output is max|diff| of 0.0 everywhere
except variance_ratio and _ema, which differ only by float-associativity
(~1e-15 and ~1e-13 respectively).
"""

from __future__ import annotations

import argparse
import sys
from collections import deque

import numpy as np
import polars as pl

from engine.data.loader import get_db
from engine.features import factory as F
from engine.models.regime import (
    IndexRegimePosteriors,
    REGIME_LABELS,
    _make_obs,
    _map_states,
    fit_market_regime,
    predict_regimes_from_index,
)

FAILURES: list[str] = []


# ---------------------------------------------------------------------------
# Original implementations, kept verbatim as the reference
# ---------------------------------------------------------------------------

def ref_make_obs(close, volume):
    ret = np.diff(np.log(close), prepend=np.nan)
    vol5 = np.array([
        ret[max(0, i - 4):i + 1].std() * np.sqrt(252) if i >= 4 else np.nan
        for i in range(len(ret))
    ])
    vol_clean = volume.copy()
    median_vol = np.median(vol_clean[vol_clean > 0]) if np.any(vol_clean > 0) else 1.0
    vol_clean[vol_clean <= 0] = median_vol
    vol_ma20 = np.array([
        vol_clean[max(0, i - 19):i + 1].mean() if i >= 19 else vol_clean[:i + 1].mean()
        for i in range(len(vol_clean))
    ])
    obs = np.column_stack([ret, vol5, np.log(vol_clean / (vol_ma20 + 1e-10))])
    return obs, ~np.any(~np.isfinite(obs), axis=1)


def ref_rolling_std(x, w):
    out = np.full(len(x), np.nan)
    cs, cs2 = np.nancumsum(x), np.nancumsum(x ** 2)
    for i in range(w - 1, len(x)):
        s = cs[i] - (cs[i - w] if i >= w else 0)
        s2 = cs2[i] - (cs2[i - w] if i >= w else 0)
        out[i] = np.sqrt(max((s2 - s * s / w) / (w - 1), 0.0))
    return out


def ref_rolling_return(close, w):
    out = np.full(len(close), np.nan)
    valid = close > 0
    for i in range(w, len(close)):
        if valid[i] and valid[i - w]:
            out[i] = close[i] / close[i - w] - 1.0
    return out


def _ref_moment(x, w, power, offset):
    out = np.full(len(x), np.nan)
    for i in range(w - 1, len(x)):
        v = x[i - w + 1:i + 1]
        v = v[np.isfinite(v)]
        if len(v) < 4:
            continue
        sd = v.std(ddof=1)
        if sd < 1e-10:
            continue
        out[i] = float(((v - v.mean()) ** power).mean() / sd ** power - offset)
    return out


def ref_skew(x, w):
    return _ref_moment(x, w, 3, 0.0)


def ref_kurt(x, w):
    return _ref_moment(x, w, 4, 3.0)


def ref_mdd(close, w):
    out = np.full(len(close), np.nan)
    for i in range(w - 1, len(close)):
        sub = close[i - w + 1:i + 1]
        peak = np.maximum.accumulate(sub)
        out[i] = ((sub - peak) / (peak + 1e-10)).min()
    return out


def ref_vr(ret, q, window=63):
    out = np.full(len(ret), np.nan)
    for i in range(window + q - 1, len(ret)):
        r1 = ret[i - window + 1:i + 1]
        r1 = r1[np.isfinite(r1)]
        if len(r1) < q + 10:
            continue
        var1 = r1.var(ddof=1)
        if var1 < 1e-10:
            continue
        rq = np.array([r1[j:j + q].sum() for j in range(len(r1) - q + 1)])
        out[i] = rq.var(ddof=1) / (q * var1)
    return out


def ref_ou(lp, w):
    out = np.full(len(lp), np.nan)
    for i in range(w, len(lp)):
        sub = lp[i - w:i + 1]
        if np.any(np.isnan(sub)):
            continue
        y, x = np.diff(sub), sub[:-1]
        xd, yd = x - x.mean(), y - y.mean()
        den = (xd ** 2).sum()
        if den < 1e-10:
            continue
        slope = (xd * yd).sum() / den
        if slope < 0:
            out[i] = -np.log(2.0) / slope
    return out


def ref_ema(x, span):
    alpha = 2.0 / (span + 1)
    out = np.full(len(x), np.nan)
    start = int(np.argmax(np.isfinite(x)))
    out[start] = x[start]
    for i in range(start + 1, len(x)):
        out[i] = alpha * x[i] + (1.0 - alpha) * out[i - 1] if np.isfinite(x[i]) else out[i - 1]
    return out


def _ref_extreme(x, w, better):
    out = np.full(len(x), np.nan)
    dq: deque[int] = deque()
    for i in range(len(x)):
        while dq and better(x[dq[-1]], x[i]):
            dq.pop()
        dq.append(i)
        if dq[0] <= i - w:
            dq.popleft()
        if i >= w - 1:
            out[i] = x[dq[0]]
    return out


def ref_rmax(x, w):
    return _ref_extreme(x, w, lambda a, b: a <= b)


def ref_rmin(x, w):
    return _ref_extreme(x, w, lambda a, b: a >= b)


def ref_predict_from_index(model, index_df, stock_df, symbol, beta=1.0):
    idx = index_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    stk = stock_df.sort("date").filter(pl.col("close").is_not_null() & pl.col("close").gt(0))
    close = idx["close"].to_numpy().astype(np.float64)
    volume = idx["volume"].fill_null(0).to_numpy().astype(np.float64)
    dates = idx["date"].to_list()
    obs, valid = ref_make_obs(close, volume)
    oc = obs[valid]
    nmf = model.means_.shape[1]
    if oc.shape[1] < nmf:
        oc = np.column_stack([oc, np.zeros((oc.shape[0], nmf - oc.shape[1]))])
    seq, post = model.predict(oc), model.predict_proba(oc)
    smap = _map_states(model)
    offset = len(close) - len(oc)
    d2r, d2p = {}, {}
    for i, raw in enumerate(seq):
        d = dates[offset + i]
        d2r[d] = smap[int(raw)]
        probs = {s: 0.0 for s in range(5)}
        for rs, ss in smap.items():
            probs[ss] = probs.get(ss, 0.0) + float(post[i, rs])
        d2p[d] = probs
    keys = sorted(d2r)
    bc = float(np.clip(beta, 0.1, 4.0))
    bw = {0: bc, 1: bc, 2: 1.0 / bc, 3: bc, 4: bc}
    recs = []
    for d in stk["date"].to_list():
        lo, hi = 0, len(keys) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            lo, hi = (mid, hi) if keys[mid] <= d else (lo, mid - 1)
        if keys[lo] > d:
            continue
        sem, prob = d2r[keys[lo]], d2p[keys[lo]]
        sc = {s: prob.get(s, 0.0) * bw[s] for s in range(5)}
        tot = sum(sc.values()) or 1.0
        recs.append({"date": d, "regime": sem, "regime_label": REGIME_LABELS[sem],
                     **{k: sc[i] / tot for i, k in enumerate(
                         ["prob_bull", "prob_bear", "prob_range", "prob_crash", "prob_recovery"])}})
    return pl.DataFrame(recs)


# ---------------------------------------------------------------------------

def check(name: str, got: np.ndarray, want: np.ndarray, tol: float = 1e-9) -> None:
    ng, nw = np.isnan(got), np.isnan(want)
    if not (ng == nw).all():
        FAILURES.append(f"{name}: NaN pattern differs")
        print(f"  FAIL {name:26s} NaN pattern differs")
        return
    d = float(np.abs(got[~ng] - want[~nw]).max()) if (~ng).any() else 0.0
    ok = d <= tol
    if not ok:
        FAILURES.append(f"{name}: max|diff|={d:.3e}")
    print(f"  {'OK ' if ok else 'FAIL'} {name:26s} max|diff|={d:.3e}")


def load_prices(conn, sym: str) -> pl.DataFrame | None:
    df = conn.execute(
        "SELECT date, open, high, low, close, adj_close, volume "
        "FROM price_daily WHERE symbol = ? ORDER BY date", [sym]
    ).pl()
    return df if len(df) else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", type=int, default=5, help="how many symbols to check")
    args = ap.parse_args()

    conn = get_db()
    syms = [r[0] for r in conn.execute(
        "SELECT symbol FROM price_daily WHERE symbol NOT LIKE '^%' "
        "GROUP BY symbol HAVING COUNT(*) > 600 ORDER BY symbol LIMIT ?", [args.symbols]
    ).fetchall()]
    if not syms:
        print("No price history in engine.duckdb — run the engine first.")
        return 1

    print("=== feature primitives ===")
    for sym in syms:
        df = load_prices(conn, sym)
        close = df["close"].to_numpy().astype(np.float64)
        ret = np.empty(len(close))
        ret[0] = np.nan
        ret[1:] = np.log(close[1:] / close[:-1])
        lp = np.log(close)
        print(f"{sym} ({len(close)} bars)")
        for w in (10, 20, 63):
            check(f"rolling_std w={w}", F._rolling_std_fast(ret, w), ref_rolling_std(ret, w))
        for w in (5, 21, 252):
            check(f"rolling_return w={w}", F._rolling_return(close, w), ref_rolling_return(close, w))
        for w in (21, 63):
            check(f"skew w={w}", F._rolling_skew_fast(ret, w), ref_skew(ret, w))
            check(f"kurt w={w}", F._rolling_kurt_fast(ret, w), ref_kurt(ret, w))
            check(f"ou_halflife w={w}", F._rolling_ou_halflife(lp, w), ref_ou(lp, w))
        for w in (63, 252):
            check(f"maxdd w={w}", F._rolling_max_drawdown_fast(close, w), ref_mdd(close, w))
        for q in (5, 21):
            check(f"variance_ratio q={q}", F._variance_ratio(ret, q, 63), ref_vr(ret, q, 63))
        for span in (9, 12, 26):
            check(f"ema span={span}", F._ema(close, span), ref_ema(close, span), tol=1e-8)
        for w in (20, 260):
            check(f"rolling_max w={w}", F._rolling_max_fast(close, w), ref_rmax(close, w))
            check(f"rolling_min w={w}", F._rolling_min_fast(close, w), ref_rmin(close, w))

    print("\n=== build_features(emit_rows=1) is a suffix of the full emit ===")
    for sym in syms[:3]:
        df = load_prices(conn, sym)
        full, one = F.build_features(df, sym), F.build_features(df, sym, emit_rows=1)
        ref = full.filter(pl.col("date") == full["date"].max()).sort("feature")
        got = one.sort("feature")
        if got.shape != ref.shape or got["feature"].to_list() != ref["feature"].to_list():
            FAILURES.append(f"{sym}: emit_rows shape/features differ")
            print(f"  FAIL {sym}: {got.shape} vs {ref.shape}")
            continue
        check(f"{sym} latest-bar values", got["value"].to_numpy(), ref["value"].to_numpy(), tol=0.0)

    print("\n=== index regime posteriors ===")
    idx = load_prices(conn, "^GSPC")
    if idx is None or idx["close"].null_count() == len(idx):
        print("  SKIP: no ^GSPC history (run the engine with fetching enabled first)")
    else:
        obs_new, valid_new = _make_obs(
            idx["close"].to_numpy().astype(np.float64),
            idx["volume"].fill_null(0).to_numpy().astype(np.float64))
        obs_ref, valid_ref = ref_make_obs(
            idx["close"].to_numpy().astype(np.float64),
            idx["volume"].fill_null(0).to_numpy().astype(np.float64))
        if (valid_new == valid_ref).all():
            fin = np.isfinite(obs_ref)
            check("_make_obs", obs_new[fin], obs_ref[fin], tol=1e-12)
        else:
            FAILURES.append("_make_obs: valid mask differs")
            print("  FAIL _make_obs valid mask differs")

        model = fit_market_regime(idx, macro_features={"vix_zscore": 0.4, "yield_curve_2s10s": 0.01})
        if model is None:
            print("  SKIP: HMM did not train")
        else:
            post = IndexRegimePosteriors(model, idx)
            for sym, beta in zip(syms[:3], (1.0, 1.7, 0.55)):
                sdf = load_prices(conn, sym)
                new = predict_regimes_from_index(model, idx, sdf, sym, beta=beta, posteriors=post)
                ref = ref_predict_from_index(model, idx, sdf, sym, beta=beta)
                if new["date"].to_list() != ref["date"].to_list():
                    FAILURES.append(f"{sym}: regime dates differ")
                    print(f"  FAIL {sym} regime dates differ")
                    continue
                if new["regime"].to_list() != ref["regime"].to_list():
                    FAILURES.append(f"{sym}: regime states differ")
                    print(f"  FAIL {sym} regime states differ")
                    continue
                worst = max(
                    float(np.abs(new[c].to_numpy() - ref[c].to_numpy()).max())
                    for c in ("prob_bull", "prob_bear", "prob_range", "prob_crash", "prob_recovery")
                )
                check(f"{sym} posteriors (beta={beta})",
                      np.array([worst]), np.array([0.0]), tol=1e-12)

    conn.close()
    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}):")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("ALL ENGINE EQUIVALENCE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
