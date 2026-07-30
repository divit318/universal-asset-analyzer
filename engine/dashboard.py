"""
Today's Brief — the Quant Engine's market-wide summary.

Everything the /engine desk's hero, changed-today, conviction-book, factor-lab
and breadth sections need, computed in ONE read-only pass over engine.duckdb
and emitted as a single JSON blob.

Two consumers, and the distinction matters for how the page feels:

  1. `daily_run.py` calls `write_snapshot(conn)` at each of its export stages,
     which lands the blob at data/engine_dashboard.json. The API route serves
     that file directly — no Python spawn, no DuckDB open, ~1ms.
  2. `python -m engine.dashboard --write` regenerates the same file on demand
     (first-time backfill, or after a run that predates this module). The API
     route only falls back to this, under a hard timeout, and never blocks a
     page paint on it: a cold read of a multi-GB engine.duckdb can take
     minutes on a cold page cache even though the queries themselves are
     instant, which is precisely the "engine appears to hang" failure this
     file-first design exists to eliminate.

Read-only by design: never takes engine.duckdb's write lock, so it is safe to
call while `daily_run.py` is running.
"""

from __future__ import annotations

import json
import os
import tempfile
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import duckdb

from engine.data.loader import DB_PATH
from engine.models.factors import _DEFAULT_WEIGHTS

SNAPSHOT_PATH = Path(__file__).parents[1] / "data" / "engine_dashboard.json"

# Why the model is in each state — the page shows this next to the regime label
# so the regime is an explanation, not an unsourced verdict.
REGIME_EXPLANATIONS = {
    "Bull": "Positive drift with contained volatility across the tracked universe — the model's highest-return state.",
    "Bear": "Persistent negative drift — the model is pricing continued downside pressure.",
    "Range": "No clear directional edge; returns and volatility both sit near their historical median.",
    "Crash": "Sharp negative returns with elevated volatility — the model's most defensive state.",
    "Recovery": "Volatility easing off a drawdown with returns turning positive — historically the strongest state after Crash.",
}

# What each state implies for how the desk should be positioned.
REGIME_STANCE = {
    "Bull": "Risk-on. Momentum carries the most weight; lean into trend and accept beta.",
    "Bear": "Risk-off. Quality and low-vol dominate; treat momentum longs with suspicion.",
    "Range": "Neutral. Mean-reversion and value do the work; size positions down.",
    "Crash": "Defensive. Preserve capital — the model's expected return is negative across most names.",
    "Recovery": "Accumulate. Highest historical forward returns, but confidence is usually thinnest here.",
}

# Annualised mean return the engine assigns each HMM state (mirrors
# _compute_regime_score in daily_run.py — kept in sync so the UI can show the
# arithmetic behind the regime score rather than asserting a number).
REGIME_MU = {"Bull": 0.18, "Bear": -0.12, "Range": 0.04, "Crash": -0.35, "Recovery": 0.22}

_SCORECARD_COLS = [
    "symbol", "momentum_score", "quality_score", "value_score", "low_vol_score",
    "revision_score", "regime_score", "forecast_score", "mc_upside",
    "kelly_fraction", "composite_score", "signal", "confidence",
]

_FACTOR_KEYS = ["momentum", "quality", "value", "low_vol", "revision", "regime", "mc_upside"]
_WEIGHT_COLS = ["date"] + _FACTOR_KEYS

_BULLISH = ("STRONG_BUY", "BUY")
_BEARISH = ("STRONG_SELL", "SELL")
_ACTIONABLE = _BULLISH + _BEARISH
_SIGNAL_ORDER = ["STRONG_BUY", "BUY", "HOLD", "SELL", "STRONG_SELL"]


def _q(conn: duckdb.DuckDBPyConnection, sql: str, params: list | None = None) -> list[tuple]:
    """Query, tolerating a missing table/column — the schema grows over time and
    an older engine.duckdb must still produce a partial brief rather than a 500."""
    try:
        return conn.execute(sql, params or []).fetchall()
    except Exception:
        return []


def _rd(v, n: int = 4):
    return round(v, n) if isinstance(v, (int, float)) else None


# --------------------------------------------------------------------------- #
# Regime                                                                      #
# --------------------------------------------------------------------------- #

def _regime_brief(conn: duckdb.DuckDBPyConnection) -> dict | None:
    """Market-wide regime: the modal per-symbol HMM label, plus the universe-average
    posterior over all five states, plus how many names agree with the modal call."""
    rows = _q(conn, """
        SELECT regime_label, prob_bull, prob_bear, prob_range, prob_crash, prob_recovery
        FROM regime_daily WHERE date = (SELECT MAX(date) FROM regime_daily)
    """)
    if not rows:
        return None

    n = len(rows)
    labels = Counter(r[0] for r in rows if r[0])
    top_label, top_count = labels.most_common(1)[0] if labels else (None, 0)
    avg = {
        "prob_bull": sum((r[1] or 0) for r in rows) / n,
        "prob_bear": sum((r[2] or 0) for r in rows) / n,
        "prob_range": sum((r[3] or 0) for r in rows) / n,
        "prob_crash": sum((r[4] or 0) for r in rows) / n,
        "prob_recovery": sum((r[5] or 0) for r in rows) / n,
    }
    # Expected annualised return implied by the averaged posterior — the single
    # number that turns five probabilities into a stance.
    expected_return = sum(
        avg[f"prob_{k.lower()}"] * mu for k, mu in REGIME_MU.items()
    )

    # How the modal label has held up over the last ~40 sessions: a regime that
    # only just flipped is a very different fact from one that's 3 weeks old.
    hist = _q(conn, """
        SELECT date, regime_label, COUNT(*) AS n
        FROM regime_daily
        WHERE date >= (SELECT MAX(date) FROM regime_daily) - INTERVAL 90 DAY
        GROUP BY date, regime_label ORDER BY date
    """)
    by_date: dict = defaultdict(dict)
    for d, label, cnt in hist:
        if label:
            by_date[str(d)][label] = cnt
    history = [
        {"date": d, "label": max(counts, key=lambda k: counts[k]),
         "breadth_pct": round(max(counts.values()) / max(1, sum(counts.values())) * 100, 1)}
        for d, counts in sorted(by_date.items())
    ]
    # Sessions the modal label has been continuously in force.
    days_in_regime = 0
    for point in reversed(history):
        if point["label"] != top_label:
            break
        days_in_regime += 1

    return {
        "label": top_label,
        "breadth_pct": round(top_count / n * 100, 1),
        "confidence": _rd(max(avg.values()), 3) if avg else None,
        "probabilities": {k: _rd(v, 3) for k, v in avg.items()},
        "expected_annual_return": _rd(expected_return, 4),
        "explanation": REGIME_EXPLANATIONS.get(top_label, ""),
        "stance": REGIME_STANCE.get(top_label, ""),
        "mu": REGIME_MU,
        "days_in_regime": days_in_regime,
        "history": history,
        "n_symbols": n,
    }


# --------------------------------------------------------------------------- #
# Factor weights                                                              #
# --------------------------------------------------------------------------- #

def _factor_weights(conn: duckdb.DuckDBPyConnection) -> dict:
    """The engine re-derives its factor weights from realized IC every run. This
    surfaces both the current weighting and its history, so the page can show
    that the composite adapts instead of being a fixed formula."""
    rows = _q(conn, f"SELECT {', '.join(_WEIGHT_COLS)} FROM ic_weights_daily ORDER BY date DESC LIMIT 60")
    history = [
        {k: (str(v) if k == "date" else _rd(v)) for k, v in zip(_WEIGHT_COLS, r)}
        for r in rows
    ]

    if history:
        current = history[0]
        source = "ic"
    else:
        # No persisted weights yet (engine.duckdb predates ic_weights_daily).
        # Show the documented defaults, labelled as such, rather than an empty
        # panel that implies the model has no weighting at all.
        current = {"date": None, **{k: _DEFAULT_WEIGHTS.get(k) for k in _FACTOR_KEYS}}
        source = "default"

    live = {k: v for k in _FACTOR_KEYS if (v := current.get(k)) is not None}
    top_factor = max(live, key=lambda k: live[k]) if live else None

    # Leadership rotation: which factor gained/lost the most weight vs the
    # oldest run we still have on file.
    shifts: list[dict] = []
    if len(history) > 1:
        oldest = history[-1]
        for k in _FACTOR_KEYS:
            now, then = current.get(k), oldest.get(k)
            if now is None or then is None:
                continue
            shifts.append({"factor": k, "from": then, "to": now, "delta": _rd(now - then)})
        shifts.sort(key=lambda s: abs(s["delta"] or 0), reverse=True)

    return {
        "current": current,
        "source": source,
        "top_factor": top_factor,
        "shifts": shifts[:4],
        "history": list(reversed(history)),
        "n_runs": len(history),
    }


# --------------------------------------------------------------------------- #
# Enrichment                                                                  #
# --------------------------------------------------------------------------- #

def _meta_map(conn: duckdb.DuckDBPyConnection) -> dict[str, dict]:
    return {
        r[0]: {"name": r[1], "sector": r[2]}
        for r in _q(conn, "SELECT symbol, name, sector FROM fundamentals")
    }


def _forecast_map(conn: duckdb.DuckDBPyConnection) -> dict[str, dict]:
    """Latest ~1-month probability band per symbol. Powers the probability bars in
    the conviction book — the distribution, not just a point score."""
    rows = _q(conn, """
        SELECT symbol, p10, p50, p90, prob_up FROM forecasts
        WHERE date = (SELECT MAX(date) FROM forecasts)
          AND horizon_days = (
            SELECT horizon_days FROM forecasts
            WHERE date = (SELECT MAX(date) FROM forecasts)
            ORDER BY ABS(horizon_days - 21) LIMIT 1
          )
    """)
    return {
        r[0]: {"p10": _rd(r[1]), "p50": _rd(r[2]), "p90": _rd(r[3]), "prob_up": _rd(r[4], 3)}
        for r in rows
    }


def _enrich(row: dict, meta: dict, forecasts: dict) -> dict:
    m = meta.get(row["symbol"], {})
    return {
        **{k: (_rd(v) if isinstance(v, float) else v) for k, v in row.items()},
        "name": m.get("name"),
        "sector": m.get("sector"),
        "forecast": forecasts.get(row["symbol"]),
    }


# --------------------------------------------------------------------------- #
# Breadth                                                                     #
# --------------------------------------------------------------------------- #

def _breadth(latest: list[dict], meta: dict[str, dict]) -> dict:
    n_total = len(latest)
    n_bullish = sum(1 for r in latest if r["signal"] in _BULLISH)
    n_bearish = sum(1 for r in latest if r["signal"] in _BEARISH)
    n_pos_momentum = sum(1 for r in latest if (r["momentum_score"] or 0) > 0)

    def pct(n: int) -> float:
        return round(n / n_total * 100, 1) if n_total else 0.0

    # Per-sector view. Deliberately NOT the average composite: the engine
    # z-scores its factors *within sector*, so every sector's mean composite is
    # ~0 by construction and a heatmap of it would be pure rounding noise. What
    # does survive sector-neutralisation is the signal tilt (how many names in
    # the sector cleared the actionable threshold), the dispersion (how much
    # disagreement there is inside the sector), and the sector's best name.
    buckets: dict[str, list[dict]] = defaultdict(list)
    for r in latest:
        sector = (meta.get(r["symbol"], {}) or {}).get("sector")
        if sector:
            buckets[sector].append(r)

    sectors = []
    for sector, rows in buckets.items():
        if len(rows) < 2:
            continue
        scores = [r["composite_score"] or 0.0 for r in rows]
        mean = sum(scores) / len(scores)
        var = sum((s - mean) ** 2 for s in scores) / len(scores)
        n_bull = sum(1 for r in rows if r["signal"] in _BULLISH)
        n_bear = sum(1 for r in rows if r["signal"] in _BEARISH)
        best = max(rows, key=lambda r: r["composite_score"] or 0.0)
        sectors.append({
            "sector": sector,
            "n": len(rows),
            "n_bullish": n_bull,
            "n_bearish": n_bear,
            # Net tilt in percentage points of the sector's names: the heatmap value.
            "net_tilt_pct": round((n_bull - n_bear) / len(rows) * 100, 1),
            "dispersion": _rd(var ** 0.5),
            "best_symbol": best["symbol"],
            "best_composite": _rd(best["composite_score"] or 0.0),
        })
    sectors.sort(key=lambda s: (s["net_tilt_pct"], s["best_composite"] or 0), reverse=True)

    dist = Counter(r["signal"] for r in latest if r["signal"])
    composites = sorted((r["composite_score"] or 0.0) for r in latest)

    return {
        "n_total": n_total,
        "n_bullish": n_bullish,
        "n_bearish": n_bearish,
        "n_neutral": n_total - n_bullish - n_bearish,
        "pct_bullish": pct(n_bullish),
        "pct_bearish": pct(n_bearish),
        "pct_positive_momentum": pct(n_pos_momentum),
        "signal_distribution": [
            {"signal": s, "count": dist.get(s, 0)} for s in _SIGNAL_ORDER if dist.get(s)
        ],
        "composite_percentiles": {
            p: _rd(composites[min(len(composites) - 1, int(len(composites) * f))])
            for p, f in (("p10", 0.10), ("p50", 0.50), ("p90", 0.90))
        } if composites else {},
        "sectors": sectors,
    }


# --------------------------------------------------------------------------- #
# Movers                                                                      #
# --------------------------------------------------------------------------- #

def _movers(latest_by_symbol: dict[str, dict], prev_by_symbol: dict[str, dict],
            meta: dict[str, dict]) -> dict:
    """What changed since the previous run — the answer to "why am I looking at
    this today rather than yesterday"."""
    upgrades: list[dict] = []
    downgrades: list[dict] = []
    signals_added: list[dict] = []
    signals_removed: list[dict] = []

    for sym, row in latest_by_symbol.items():
        prev = prev_by_symbol.get(sym)
        if not prev:
            continue
        delta = (row["composite_score"] or 0.0) - (prev["composite_score"] or 0.0)
        entry = {
            "symbol": sym,
            "name": (meta.get(sym, {}) or {}).get("name"),
            "delta": _rd(delta),
            "composite_score": _rd(row["composite_score"] or 0.0),
            "prev_composite_score": _rd(prev["composite_score"] or 0.0),
            "signal": row["signal"],
            "prev_signal": prev["signal"],
            "tier_changed": row["signal"] != prev["signal"],
        }
        if delta > 0:
            upgrades.append(entry)
        elif delta < 0:
            downgrades.append(entry)

        was_actionable = prev["signal"] not in (None, "HOLD")
        is_actionable = row["signal"] not in (None, "HOLD")
        if is_actionable and not was_actionable:
            signals_added.append({"symbol": sym, "name": entry["name"], "signal": row["signal"],
                                  "composite_score": entry["composite_score"]})
        elif was_actionable and not is_actionable:
            signals_removed.append({"symbol": sym, "name": entry["name"], "signal": prev["signal"],
                                    "composite_score": entry["composite_score"]})

    upgrades.sort(key=lambda r: r["delta"], reverse=True)
    downgrades.sort(key=lambda r: r["delta"])

    return {
        "upgrades": upgrades[:8],
        "downgrades": downgrades[:8],
        "signals_added": signals_added[:10],
        "signals_removed": signals_removed[:10],
        "n_compared": sum(1 for s in latest_by_symbol if s in prev_by_symbol),
    }


# --------------------------------------------------------------------------- #
# Build                                                                       #
# --------------------------------------------------------------------------- #

def build_dashboard(conn: duckdb.DuckDBPyConnection | None = None) -> dict:
    """Assemble the brief. Pass an existing connection (daily_run does) to avoid
    a second open against a database this process already holds."""
    own = conn is None
    if own:
        conn = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        dates = _q(conn, "SELECT DISTINCT date FROM scorecard_daily ORDER BY date DESC LIMIT 2")
        if not dates:
            return {"empty": True, "reason": "No scorecard data yet — run the engine to score a universe."}

        latest_date = dates[0][0]
        prev_date = dates[1][0] if len(dates) > 1 else None

        latest_rows = _q(conn, f"SELECT {', '.join(_SCORECARD_COLS)} FROM scorecard_daily WHERE date = ?", [latest_date])
        latest = [dict(zip(_SCORECARD_COLS, r)) for r in latest_rows]
        latest_by_symbol = {r["symbol"]: r for r in latest}

        prev_by_symbol: dict[str, dict] = {}
        if prev_date:
            prev_by_symbol = {
                r[0]: {"composite_score": r[1], "signal": r[2]}
                for r in _q(conn, "SELECT symbol, composite_score, signal FROM scorecard_daily WHERE date = ?", [prev_date])
            }

        meta = _meta_map(conn)
        forecasts = _forecast_map(conn)

        # Conviction book: rank actionable calls by score × confidence, so a
        # high score the model doesn't trust ranks below a moderate one it does.
        actionable = [r for r in latest if r["signal"] in _ACTIONABLE]
        longs = sorted(
            (r for r in actionable if r["signal"] in _BULLISH),
            key=lambda r: (r["composite_score"] or 0) * (r["confidence"] or 0), reverse=True,
        )[:10]
        shorts = sorted(
            (r for r in actionable if r["signal"] in _BEARISH),
            key=lambda r: (r["composite_score"] or 0) * (r["confidence"] or 0),
        )[:10]

        return {
            "empty": False,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "latest_date": str(latest_date),
            "prev_date": str(prev_date) if prev_date else None,
            "n_symbols": len(latest),
            "regime": _regime_brief(conn),
            "factor_weights": _factor_weights(conn),
            "breadth": _breadth(latest, meta),
            "movers": _movers(latest_by_symbol, prev_by_symbol, meta),
            "conviction": {
                "longs": [_enrich(r, meta, forecasts) for r in longs],
                "shorts": [_enrich(r, meta, forecasts) for r in shorts],
                "has_forecasts": bool(forecasts),
            },
        }
    finally:
        if own:
            conn.close()


def write_snapshot(conn: duckdb.DuckDBPyConnection | None = None) -> Path:
    """Write the brief to data/engine_dashboard.json atomically (tmp + rename), so
    the API route can never observe a half-written file."""
    payload = build_dashboard(conn)
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(SNAPSHOT_PATH.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(payload, fh, default=str)
        os.replace(tmp, SNAPSHOT_PATH)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    return SNAPSHOT_PATH


if __name__ == "__main__":
    import sys

    if "--write" in sys.argv:
        print(str(write_snapshot()))
    else:
        print(json.dumps(build_dashboard(), default=str))
