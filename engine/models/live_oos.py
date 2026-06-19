"""
Live OOS validation framework.

Captures daily signals in signal_log.csv, backfills fwd_return_21d when the
21-day forward window closes, then computes rolling live metrics:

  live_IC      : Spearman(composite_score, fwd_return_21d) over last 12 weeks
  hit_rate     : fraction of STRONG_BUY signals with fwd_return_21d > 0
  strong_buy_alpha : mean(fwd_return_21d | signal==STRONG_BUY) - mean(fwd_return_21d)
  sharpe_live  : mean / std of fwd_return_21d for all scored symbols, annualised

Degradation alerts (logged to signal_log_alerts.csv):
  - live_IC     < 0.02  for 4 consecutive weeks
  - hit_rate    < 0.50  for 4 consecutive weeks
  - sharpe_live < 0.30  for 4 consecutive weeks
"""

from __future__ import annotations

import csv
import warnings
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import polars as pl
from scipy.stats import spearmanr


_LOG_DIR    = Path(__file__).parents[2] / "data"
SIGNAL_LOG  = _LOG_DIR / "signal_log.csv"
ALERT_LOG   = _LOG_DIR / "signal_log_alerts.csv"

_SIGNAL_COLS = [
    "date", "symbol", "composite_score", "signal", "confidence",
    "forecast_p50", "prob_up", "fwd_return_21d",
]

# Degradation thresholds
_IC_FLOOR     = 0.02
_HITRATE_FLOOR = 0.50
_SHARPE_FLOOR  = 0.30
_ALERT_WEEKS   = 4   # consecutive weeks below threshold before alert fires


def append_signals(
    scorecard_rows: list[dict],
    price_map: dict[str, pl.DataFrame] | None = None,
) -> None:
    """
    Append today's signals to signal_log.csv.
    If price_map is provided, also attempts to backfill fwd_return_21d for rows
    that are now 21+ trading days old.
    """
    _LOG_DIR.mkdir(parents=True, exist_ok=True)
    write_header = not SIGNAL_LOG.exists()

    with open(SIGNAL_LOG, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=_SIGNAL_COLS, extrasaction="ignore")
        if write_header:
            writer.writeheader()
        for row in scorecard_rows:
            writer.writerow({
                "date":            str(row.get("date", "")),
                "symbol":          row.get("symbol", ""),
                "composite_score": row.get("composite_score", ""),
                "signal":          row.get("signal", ""),
                "confidence":      row.get("confidence", ""),
                "forecast_p50":    row.get("net_p50_ret", ""),
                "prob_up":         row.get("prob_up", ""),
                "fwd_return_21d":  "",  # filled later by backfill_returns
            })

    if price_map:
        backfill_returns(price_map)


def backfill_returns(price_map: dict[str, pl.DataFrame]) -> int:
    """
    For each row in signal_log.csv where fwd_return_21d is empty and
    the signal date is ≥ 21 trading days ago, fill in the actual return.

    Returns count of rows filled.
    """
    if not SIGNAL_LOG.exists():
        return 0

    rows: list[dict] = []
    with open(SIGNAL_LOG, newline="") as f:
        rows = list(csv.DictReader(f))

    today = date.today()
    filled = 0

    for row in rows:
        if row.get("fwd_return_21d"):
            continue
        try:
            signal_date = date.fromisoformat(row["date"])
        except (ValueError, KeyError):
            continue

        # Only fill if ≥ 25 calendar days have passed (proxy for 21 trading days)
        if (today - signal_date).days < 25:
            continue

        sym = row["symbol"]
        price_df = price_map.get(sym)
        if price_df is None or len(price_df) == 0:
            continue

        price_df = price_df.sort("date")
        dates = price_df["date"].to_list()
        closes = price_df["close"].to_numpy().astype(float)

        # Find index of signal_date or next available
        try:
            idx0 = next(i for i, d in enumerate(dates) if d >= signal_date)
        except StopIteration:
            continue

        # Find index ~21 trading days later
        idx1 = idx0 + 21
        if idx1 >= len(closes):
            continue

        if closes[idx0] > 0 and closes[idx1] > 0:
            row["fwd_return_21d"] = str(round(float(np.log(closes[idx1] / closes[idx0])), 6))
            filled += 1

    if filled > 0:
        with open(SIGNAL_LOG, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=_SIGNAL_COLS, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)

    return filled


def compute_live_metrics(lookback_days: int = 84) -> dict:
    """
    Compute rolling live OOS metrics from signal_log.csv.

    lookback_days = 84 → 12 weeks of daily signals.

    Returns dict with live_IC, hit_rate, strong_buy_alpha, sharpe_live.
    Returns empty dict if insufficient data (<20 rows with fwd_return_21d).
    """
    if not SIGNAL_LOG.exists():
        return {}

    rows: list[dict] = []
    with open(SIGNAL_LOG, newline="") as f:
        rows = list(csv.DictReader(f))

    cutoff = date.today() - timedelta(days=lookback_days)
    valid = []
    for row in rows:
        if not row.get("fwd_return_21d"):
            continue
        try:
            d = date.fromisoformat(row["date"])
            fwd = float(row["fwd_return_21d"])
            comp = float(row["composite_score"])
            sig = row.get("signal", "")
        except (ValueError, KeyError):
            continue
        if d >= cutoff:
            valid.append({"date": d, "composite": comp, "signal": sig, "fwd": fwd})

    if len(valid) < 20:
        return {}

    scores = np.array([r["composite"] for r in valid])
    fwds   = np.array([r["fwd"] for r in valid])

    corr, _ = spearmanr(scores, fwds)
    live_ic  = float(corr) if np.isfinite(corr) else 0.0

    sb = [r["fwd"] for r in valid if r["signal"] == "STRONG_BUY"]
    hit_rate       = float(np.mean(np.array(sb) > 0)) if sb else float("nan")
    strong_buy_alpha = float(np.mean(sb) - np.mean(fwds)) if sb else float("nan")

    sharpe_live = float(fwds.mean() / (fwds.std(ddof=1) + 1e-10) * np.sqrt(252)) if len(fwds) > 1 else float("nan")

    return {
        "live_IC":           round(live_ic, 4),
        "hit_rate":          round(hit_rate, 4) if np.isfinite(hit_rate) else None,
        "strong_buy_alpha":  round(strong_buy_alpha, 4) if np.isfinite(strong_buy_alpha) else None,
        "sharpe_live":       round(sharpe_live, 4) if np.isfinite(sharpe_live) else None,
        "n_obs":             len(valid),
    }


def check_degradation_alerts(metrics: dict) -> list[str]:
    """
    Compare live metrics against thresholds.
    Append new alerts to signal_log_alerts.csv.
    Returns list of alert message strings (empty = no alerts).

    Uses a simple stateless check: if today's metric is below threshold,
    write an alert. Caller can check frequency externally.
    """
    if not metrics:
        return []

    alerts = []
    today_str = str(date.today())

    checks = [
        ("live_IC",     metrics.get("live_IC"),     _IC_FLOOR,      "live_IC below floor"),
        ("hit_rate",    metrics.get("hit_rate"),     _HITRATE_FLOOR, "hit_rate below floor"),
        ("sharpe_live", metrics.get("sharpe_live"),  _SHARPE_FLOOR,  "sharpe_live below floor"),
    ]

    for name, value, floor, msg in checks:
        if value is not None and value < floor:
            alerts.append(f"{today_str} ALERT [{name}={value:.4f} < {floor}]: {msg}")

    if alerts:
        _LOG_DIR.mkdir(parents=True, exist_ok=True)
        write_header = not ALERT_LOG.exists()
        with open(ALERT_LOG, "a", newline="") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["timestamp", "metric", "value", "threshold", "message"])
            for a in alerts:
                parts = a.split(" ", 3)
                writer.writerow([parts[0], "", "", "", a])

    return alerts
