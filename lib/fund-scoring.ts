/**
 * Fund decision scorer — the parallel to lib/scoring.ts for ETFs, mutual
 * funds, and closed-end funds. A fund has no P/E, no earnings, no analyst
 * coverage; forcing it through the equity scorer would either crash on
 * missing fields or silently score "n/a" for everything that matters. This
 * engine scores what actually describes a fund: cost, diversification,
 * performance relative to its own category, and risk-adjusted quality.
 *
 * Shares math with the equity engine (lerp/mk/bucket from score-math.ts,
 * computeMomentum from scoring.ts, scoreToRecommendation from
 * recommendation.ts) so a 0-100 score and 5-tier call mean the same thing
 * everywhere in the app — only the *inputs* are asset-class-specific.
 */

import type { DecisionSignals, FundProfileData, HistoryPoint, ScoreResult } from "./types";
import { mk, bucket } from "./score-math";
import { scoreToRecommendation } from "./recommendation";
import { computeMomentum } from "./scoring";

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;

function costBucket(fund: FundProfileData) {
  const expenseRatioPct = fund.expenseRatio != null ? fund.expenseRatio * 100 : null;
  const turnoverPct = fund.turnoverPercent != null ? fund.turnoverPercent * 100 : null;
  return bucket("Cost", [
    // Typical fund expense ratios span ~0.03% (index funds) to ~1.5%+ (active/niche).
    mk("Expense ratio", expenseRatioPct, 1.5, 0.03, 16, (v) => `${v.toFixed(2)}% annual expense ratio`),
    mk("Portfolio turnover", turnoverPct, 150, 5, 9, (v) => `${v.toFixed(0)}% annual turnover`),
  ]);
}

function diversificationBucket(fund: FundProfileData) {
  const top10Weight = fund.holdings
    .slice()
    .sort((a, b) => b.weightPercent - a.weightPercent)
    .slice(0, 10)
    .reduce((s, h) => s + h.weightPercent, 0);
  const topSectorWeight = fund.sectorWeights[0]?.weightPercent ?? null;
  const hasHoldings = fund.holdings.length > 0;
  return bucket("Diversification", [
    mk("Top-10 holdings concentration", hasHoldings ? top10Weight : null, 100, 15, 15, (v) => `Top 10 holdings = ${v.toFixed(0)}% of fund`),
    mk("Largest sector weight", topSectorWeight, 100, 15, 10, (v) => `${fund.sectorWeights[0]?.sector ?? "Top sector"} = ${v.toFixed(0)}%`),
  ]);
}

function performanceBucket(fund: FundProfileData) {
  const relativeOneYear = fund.categoryRelativeReturns.oneYear;
  const relativeThreeYear = fund.categoryRelativeReturns.threeYear;
  // Fall back to absolute return only when Yahoo didn't return a category
  // baseline to diff against (thin coverage, e.g. some closed-end funds).
  const oneYearSignal = relativeOneYear ?? fund.trailingReturns.oneYear;
  const oneYearIsRelative = relativeOneYear != null;
  return bucket("Performance vs Category", [
    mk(
      oneYearIsRelative ? "1-year return vs category" : "1-year return",
      oneYearSignal,
      oneYearIsRelative ? -8 : -20,
      oneYearIsRelative ? 8 : 25,
      16,
      (v) => (oneYearIsRelative ? `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp vs category` : `${v >= 0 ? "+" : ""}${v.toFixed(1)}% (absolute)`),
    ),
    mk("3-year return vs category", relativeThreeYear, -6, 6, 9, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp vs category`),
  ]);
}

function riskBucket(fund: FundProfileData) {
  const sharpe = fund.risk?.sharpeRatio ?? null;
  const alpha = fund.risk?.alpha ?? null;
  return bucket("Risk-Adjusted Quality", [
    mk("Sharpe ratio", sharpe, -0.5, 2, 15, (v) => `Sharpe ${v.toFixed(2)}`),
    mk("Alpha vs category", alpha, -5, 5, 10, (v) => `Alpha ${v >= 0 ? "+" : ""}${v.toFixed(1)}`),
  ]);
}

/**
 * Score a fund from its profile + price history. Composite blends the four
 * fundamental buckets (cost/diversification/performance/risk) with price
 * momentum — the same "fundamentals anchor, momentum refines" shape
 * lib/scoring.ts uses for equities, computed from the same generic OHLC math.
 */
export function computeFundScore(fund: FundProfileData, history: HistoryPoint[]): ScoreResult {
  const cost = costBucket(fund);
  const diversification = diversificationBucket(fund);
  const performance = performanceBucket(fund);
  const risk = riskBucket(fund);

  const buckets = [cost.bucket, diversification.bucket, performance.bucket, risk.bucket];
  const totalPoints = buckets.reduce((s, b) => s + b.points, 0);
  const totalMax = buckets.reduce((s, b) => s + b.max, 0);
  const total = totalMax > 0 ? Math.round((totalPoints / totalMax) * 100) : 50;

  const momentum = computeMomentum(history);
  const momentumScore = momentum?.score ?? null;

  const composite = momentumScore != null ? Math.round(total * 0.75 + momentumScore * 0.25) : total;
  const recommendation = scoreToRecommendation(composite);

  const dataCount = cost.dataCount + diversification.dataCount + performance.dataCount + risk.dataCount;
  const dataTotal = cost.total + diversification.total + performance.total + risk.total;
  const confidence = dataTotal > 0 ? Math.round((dataCount / dataTotal) * 100) : 0;

  const signals: DecisionSignals = {
    fundamentals: total,
    analysts: null, // funds have no analyst-consensus concept
    momentum: momentumScore,
  };

  const strengths = buckets
    .flatMap((b) => b.factors)
    .filter((f) => f.detail !== "n/a" && f.points / f.max >= 0.65)
    .slice(0, 2)
    .map((f) => f.detail);
  const concerns = buckets
    .flatMap((b) => b.factors)
    .filter((f) => f.detail !== "n/a" && f.points / f.max <= 0.35)
    .slice(0, 2)
    .map((f) => f.detail);

  const rationaleParts = [
    `Fund score ${total}/100 (cost, diversification, category-relative performance, risk-adjusted quality)${momentumScore != null ? `, blended with a ${momentumScore}/100 momentum reading` : ""}.`,
  ];
  if (strengths.length) rationaleParts.push(`Strengths: ${strengths.join("; ")}.`);
  if (concerns.length) rationaleParts.push(`Watch: ${concerns.join("; ")}.`);
  if (fund.expenseRatio != null) rationaleParts.push(`Charges ${pct(fund.expenseRatio)} annually.`);

  return {
    total,
    composite,
    buckets,
    recommendation,
    confidence,
    rationale: rationaleParts.join(" "),
    signals,
  };
}
