/**
 * Module 4 — Portfolio Pulse.
 *
 * A pure projection of `UniversalPortfolioReport` onto the handful of facts
 * that belong on a homepage. Every number here is *read* from an engine that
 * already computed it — health from engines/health, concentration from
 * engines/allocation, drift from engines/optimize's classTargets, movers from
 * the holdings themselves. This module deliberately computes nothing new:
 * a second, subtly-different "portfolio health" on the homepage is precisely
 * the drift this codebase has already had to unwind once.
 *
 * Pure — no I/O. Unit-tested in tests/home-pulse.test.ts.
 */

import type { UniversalPortfolioReport } from "../portfolio/report";
import type { HealthScore } from "../portfolio/engines/health";
import type { HealthFactor, HealthRadarAxis, PortfolioPulse, PulseMover } from "./contracts";

/** An empty portfolio has no pulse. It says so, rather than rendering zeros. */
const EMPTY: PortfolioPulse = {
  status: "empty",
  healthScore: null,
  healthGrade: null,
  totalValue: 0,
  todayChangePct: 0,
  todayChangeDollar: 0,
  bestPerformer: null,
  worstPerformer: null,
  largestRisk: null,
  largestOpportunity: null,
  cashPct: null,
  diversificationScore: null,
  largestDrift: null,
  marketPricedPct: 0,
  radar: [],
  biggestStrength: null,
  biggestWeakness: null,
  healthCoveragePct: null,
  healthFactors: [],
};

/**
 * Short axis labels for the radar. Keyed by the health engine's own dimension
 * names — so if a dimension is renamed there, the radar loses a label rather
 * than silently drawing a mislabelled spoke.
 */
const RADAR_SHORT: Record<string, string> = {
  "Diversification": "Divers.",
  "Expected Drawdown": "Risk",
  "Holding Quality": "Quality",
  "Income": "Income",
  "Liquidity": "Liquidity",
  "Asset Allocation": "Allocation",
  "Correlation": "Correl.",
  "Inflation Protection": "Inflation",
  "Currency Diversification": "Currency",
  "Geographic Diversification": "Geography",
  "Cash Management": "Cash",
};

/**
 * The dimensions the radar draws, in a fixed order so a portfolio's shape is
 * comparable to itself over time. Up to six are shown — a hexagon reads cleanly;
 * eleven spokes are a hairball. The rest still count toward strength/weakness.
 */
const RADAR_AXES = [
  "Diversification",
  "Expected Drawdown",
  "Holding Quality",
  "Income",
  "Liquidity",
  "Asset Allocation",
] as const;

/**
 * Projects the health engine's dimensions onto radar spokes. Reads scores
 * verbatim; a spoke's value IS the dimension's score. Abstained/missing
 * dimensions are drawn faded (`covered: false`) at their fallback so the shape
 * stays a closed polygon rather than collapsing to the centre.
 */
export function buildHealthRadar(health: HealthScore): HealthRadarAxis[] {
  const dimensions = health.dimensions ?? [];
  const byName = new Map(dimensions.map((d) => [d.name, d]));
  const axes: HealthRadarAxis[] = [];

  for (const name of RADAR_AXES) {
    const dim = byName.get(name);
    if (!dim) continue;
    const covered = dim.score != null && dim.coverage > 0;
    axes.push({
      axis: name,
      shortLabel: RADAR_SHORT[name] ?? name,
      score: dim.score ?? 45,
      covered,
    });
  }

  // A radar needs at least three spokes to be a shape. If the canonical set is
  // too thin (an unusual, single-asset-class book), fall back to whatever
  // covered dimensions exist, best-first.
  if (axes.length < 3) {
    return dimensions
      .filter((d) => d.score != null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 6)
      .map((d) => ({
        axis: d.name,
        shortLabel: RADAR_SHORT[d.name] ?? d.name,
        score: d.score as number,
        covered: d.coverage > 0,
      }));
  }

  return axes;
}

/**
 * Projects the health engine's dimensions onto explanation rows, reading the
 * engine's OWN arithmetic verbatim: `effectiveWeight` (weight × coverage,
 * renormalized) and `scoreExact × effectiveWeight` are exactly the terms
 * `computeHealth` summed to produce `totalExact` — so the rows genuinely add
 * up to the number on screen, rather than approximating it.
 */
export function buildHealthFactors(health: HealthScore): HealthFactor[] {
  return (health.dimensions ?? [])
    .map<HealthFactor>((d) => {
      const scored = d.score != null;
      return {
        label: d.name,
        score: d.score,
        weightShare: scored ? d.effectiveWeight : null,
        contributionPts: scored ? Math.round((d.scoreExact ?? 0) * d.effectiveWeight * 10) / 10 : null,
        covered: scored && d.coverage > 0,
        coveragePct: Math.round(d.coverage * 100),
      };
    })
    // Biggest contributors first; abstained dimensions sink to the bottom
    // (they still render, faded — an abstention is information).
    .sort((a, b) => (b.contributionPts ?? -1) - (a.contributionPts ?? -1));
}

/**
 * HHI (0-10000) → a 0-100 "diversification" score, so the homepage doesn't have
 * to teach the user what a Herfindahl index is. The engine's own bands
 * (<1500 diversified, >2500 concentrated) anchor the scale; this is a
 * presentation transform of an existing number, not a new metric.
 */
export function diversificationFromHhi(hhi: number): number {
  const DIVERSIFIED = 1500;
  const CONCENTRATED = 2500;
  if (hhi <= DIVERSIFIED) return 100;
  if (hhi >= CONCENTRATED) return 0;
  return Math.round(100 - ((hhi - DIVERSIFIED) / (CONCENTRATED - DIVERSIFIED)) * 100);
}

export function buildPortfolioPulse(report: UniversalPortfolioReport | null): PortfolioPulse {
  if (!report || report.holdingCount === 0) return EMPTY;

  // Movers are ranked on *unrealized return %*, not dollars — a 40% gain on a
  // small position is the more interesting fact, and the dollar figure rides
  // along on the same object for callers that want it.
  const scored = report.holdings
    .filter((h) => h.unrealizedPct != null && h.symbol != null)
    .map<PulseMover>((h) => ({
      symbol: h.symbol as string,
      changePct: h.unrealizedPct as number,
      changeDollar: h.unrealizedPL ?? 0,
    }))
    .sort((a, b) => b.changePct - a.changePct);

  const bestPerformer = scored[0] ?? null;
  const worstPerformer = scored.length > 1 ? scored[scored.length - 1] : null;

  // The engine already severity-ranks concentration findings; take the worst.
  const topConcern =
    [...report.concentration].sort((a, b) => (a.severity === b.severity ? b.pct - a.pct : a.severity === "high" ? -1 : 1))[0] ?? null;

  const topRec =
    report.recommendations.find(
      (r) => (r.action === "ADD" || r.action === "INCREASE") && r.symbol != null,
    ) ?? null;

  const cashSlice = report.allocation.byAssetClass.slices.find((s) => s.key === "cash");

  const drift = [...report.optimization.classTargets]
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];

  // Strength/weakness are the best/worst *covered* dimensions — an abstained
  // dimension has no opinion and must not be presented as a weakness.
  const scoredDims = (report.health.dimensions ?? [])
    .filter((d) => d.score != null && d.coverage > 0)
    .sort((a, b) => (a.score as number) - (b.score as number));
  const biggestWeakness = scoredDims[0]
    ? { label: scoredDims[0].name, score: scoredDims[0].score as number }
    : null;
  const biggestStrength = scoredDims.length > 1
    ? { label: scoredDims[scoredDims.length - 1].name, score: scoredDims[scoredDims.length - 1].score as number }
    : null;

  return {
    status: "ok",
    healthScore: report.health.total,
    healthGrade: report.health.grade,
    totalValue: report.totalValue,
    todayChangePct: report.todayChangePct,
    todayChangeDollar: report.todayChangeDollar,
    bestPerformer,
    worstPerformer,
    largestRisk: topConcern ? { title: topConcern.label, description: topConcern.message } : null,
    largestOpportunity: topRec ? { symbol: topRec.symbol as string, reason: topRec.rationale } : null,
    cashPct: cashSlice?.weight ?? 0,
    diversificationScore: diversificationFromHhi(report.allocation.byAssetClass.hhi),
    // A sub-1pp drift is noise, not a finding worth a line on the homepage.
    largestDrift: drift && Math.abs(drift.delta) >= 1 ? { label: drift.label, driftPct: drift.delta } : null,
    marketPricedPct: report.marketPricedPct,
    radar: buildHealthRadar(report.health),
    biggestStrength,
    biggestWeakness,
    healthCoveragePct: report.health.coveragePct ?? null,
    healthFactors: buildHealthFactors(report.health),
  };
}
