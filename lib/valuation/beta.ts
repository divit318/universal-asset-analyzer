/**
 * Benchmark-correct beta from price history.
 *
 * Yahoo's `beta` field regresses every listing against the S&P 500, whatever
 * the home market. For NSE/BSE names that produces betas of 0.15–0.4 where the
 * NIFTY-relative figure is ~1.0 (measured live: TCS 0.164 vs 0.89, RELIANCE
 * 0.157 vs 1.08, HDFCBANK 0.414 vs 1.02) — which fed CAPM discount rates
 * BELOW the Indian risk-free rate and inflated every Indian DCF. This module
 * computes beta against the listing's own market benchmark instead.
 *
 * The math deliberately MIRRORS `compute_rolling_beta` in
 * engine/models/monte_carlo.py — 252-day window on date-aligned daily log
 * returns, OLS, Blume–Vasicek shrinkage (0.67·raw + 0.33·1.0), clipped to
 * [0.1, 4.0] — so the deterministic DCF and the Monte Carlo engine discount
 * the same name at the same rate. tests/valuation-beta.test.ts pins parity
 * against values computed by the Python implementation itself.
 */

import type { HistoryPoint } from "../types";

export const BETA_WINDOW_DAYS = 252;
const MIN_JOINED_ROWS = 60;
const MIN_RETURNS = 30;
const SHRINK_RAW = 0.67;
const SHRINK_PRIOR = 0.33;
const BETA_MIN = 0.1;
const BETA_MAX = 4.0;

/** How a valuation's beta was obtained — surfaces label regressions vs vendor figures. */
export type BetaSource = "benchmark_regression" | "yahoo" | "default";

/**
 * Shrunk OLS beta of `asset` vs `benchmark`, or null when the overlapping
 * history is too thin to regress (the caller decides the fallback).
 */
export function betaVsBenchmark(
  asset: HistoryPoint[],
  benchmark: HistoryPoint[],
): number | null {
  if (!asset?.length || !benchmark?.length) return null;

  const benchByDate = new Map<string, number>();
  for (const p of benchmark) {
    if (p.close > 0 && Number.isFinite(p.close)) benchByDate.set(p.date, p.close);
  }

  // Align on shared dates (inner join), keep the most recent window.
  const joined: [number, number][] = [];
  for (const p of asset) {
    const b = benchByDate.get(p.date);
    if (b != null && p.close > 0 && Number.isFinite(p.close)) joined.push([p.close, b]);
  }
  const window = joined.slice(-BETA_WINDOW_DAYS);
  if (window.length < MIN_JOINED_ROWS) return null;

  const sRet: number[] = [];
  const iRet: number[] = [];
  for (let k = 1; k < window.length; k++) {
    const s = Math.log(window[k][0] / window[k - 1][0]);
    const i = Math.log(window[k][1] / window[k - 1][1]);
    if (Number.isFinite(s) && Number.isFinite(i)) {
      sRet.push(s);
      iRet.push(i);
    }
  }
  if (sRet.length < MIN_RETURNS) return null;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sMean = mean(sRet);
  const iMean = mean(iRet);
  let varI = 0;
  let cov = 0;
  for (let k = 0; k < iRet.length; k++) {
    varI += (iRet[k] - iMean) ** 2;
    cov += (sRet[k] - sMean) * (iRet[k] - iMean);
  }
  if (varI < 1e-12) return null;

  const raw = cov / varI;
  const shrunk = SHRINK_RAW * raw + SHRINK_PRIOR * 1.0;
  return Math.min(Math.max(shrunk, BETA_MIN), BETA_MAX);
}
