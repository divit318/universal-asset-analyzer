/**
 * Forex decision scorer — the parallel to lib/commodity-scoring.ts for
 * currency pairs (Yahoo quoteType CURRENCY, e.g. EURUSD=X). Market-data
 * only: central bank policy, inflation, GDP, and interest-rate differentials
 * (the things that actually move currencies) have no free numeric feed, so
 * — same reasoning as commodities' supply/demand — that's covered by the
 * AI insight layer (lib/ai-forex-research.ts, grounded in news), not
 * fabricated here as a fake "macro score".
 *
 * Shares the momentum/relative-strength/risk-adjusted-return/drawdown shape
 * with commodities, but recalibrated much tighter: major FX pairs are far
 * less volatile than commodities or crypto — a 10% multi-month move is a
 * big deal for EURUSD, routine for gold, background noise for BTC. Reusing
 * commodity-scoring.ts's ranges here would pin every pair near the extremes
 * and produce an uninformative score.
 */

import type { DecisionSignals, HistoryPoint, ScoreResult } from "./types";
import { mk, bucket } from "./score-math";
import { scoreToRecommendation } from "./recommendation";
import { dailyReturns, stddev, mean, maxDrawdown } from "./portfolio-analytics";

export const DOLLAR_INDEX_SYMBOL = "DX-Y.NYB";

function windowReturn(history: HistoryPoint[]): number | null {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length < 2) return null;
  const first = closes[0], last = closes.at(-1)!;
  return first > 0 ? ((last - first) / first) * 100 : null;
}

function threeMonthReturn(history: HistoryPoint[]): number | null {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length < 20) return null;
  const back = closes.at(-Math.min(63, closes.length))!; // ~63 trading days = 3 months
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
    mk("3-month return", r3m, -12, 12, 13, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}% over 3 months`),
    mk("vs recent high", fromHigh, -20, 0, 12, (v) => `${v.toFixed(1)}% vs high over the fetched window`),
  ]);
}

function relativeStrengthBucket(symbol: string, history: HistoryPoint[], benchmarkHistory: HistoryPoint[] | null) {
  // The Dollar Index only gives a clean "relative strength" reading for
  // pairs that actually involve USD — a EUR/GBP cross moving vs DXY doesn't
  // have a straightforward interpretation, so it's skipped rather than
  // shown as a misleading number.
  const involvesUsd = symbol.toUpperCase().includes("USD");
  if (!involvesUsd || !benchmarkHistory || benchmarkHistory.length < 2) {
    return bucket("Relative Strength vs Dollar Index", [
      mk("vs DXY (window return)", null, -10, 10, 25, () => ""),
    ]);
  }
  const assetReturn = windowReturn(history);
  const benchReturn = windowReturn(benchmarkHistory);
  const relative = assetReturn != null && benchReturn != null ? assetReturn - benchReturn : null;
  return bucket("Relative Strength vs Dollar Index", [
    mk("vs DXY (window return)", relative, -10, 10, 25, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp vs the US Dollar Index over the fetched window`),
  ]);
}

function riskAdjustedBucket(returns: number[]) {
  // 252 trading days/year — FX trades ~5 days/week (closed weekends), like equities.
  const vol = stddev(returns);
  const avgDaily = mean(returns);
  const annualReturn = avgDaily * 252;
  const annualVol = vol * Math.sqrt(252);
  const sharpe = annualVol > 0 ? annualReturn / annualVol : null;

  const downside = returns.filter((r) => r < 0);
  const downsideVol = stddev(downside.length >= 2 ? downside : returns) * Math.sqrt(252);
  const sortino = downsideVol > 0 ? annualReturn / downsideVol : null;

  return bucket("Risk-Adjusted Return", [
    mk("Sharpe (annualized)", sharpe, -1, 1, 13, (v) => `Sharpe ${v.toFixed(2)}`),
    mk("Sortino (annualized)", sortino, -1, 1.5, 12, (v) => `Sortino ${v.toFixed(2)}`),
  ]);
}

function drawdownBucket(returns: number[]) {
  const dd = returns.length > 0 ? maxDrawdown(returns) : null; // negative %
  const annualVolPct = returns.length > 1 ? stddev(returns) * Math.sqrt(252) * 100 : null;
  return bucket("Drawdown Risk", [
    mk("Max drawdown (window)", dd, -20, -3, 13, (v) => `${v.toFixed(1)}% max drawdown in the fetched window`),
    mk("Annualized volatility", annualVolPct, 25, 5, 12, (v) => `${v.toFixed(1)}% annualized volatility`),
  ]);
}

/**
 * Score a currency pair from its own price history and the US Dollar
 * Index's (DXY — the de facto USD benchmark; skipped for non-USD crosses).
 */
export function computeForexScore(
  symbol: string,
  history: HistoryPoint[],
  benchmarkHistory: HistoryPoint[] | null,
): ScoreResult {
  const returns = dailyReturns(history);

  const momentum = momentumBucket(history);
  const relative = relativeStrengthBucket(symbol, history, benchmarkHistory);
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
    analysts: null,
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
    `Forex score ${composite}/100 (momentum, relative strength vs the US Dollar Index, risk-adjusted return, drawdown risk), market-data only — central bank policy, rate differentials, and macro context are covered by the AI insight below, not this score.`,
  ];
  if (strengths.length) rationaleParts.push(`Strengths: ${strengths.join("; ")}.`);
  if (concerns.length) rationaleParts.push(`Watch: ${concerns.join("; ")}.`);

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
