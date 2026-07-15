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
import type { PortfolioPulse, PulseMover } from "./contracts";

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
};

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
  };
}
