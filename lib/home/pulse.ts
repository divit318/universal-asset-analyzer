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
import { metricSessionState } from "../metric";
import type { DayContributor, HealthFactor, HealthRadarAxis, PortfolioPulse, PulseMover } from "./contracts";

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
  sessionNote: null,
  asOf: 0,
  sessionDate: null,
  largestRisk: null,
  largestOpportunity: null,
  cashPct: null,
  diversificationScore: null,
  largestDrift: null,
  totalReturnOnCostPct: null,
  marketPricedPct: 0,
  radar: [],
  biggestStrength: null,
  biggestWeakness: null,
  healthCoveragePct: null,
  healthFactors: [],
  topContributors: [],
  topContributorsResidualBps: null,
  dayCoveragePct: null,
};

/**
 * Today's largest contributions to the book's day move, in bps of the SAME
 * denominator `todayChangePct` was computed over: the live-quoted holdings'
 * value (`report.todayChangeBaseValue`). Audit NI-01 found the old version
 * divided by the whole book's previous close while the day percentage divided
 * by the quoted slice only, so the rows could never reconcile to the headline
 * even before truncation. Now: sum(all rows) = day P&L in bps exactly, and
 * the returned residual carries whatever the visible rows leave out.
 *
 * Shape follows the day's tape when it can: the top two positive rows plus the
 * single largest negative. When the sign mix is one-sided, it degrades to the
 * top three by magnitude rather than padding with noise rows.
 */
export function buildTopContributors(
  movers: PulseMover[],
  dayBaseValue: number,
  dayDollarTotal: number,
  nameBySymbol: Map<string, string>,
): { contributors: DayContributor[]; residualBps: number | null } {
  if (!(dayBaseValue > 0)) return { contributors: [], residualBps: null };

  const rows = movers
    .filter((m) => m.dayDollar != null && m.dayDollar !== 0)
    .map<DayContributor>((m) => ({
      symbol: m.symbol,
      name: nameBySymbol.get(m.symbol.toUpperCase()) ?? m.symbol,
      bps: ((m.dayDollar as number) / dayBaseValue) * 10_000,
      dayDollar: m.dayDollar as number,
    }));
  if (rows.length === 0) return { contributors: [], residualBps: null };

  const positive = rows.filter((r) => r.bps > 0).sort((a, b) => b.bps - a.bps);
  const negative = rows.filter((r) => r.bps < 0).sort((a, b) => a.bps - b.bps);

  const picked =
    positive.length >= 2 && negative.length >= 1
      ? [...positive.slice(0, 2), negative[0]]
      : [...rows].sort((a, b) => Math.abs(b.bps) - Math.abs(a.bps)).slice(0, 3);

  const totalBps = (dayDollarTotal / dayBaseValue) * 10_000;
  const shown = picked.reduce((s, r) => s + r.bps, 0);

  return {
    contributors: picked.sort((a, b) => b.bps - a.bps),
    // The unshown remainder of the REPORT's day move, so visible rows plus
    // residual reconcile to the headline by construction, including any
    // stale-session positions the mover list filtered out. Zero is meaningful
    // (the rows ARE the whole move); null only when there are no rows at all.
    residualBps: totalBps - shown,
  };
}

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
  const dims = health.dimensions ?? [];

  // Largest-remainder rounding at 0.1-pt granularity so the displayed
  // contributions sum EXACTLY to the health score on screen (audit NI-07).
  // Rounding each term independently drifted the decomposition ~0.4 pts from
  // the headline while explain.ts promised the rows "genuinely add up". The
  // target is the DISPLAYED total (health.total), so what the user can sum
  // matches what the user can see; each row moves at most 0.1 pt from the
  // engine's exact term to absorb the display rounding.
  const target = Math.round(health.total * 10);
  const exactTenths = dims.map((d) => (d.score != null ? (d.scoreExact ?? 0) * d.effectiveWeight * 10 : null));
  const floors = exactTenths.map((v) => (v != null ? Math.floor(v) : null));
  let deficit = target - floors.reduce<number>((s, v) => s + (v ?? 0), 0);
  const order = exactTenths
    .map((v, i) => ({ i, frac: v != null ? v - Math.floor(v) : -1 }))
    .filter((e) => e.frac >= 0)
    .sort((a, b) => b.frac - a.frac);
  const tenths = [...floors];
  while (deficit > 0 && order.length > 0) {
    for (const { i } of order) {
      if (deficit <= 0) break;
      tenths[i] = (tenths[i] as number) + 1;
      deficit -= 1;
    }
  }
  // A displayed total ROUNDED DOWN from the exact sum leaves a surplus instead:
  // shave tenths from the smallest-fraction rows (never below zero).
  while (deficit < 0 && order.length > 0) {
    let moved = false;
    for (let k = order.length - 1; k >= 0 && deficit < 0; k--) {
      const i = order[k].i;
      if ((tenths[i] as number) > 0) {
        tenths[i] = (tenths[i] as number) - 1;
        deficit += 1;
        moved = true;
      }
    }
    if (!moved) break;
  }

  return dims
    .map<HealthFactor>((d, i) => {
      const scored = d.score != null;
      return {
        label: d.name,
        score: d.score,
        weightShare: scored ? d.effectiveWeight : null,
        contributionPts: scored && tenths[i] != null ? (tenths[i] as number) / 10 : null,
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

export function buildPortfolioPulse(report: UniversalPortfolioReport | null, now: number = Date.now()): PortfolioPulse {
  if (!report || report.holdingCount === 0) return EMPTY;

  // Movers are ranked on the DAY's move (audit F-22g — this used to rank on
  // since-cost P&L and render it under a "today" label). Stale sessions are
  // disqualified from the superlative entirely; current and previous sessions
  // qualify, and the stamped Metric lets the UI date a previous session's
  // figure instead of implying "today".
  const scored: PulseMover[] = (report.dayMoves ?? [])
    .filter((m) => m.dayChange != null && metricSessionState(m.dayChange, now) !== "stale")
    .map((m) => ({
      symbol: m.symbol,
      dayChange: m.dayChange,
      sinceCost: m.sinceCost,
      dayDollar: m.dayDollar,
      plDollar: m.plDollar,
    }))
    .sort((a, b) => (b.dayChange?.value ?? 0) - (a.dayChange?.value ?? 0));

  const bestPerformer = scored[0] ?? null;
  const worstPerformer = scored.length > 1 ? scored[scored.length - 1] : null;

  // "Markets closed" note: when NO qualifying mover describes the current
  // session, the whole strip is a finished session's close — say so once,
  // deliberately, rather than letting per-figure stamps read as a warning wall.
  const states = scored.map((m) => metricSessionState(m.dayChange!, now));
  const newestPrevious = scored.find((m, i) => states[i] === "previous");
  const sessionNote =
    scored.length > 0 && !states.includes("current") && newestPrevious?.dayChange?.sessionDate
      ? `Markets closed · ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${newestPrevious.dayChange.sessionDate}T12:00:00Z`))} close`
      : null;

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
    sessionNote,
    asOf: Date.parse(report.generatedAt) || now,
    // The session the aggregate "Today" figures describe: the current session
    // when any mover is live, else the newest finished one.
    sessionDate:
      scored.find((m, i) => states[i] === "current")?.dayChange?.sessionDate ??
      newestPrevious?.dayChange?.sessionDate ??
      null,
    largestRisk: topConcern ? { title: topConcern.label, description: topConcern.message } : null,
    largestOpportunity: topRec ? { symbol: topRec.symbol as string, reason: topRec.rationale } : null,
    cashPct: cashSlice?.weight ?? 0,
    diversificationScore: diversificationFromHhi(report.allocation.byAssetClass.hhi),
    // A sub-1pp drift is noise, not a finding worth a line on the homepage.
    largestDrift: drift && Math.abs(drift.delta) >= 1 ? { label: drift.label, driftPct: drift.delta } : null,
    // Same field the /portfolio "Total return" tile renders, so the two
    // surfaces are structurally incapable of disagreeing.
    totalReturnOnCostPct: report.totalReturn,
    marketPricedPct: report.marketPricedPct,
    radar: buildHealthRadar(report.health),
    biggestStrength,
    biggestWeakness,
    healthCoveragePct: report.health.coveragePct ?? null,
    healthFactors: buildHealthFactors(report.health),
    ...(() => {
      const { contributors, residualBps } = buildTopContributors(
        scored,
        report.todayChangeBaseValue,
        report.todayChangeDollar,
        new Map(report.holdings.filter((h) => h.symbol).map((h) => [(h.symbol as string).toUpperCase(), h.name])),
      );
      return { topContributors: contributors, topContributorsResidualBps: residualBps };
    })(),
    dayCoveragePct:
      report.totalValue > 0 ? Math.max(0, Math.min(100, (report.todayChangeBaseValue / report.totalValue) * 100)) : null,
  };
}
