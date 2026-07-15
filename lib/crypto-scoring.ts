/**
 * Crypto decision scorer — the parallel to lib/scoring.ts (equity) and
 * lib/fund-scoring.ts (funds), market-data-only for this phase (no on-chain/
 * tokenomics provider yet — see lib/asset-class.ts / the Research Hub
 * roadmap). Built from Yahoo price history only, the same data source the
 * equity/fund paths already use.
 *
 * Deliberately does NOT reuse lib/scoring.ts's computeMomentum(): that
 * function's lerp ranges (e.g. ±25% for a 3-month return) are calibrated for
 * equity volatility. Crypto routinely moves 40%+ in 3 months and 70%+ off a
 * cycle high — reusing equity-calibrated ranges would pin the score at 0 or
 * 100 almost permanently, which is exactly the "forcing equity-style
 * analysis onto everything" this redesign exists to avoid. The underlying
 * pure statistics (stddev/mean/dailyReturns/maxDrawdown, promoted from
 * lib/portfolio-analytics.ts) ARE reused — only the calibration differs.
 */

import type { DecisionSignals, HistoryPoint, ScoreResult } from "./types";
import { mk, bucket } from "./score-math";
import { scoreToRecommendation } from "./recommendation";
import { dailyReturns, stddev, mean, maxDrawdown } from "./portfolio-analytics";

function windowReturn(history: HistoryPoint[]): number | null {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length < 2) return null;
  const first = closes[0], last = closes.at(-1)!;
  return first > 0 ? ((last - first) / first) * 100 : null;
}

function threeMonthReturn(history: HistoryPoint[]): number | null {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length < 20) return null;
  const back = closes.at(-Math.min(90, closes.length))!;
  const last = closes.at(-1)!;
  return back > 0 ? ((last - back) / back) * 100 : null;
}

function pctFromWindowHigh(history: HistoryPoint[]): number | null {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length === 0) return null;
  const hi = Math.max(...closes);
  const last = closes.at(-1)!;
  return hi > 0 ? ((last - hi) / hi) * 100 : null;
}

function momentumBucket(history: HistoryPoint[]) {
  const r3m = threeMonthReturn(history);
  const fromHigh = pctFromWindowHigh(history);
  return bucket("Momentum", [
    mk("3-month return", r3m, -40, 40, 13, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}% over 3 months`),
    // Crypto cycles routinely see 70%+ drawdowns from a prior high without
    // that being a durable "value" signal the way it might be for an equity.
    mk("vs recent high", fromHigh, -70, 0, 12, (v) => `${v.toFixed(0)}% vs high over the fetched window`),
  ]);
}

function relativeStrengthBucket(history: HistoryPoint[], btcHistory: HistoryPoint[] | null, isBtc: boolean) {
  if (isBtc || !btcHistory || btcHistory.length < 2) {
    return bucket("Relative Strength vs BTC", [
      mk("vs BTC (window return)", null, -30, 30, 25, () => ""),
    ]);
  }
  const assetReturn = windowReturn(history);
  const btcReturn = windowReturn(btcHistory);
  const relative = assetReturn != null && btcReturn != null ? assetReturn - btcReturn : null;
  return bucket("Relative Strength vs BTC", [
    mk("vs BTC (window return)", relative, -30, 30, 25, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}pp vs BTC over the fetched window`),
  ]);
}

function riskAdjustedBucket(returns: number[]) {
  // Crypto trades every calendar day (365), unlike equities' ~252 trading
  // days — using 252 here would understate annualized vol/return by ~10%.
  const vol = stddev(returns);
  const avgDaily = mean(returns);
  const annualReturn = avgDaily * 365;
  const annualVol = vol * Math.sqrt(365);
  const sharpe = annualVol > 0 ? annualReturn / annualVol : null;

  const downside = returns.filter((r) => r < 0);
  const downsideVol = stddev(downside.length >= 2 ? downside : returns) * Math.sqrt(365);
  const sortino = downsideVol > 0 ? annualReturn / downsideVol : null;

  return bucket("Risk-Adjusted Return", [
    mk("Sharpe (annualized)", sharpe, -1, 2, 13, (v) => `Sharpe ${v.toFixed(2)}`),
    mk("Sortino (annualized)", sortino, -1, 3, 12, (v) => `Sortino ${v.toFixed(2)}`),
  ]);
}

function drawdownBucket(returns: number[]) {
  const dd = returns.length > 0 ? maxDrawdown(returns) : null; // negative %, e.g. -45
  const annualVolPct = returns.length > 1 ? stddev(returns) * Math.sqrt(365) * 100 : null;
  return bucket("Drawdown Risk", [
    mk("Max drawdown (window)", dd, -80, -10, 13, (v) => `${v.toFixed(0)}% max drawdown in the fetched window`),
    mk("Annualized volatility", annualVolPct, 150, 30, 12, (v) => `${v.toFixed(0)}% annualized volatility`),
  ]);
}

/**
 * Score a crypto asset from its own price history and BTC's (as the de
 * facto market benchmark — the same role SPY plays for equities). `btcHistory`
 * is null/skipped when scoring BTC-USD itself.
 */
export function computeCryptoScore(
  symbol: string,
  history: HistoryPoint[],
  btcHistory: HistoryPoint[] | null,
): ScoreResult {
  const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
  const returns = dailyReturns(history);

  const momentum = momentumBucket(history);
  const relative = relativeStrengthBucket(history, btcHistory, isBtc);
  const risk = riskAdjustedBucket(returns);
  const drawdown = drawdownBucket(returns);

  const buckets = [momentum.bucket, relative.bucket, risk.bucket, drawdown.bucket];
  const totalPoints = buckets.reduce((s, b) => s + b.points, 0);
  const totalMax = buckets.reduce((s, b) => s + b.max, 0);
  const composite = totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 50;
  const recommendation = scoreToRecommendation(composite);

  const dataCount = momentum.dataCount + relative.dataCount + risk.dataCount + drawdown.dataCount;
  const dataTotal = momentum.total + relative.total + risk.total + drawdown.total;
  const confidence = dataTotal > 0 ? Math.round((dataCount / dataTotal) * 100) : 0;

  const signals: DecisionSignals = {
    fundamentals: composite,
    analysts: null, // no analyst-consensus concept for crypto
    momentum: Math.round((momentum.bucket.points / momentum.bucket.max) * 100),
  };

  const strengths = buckets
    .flatMap((b) => b.factors)
    .filter((f) => f.detail !== "n/a" && f.detail !== "" && f.points / f.max >= 0.65)
    .slice(0, 2)
    .map((f) => f.detail);
  const concerns = buckets
    .flatMap((b) => b.factors)
    .filter((f) => f.detail !== "n/a" && f.detail !== "" && f.points / f.max <= 0.35)
    .slice(0, 2)
    .map((f) => f.detail);

  const rationaleParts = [
    `Crypto score ${composite}/100 (momentum, relative strength vs BTC, risk-adjusted return, drawdown risk), market-data only — no on-chain/tokenomics data yet.`,
  ];
  if (strengths.length) rationaleParts.push(`Strengths: ${strengths.join("; ")}.`);
  if (concerns.length) rationaleParts.push(`Watch: ${concerns.join("; ")}.`);
  if (isBtc) rationaleParts.push("BTC itself has no relative-strength benchmark.");

  return {
    total: composite,
    composite,
    buckets,
    recommendation,
    confidence,
    rationale: rationaleParts.join(" "),
    signals,
  };
}
