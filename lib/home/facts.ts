/**
 * The dashboard fact layer (Phase 3 of the Today rebuild).
 *
 * One server-side pass produces one typed object containing every cross-surface
 * fact the page renders, each stamped with its unit, display precision, time
 * window, as-of, and source. Components format facts through `formatFact()`
 * and never re-derive or re-round a value locally. This is the structural fix
 * for the class of bug where cash rendered as 33% in one card and 32.9% in the
 * next (audit NI-02), and for return figures rendered without their windows
 * (NI-03).
 *
 * `reconcileDashboardFacts()` is the reconciliation harness: automated
 * invariants over the digest that run in CI (tests/home-facts.test.ts) and as
 * a dev-mode warning in the digest route. These are correctness tests, not
 * snapshots: attribution must sum to the total, counters must match their
 * collections, shared inputs must carry one interpretation.
 *
 * Pure and client-safe: no I/O, imports only contracts and lib/format.
 */

import { formatPercent, formatCompact, roundForDisplay } from "../format";
import { vixBand } from "./sentiment";
import type { DashboardFacts, Fact, HomeDigest } from "./contracts";

/* ------------------------------------------------------------------ */
/* Precision policy                                                    */
/* ------------------------------------------------------------------ */

/**
 * ONE display precision per quantity class, decided here and nowhere else.
 * - percents render at 1 decimal (a 0-decimal percent beside a 1-decimal
 *   percent of the same fact is how 33 vs 32.9 happened);
 * - bps at 1 decimal;
 * - scores and counts as integers;
 * - index levels at 2 decimals.
 */
export const PRECISION = { percent: 1, bps: 1, score: 0, count: 0, level: 2, currency: 2, days: 0 } as const;

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

type Core = Omit<HomeDigest, "changes" | "symbolContext" | "facts">;

const fact = <V,>(
  value: V | null,
  unit: Fact["unit"],
  precision: number,
  window: string | null,
  asOf: string | null,
  source: string,
): Fact<V> => ({ value, unit, precision, window, asOf, source });

/**
 * Assembles the fact object from the already-built digest slices. Adds no
 * arithmetic beyond stamping: every value is read from the engine that
 * computed it, so a fact can never disagree with its slice.
 */
export function buildDashboardFacts(
  core: Core,
  opts: { changesCount: number; unreadNotifications: number },
): DashboardFacts {
  const pulse = core.portfolioPulse;
  const perf = core.performance;
  const curve = core.equityCurve;
  const senti = core.marketIntelligence.sentiment;
  const vix = core.marketIntelligence.groups
    .flatMap((g) => g.tickers)
    .find((t) => t.symbol === "^VIX");

  const pulseAsOf = pulse.asOf ? new Date(pulse.asOf).toISOString() : null;
  const holdingDays = perf.status === "ok" ? perf.holdingDays : null;
  const xirrWindow = holdingDays != null ? `annualized, money-weighted, ${holdingDays}d held` : "annualized, money-weighted";
  const vixAsOf = vix?.asOf ? new Date(vix.asOf).toISOString() : null;

  return {
    sessionDate: fact(pulse.sessionDate, "text", 0, "session", pulseAsOf, "portfolio/report.dayMoves"),
    totalValue: fact(pulse.status === "empty" ? null : pulse.totalValue, "currency", PRECISION.currency, "now", pulseAsOf, "portfolio/report.totalValue"),
    dayPnlPct: fact(pulse.status === "empty" ? null : pulse.todayChangePct, "percent", PRECISION.percent, "today", pulseAsOf, "portfolio/report.todayChangePct"),
    dayPnlDollar: fact(pulse.status === "empty" ? null : pulse.todayChangeDollar, "currency", PRECISION.currency, "today", pulseAsOf, "portfolio/report.todayChangeDollar"),
    dayCoveragePct: fact(pulse.dayCoveragePct, "percent", 0, "today", pulseAsOf, "home/pulse.dayCoveragePct"),
    healthScore: fact(pulse.healthScore, "score", PRECISION.score, "now", pulseAsOf, "portfolio/engines/health.total"),
    healthGrade: fact(pulse.healthGrade, "text", 0, "now", pulseAsOf, "portfolio/engines/health.grade"),
    cashPct: fact(pulse.cashPct, "percent", PRECISION.percent, "now", pulseAsOf, "portfolio/report.allocation.cash"),
    totalReturnOnCostPct: fact(pulse.totalReturnOnCostPct, "percent", PRECISION.percent, "since inception, cumulative", pulseAsOf, "portfolio/report.totalReturn"),
    xirrPct: fact(perf.status === "ok" ? perf.xirrPct : null, "percent", PRECISION.percent, xirrWindow, null, "portfolio-performance.xirr"),
    holdingDays: fact(holdingDays, "days", PRECISION.days, null, null, "portfolio-performance.holdingDays"),
    benchmarkSymbol: fact(perf.benchmark?.symbol ?? null, "text", 0, null, null, "home/digest.BENCHMARK"),
    benchmarkXirrPct: fact(perf.benchmark?.benchmarkPct ?? null, "percent", PRECISION.percent, xirrWindow, null, "portfolio-performance.benchmark.xirr"),
    excessPct: fact(perf.benchmark?.excessPct ?? null, "percent", PRECISION.percent, xirrWindow, null, "portfolio-performance.benchmark.outperformance"),
    curveWindowDays: fact(curve.points.length >= 2 ? curve.windowDays : null, "days", PRECISION.days, null, null, "home/equity-curve.windowDays"),
    curvePortfolioPct: fact(curve.portfolioPct, "percent", PRECISION.percent, `${curve.windowDays}d`, null, "home/equity-curve.portfolioPct"),
    curveBenchmarkPct: fact(curve.benchmarkPct, "percent", PRECISION.percent, `${curve.windowDays}d`, null, "home/equity-curve.benchmarkPct"),
    openCount: fact(core.attention.openCount, "count", PRECISION.count, "now", core.attention.reviewedAt, "home/attention.openCount"),
    decisionCount: fact(core.recommendedActions.actions.length, "count", PRECISION.count, "now", null, "home/actions.length"),
    unreadNotifications: fact(opts.unreadNotifications, "count", PRECISION.count, "now", null, "db.notifications.unread"),
    changesCount: fact(opts.changesCount, "count", PRECISION.count, "since last visit", null, "home/changes.length"),
    sentimentScore: fact(senti?.score ?? null, "score", PRECISION.score, "now", vixAsOf, "home/sentiment.score"),
    sentimentLabel: fact(senti?.label ?? null, "text", 0, "now", vixAsOf, "home/sentiment.label"),
    vixLevel: fact(vix?.price ?? null, "level", PRECISION.level, "now", vixAsOf, "yahoo.^VIX"),
    vixBandLabel: fact(vix?.price != null ? vixBand(vix.price).label : null, "text", 0, "now", vixAsOf, "home/sentiment.vixBand"),
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** True minus sign, matching the _viz layer's alignment convention. */
const minus = (s: string) => s.replace("-", "−");

/**
 * THE renderer for a fact. Signed percents, compact signed currency, plain
 * counts. Components pass a fact; they never call toFixed on its value.
 */
export function formatFact(f: Fact<number> | Fact<string>, style: "signed" | "plain" = "signed"): string {
  if (f.value == null) return "—";
  if (typeof f.value === "string") return f.value;
  const v = f.value;
  switch (f.unit) {
    case "percent": {
      const s = formatPercent(v, f.precision);
      return style === "plain" ? minus(s.replace(/^\+/, "")) : minus(s);
    }
    case "bps": {
      const r = roundForDisplay(v, f.precision);
      const sign = r > 0 ? "+" : "";
      return minus(`${sign}${r.toFixed(f.precision)} bps`);
    }
    case "currency": {
      const sign = v > 0 ? "+" : v < 0 ? "−" : "";
      const body = `$${formatCompact(Math.abs(v))}`;
      return style === "plain" ? (v < 0 ? `−${body}` : body) : `${sign}${body}`;
    }
    case "level":
      return v.toFixed(f.precision);
    case "score":
    case "count":
    case "days":
      return String(Math.round(v));
    default:
      return String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Reconciliation harness                                              */
/* ------------------------------------------------------------------ */

export interface ReconciliationIssue {
  invariant: string;
  detail: string;
}

const close = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/**
 * The invariants every digest must satisfy. Returns an empty array on a clean
 * build. Run in CI over synthetic digests AND over any live digest a test can
 * build; the /api/home route logs (never throws on) violations in dev.
 */
export function reconcileDashboardFacts(digest: Pick<HomeDigest, "facts" | "portfolioPulse" | "performance" | "attention" | "recommendedActions" | "marketIntelligence" | "changes">): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const push = (invariant: string, detail: string) => issues.push({ invariant, detail });
  const f = digest.facts;
  const pulse = digest.portfolioPulse;

  // 1. Day-move attribution reconciles: visible contributors + residual = day P&L in bps.
  if (pulse.status !== "empty" && pulse.topContributors.length > 0) {
    const shown = pulse.topContributors.reduce((s, c) => s + c.bps, 0);
    const residual = pulse.topContributorsResidualBps ?? 0;
    const totalBps = pulse.todayChangePct * 100;
    if (!close(shown + residual, totalBps, 0.75)) {
      push("attribution-sums-to-day-pnl", `contributors ${shown.toFixed(1)} + residual ${residual.toFixed(1)} != day ${totalBps.toFixed(1)} bps`);
    }
  }

  // 2. Health decomposition reconciles: covered factor contributions sum to the total (0.1 pt granularity).
  if (pulse.healthScore != null && pulse.healthFactors.length > 0) {
    const sum = pulse.healthFactors.reduce((s, x) => s + (x.contributionPts ?? 0), 0);
    if (!close(sum, pulse.healthScore, 0.51)) {
      push("health-factors-sum", `factor contributions ${sum.toFixed(1)} != health ${pulse.healthScore}`);
    }
  }

  // 3. Counters match their collections.
  if (digest.attention.openCount !== digest.attention.items.length) {
    push("open-count-matches-items", `openCount ${digest.attention.openCount} != items ${digest.attention.items.length}`);
  }
  if (f.openCount.value !== digest.attention.items.length) {
    push("fact-open-count", `facts.openCount ${f.openCount.value} != items ${digest.attention.items.length}`);
  }
  if (f.decisionCount.value !== digest.recommendedActions.actions.length) {
    push("fact-decision-count", `facts.decisionCount ${f.decisionCount.value} != actions ${digest.recommendedActions.actions.length}`);
  }
  if (f.changesCount.value !== digest.changes.changes.length) {
    push("fact-changes-count", `facts.changesCount ${f.changesCount.value} != changes ${digest.changes.changes.length}`);
  }

  // 4. Facts agree with their slices (the fact layer adds stamps, never new values).
  if (pulse.status !== "empty") {
    if (f.dayPnlPct.value !== pulse.todayChangePct) push("fact-day-pnl", "facts.dayPnlPct drifted from pulse.todayChangePct");
    if (f.cashPct.value !== pulse.cashPct) push("fact-cash", "facts.cashPct drifted from pulse.cashPct");
    if (f.healthScore.value !== pulse.healthScore) push("fact-health", "facts.healthScore drifted from pulse.healthScore");
  }

  // 5. Benchmark comparison shares one window and one methodology on both sides.
  const perf = digest.performance;
  if (perf.status === "ok" && perf.benchmark) {
    if (perf.xirrPct == null) {
      push("benchmark-window", "benchmark comparison present while portfolio XIRR is not annualizable");
    } else if (!close(perf.benchmark.portfolioPct, perf.xirrPct, 0.05)) {
      push("benchmark-window", `benchmark.portfolioPct ${perf.benchmark.portfolioPct} != xirrPct ${perf.xirrPct}`);
    }
    if (f.xirrPct.window !== f.benchmarkXirrPct.window || f.xirrPct.window !== f.excessPct.window) {
      push("benchmark-window-label", "XIRR, benchmark, and excess facts carry different window labels");
    }
    if (perf.xirrPct != null && perf.benchmark.benchmarkPct != null && !close(perf.benchmark.excessPct, perf.xirrPct - perf.benchmark.benchmarkPct, 0.06)) {
      push("excess-is-difference", `excess ${perf.benchmark.excessPct} != ${perf.xirrPct} - ${perf.benchmark.benchmarkPct}`);
    }
  }

  // 6. Sentiment decomposition reconciles and the VIX carries ONE interpretation.
  const senti = digest.marketIntelligence.sentiment;
  if (senti) {
    const sum = senti.components.reduce((s, c) => s + c.contribution, 0);
    if (!close(sum, senti.score, 0.5)) {
      push("sentiment-components-sum", `components ${sum} != score ${senti.score}`);
    }
  }
  if (f.vixLevel.value != null && f.vixBandLabel.value !== vixBand(f.vixLevel.value).label) {
    push("vix-one-interpretation", "facts.vixBandLabel disagrees with vixBand(facts.vixLevel)");
  }

  return issues;
}
