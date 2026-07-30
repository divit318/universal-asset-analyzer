/**
 * Shared RETURN STATISTICS — pure, deterministic, no I/O.
 *
 * ── What this module is ──────────────────────────────────────────────────────
 *
 * The seven primitives below are the app's one implementation of each formula:
 * mean, standard deviation, Pearson correlation, a daily return series, downside
 * deviation, the Sharpe/Sortino pair, and maximum drawdown. The universal
 * Portfolio risk engine, the cash engine, the screener's metrics and the
 * crypto/commodity/forex scorers all import them rather than reimplementing the
 * same arithmetic — the same reasoning that promoted mk()/bucket() to score-math.ts.
 *
 * ── What this module WAS ─────────────────────────────────────────────────────
 *
 * It also held `computePortfolioReport()`: a second, equity-only portfolio engine
 * with its own health score, its own risk analytics, its own recommendations, its
 * own alerts, its own scenario shocks and its own benchmark comparison. It was the
 * Portfolio subsystem's other source of truth, and it disagreed with the universal
 * engine by construction:
 *
 *   • total return used a different denominator (priced positions only);
 *   • the benchmark was a fixed 252-day SPY window rather than the portfolio's own
 *     holding period, so a six-month-old book was compared against a year of SPY;
 *   • it saw ticker positions only — cash appeared as a synthetic `CASH-USD`
 *     "stock" and manually-valued assets (property, private stakes, collectibles)
 *     not at all, so every weight it produced used the wrong denominator on any
 *     book holding either;
 *   • it scored bonds and funds through equity fundamentals, the exact defect the
 *     universal class adapters exist to prevent.
 *
 * It is deleted. `lib/portfolio/report.ts` (`buildPortfolioReport`) is the one
 * canonical Portfolio analytics pipeline, and every former caller now reads it.
 * The IOS's objective/constraint vocabulary moved to lib/ios/types.ts, where it
 * belongs. Nothing here builds a report any more; if you are looking for portfolio
 * analytics, this is the wrong file.
 */

import type { HistoryPoint } from "./types";

/** Clamp a value into a range. Used by pearson() to bound float error at ±1. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

export function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let cov = 0, varx = 0, vary = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cov += dx * dy;
    varx += dx * dx;
    vary += dy * dy;
  }
  const denom = Math.sqrt(varx * vary);
  return denom === 0 ? 0 : clamp(cov / denom, -1, 1);
}

export function dailyReturns(history: HistoryPoint[]): number[] {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    ret.push(prev === 0 ? 0 : (closes[i] - prev) / prev);
  }
  return ret;
}

/**
 * Target semi-deviation (downside deviation) of a daily return series about a
 * minimum acceptable return, annualized. Exported for tests.
 *
 * This is the textbook denominator of the Sortino ratio:
 *
 *     σ_D = sqrt( (1/N) · Σ min(rᵢ − MAR, 0)² ) · √252
 *
 * Two properties matter, and the previous implementation had neither.
 *
 *  1. Deviations are measured FROM THE MAR, not from the mean of the losing
 *     subset. `stddev(losses)` measures how much the losses differ from EACH
 *     OTHER, which is a different quantity entirely — and it collapses toward
 *     zero exactly when losses are consistent. A book bleeding a steady −0.2%
 *     on every down day has near-zero dispersion among its losses, so the old
 *     denominator went to ~0 and the ratio exploded: a measured Sortino of
 *     4.25e14 on a portfolio whose true Sortino is 0.84. The single worst kind
 *     of error a risk metric can make — unboundedly flattering, precisely for a
 *     portfolio that is steadily losing money.
 *
 *  2. The sum is divided by N (ALL periods), not by the number of losing
 *     periods. Dividing by the loss count answers "how bad is a bad day"; the
 *     Sortino denominator must answer "how much downside does this series carry"
 *     — which depends on how OFTEN losses occur, not just their size. Dividing
 *     by the loss count understates the denominator and inflated a typical
 *     series' Sortino by ~64% (measured: 2.23 reported vs 1.36 correct).
 */
export function downsideDeviation(
  returns: number[],
  dailyMar: number,
  periodsPerYear = 252,
): number {
  if (returns.length === 0) return 0;
  let sumSq = 0;
  for (const r of returns) {
    const shortfall = Math.min(r - dailyMar, 0);
    sumSq += shortfall * shortfall;
  }
  return Math.sqrt(sumSq / returns.length) * Math.sqrt(periodsPerYear);
}

/**
 * Annualized Sharpe/Sortino from a daily *decimal* return series (0.001 = 0.1%).
 * The risk-free rate is annual decimal (default 4.25% T-bill) — converted to a
 * daily decimal before comparing against daily returns; mixing percent and
 * decimal units here previously produced Sharpe ratios ~100× too negative.
 * Exported for tests.
 *
 * Both ratios use the SAME numerator — annualized excess return over the
 * risk-free rate — and differ only in the denominator (total vs downside
 * deviation). That is what makes them comparable, and it is why Sortino ≥ Sharpe
 * for any series whose losses are less dispersed than its gains.
 *
 * Either can be null. A series with no observed downside has an UNDEFINED
 * Sortino, not an infinite one and not a copy of its Sharpe: the previous code
 * substituted the full-series deviation whenever fewer than two losing days
 * existed, which silently returned the Sharpe ratio under a different label.
 *
 * A DETERMINISTIC series (no dispersion at all) has no risk to adjust for, so
 * both ratios are null. That guard is on a floating-point EPSILON, not on
 * `> 0`: the residue left by summing 252 copies of 0.001 gives `stddev` a value
 * around 1e-19 rather than exactly zero, and dividing by it produced a reported
 * Sharpe of 2.0e16. `> 0` is not a sufficient zero-check for a variance.
 */
const MIN_DAILY_DEVIATION = 1e-12;

export function computeRiskAdjustedRatios(
  portReturns: number[],
  annualRiskFree = 0.0425,
): { sharpe: number | null; sortino: number | null } {
  const dailyVol = stddev(portReturns);
  const avgDailyReturn = mean(portReturns);
  const dailyRiskFree = annualRiskFree / 252;
  const annualizedExcess = (avgDailyReturn - dailyRiskFree) * 252;

  // No dispersion → neither ratio means anything, however far the series sits
  // from the risk-free rate.
  if (dailyVol < MIN_DAILY_DEVIATION) return { sharpe: null, sortino: null };

  const sharpe = annualizedExcess / (dailyVol * Math.sqrt(252));

  const downsideVol = downsideDeviation(portReturns, dailyRiskFree);
  const sortino =
    downsideVol >= MIN_DAILY_DEVIATION * Math.sqrt(252)
      ? annualizedExcess / downsideVol
      : null;

  return { sharpe, sortino };
}

export function maxDrawdown(returns: number[]): number {
  let peak = 1;
  let maxDD = 0;
  let value = 1;
  for (const r of returns) {
    value *= 1 + r;
    if (value > peak) peak = value;
    const dd = (value - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

