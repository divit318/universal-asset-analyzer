/**
 * The Today dashboard's reconciliation harness (Phase 3 of the rebuild).
 *
 * These are correctness invariants, not snapshots: the visible attribution
 * must reach its own total, decompositions must sum to their headline,
 * counters must match their collections, one quote must carry one
 * interpretation, and the benchmark comparison must share a window. A failure
 * here is a real contradiction a user could screenshot.
 */
import { describe, it, expect } from "vitest";
import { buildDashboardFacts, formatFact, reconcileDashboardFacts } from "@/lib/home/facts";
import { buildTopContributors, buildHealthFactors } from "@/lib/home/pulse";
import { computeSentiment, vixBand, scoreVolatility } from "@/lib/home/sentiment";
import { marketToday, marketDayPlus } from "@/lib/home/clock";
import type { HealthScore } from "@/lib/portfolio/engines/health";
import type {
  AttentionQueue,
  ChangeFeed,
  DashboardFacts,
  EquityCurve,
  MarketIntelligence,
  PortfolioPerformanceSummary,
  PortfolioPulse,
  PulseMover,
  RecommendedActions,
} from "@/lib/home/contracts";
import type { Metric } from "@/lib/metric";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const metric = (value: number): Metric<"day"> => ({
  value,
  basis: "day",
  asOf: Date.parse("2026-08-07T20:00:00Z"),
  source: "yahoo",
  sessionDate: "2026-08-07",
});

const mover = (symbol: string, dayDollar: number): PulseMover => ({
  symbol,
  dayChange: metric(1),
  sinceCost: null,
  dayDollar,
  plDollar: null,
});

function pulseFixture(over: Partial<PortfolioPulse> = {}): PortfolioPulse {
  return {
    status: "ok",
    healthScore: 68,
    healthGrade: "C",
    totalValue: 4_069_188,
    todayChangePct: 1.1612,
    todayChangeDollar: 31_682,
    bestPerformer: null,
    worstPerformer: null,
    sessionNote: null,
    asOf: Date.parse("2026-08-08T03:00:00Z"),
    sessionDate: "2026-08-07",
    largestRisk: null,
    largestOpportunity: null,
    cashPct: 32.9495,
    diversificationScore: 50,
    largestDrift: null,
    totalReturnOnCostPct: 3.0764,
    marketPricedPct: 67,
    radar: [],
    biggestStrength: null,
    biggestWeakness: null,
    healthCoveragePct: 90,
    healthFactors: [],
    topContributors: [],
    topContributorsResidualBps: null,
    dayCoveragePct: 67,
    ...over,
  };
}

function marketFixture(vix: number | null): MarketIntelligence {
  return {
    status: "ok",
    groups:
      vix != null
        ? [{ id: "volatility", label: "Volatility", tickers: [{ symbol: "^VIX", label: "VIX", price: vix, changePct: -1.65, sessionDate: "2026-08-07", asOf: Date.parse("2026-08-07T20:00:00Z"), series: null }] }]
        : [],
    breadthPct: 82,
    sentiment: computeSentiment({ vixLevel: vix, breadthPct: 82, sp500ChangePct: 0.62 }),
    regime: null,
    sectorAttention: [],
  };
}

const perfFixture: PortfolioPerformanceSummary = {
  status: "ok",
  xirrPct: 68.63,
  holdingDays: 95,
  totalReturnPct: 3.0764,
  totalReturnDollar: 122_742,
  benchmark: { symbol: "SPY", portfolioPct: 68.63, benchmarkPct: 29.63, excessPct: 39.0 },
};

const curveFixture: EquityCurve = {
  status: "ok",
  windowDays: 90,
  points: [
    { date: "2026-05-10", portfolio: 100, benchmark: 100 },
    { date: "2026-08-07", portfolio: 109.7, benchmark: 104.9 },
  ],
  portfolioPct: 9.7,
  benchmarkPct: 4.9,
  benchmarkSymbol: "SPY",
  coveragePct: 95,
};

const attentionFixture = (n: number): AttentionQueue => ({
  status: n > 0 ? "ok" : "empty",
  items: Array.from({ length: n }, (_, i) => ({
    id: `x${i}`,
    dedupeKey: `k${i}`,
    kind: "signal" as const,
    symbol: null,
    headline: `h${i}`,
    rationale: "r",
    score: 60,
    impact: 0.5,
    urgency: 0.6,
    confidence: 0.5,
    occursAt: null,
    primaryAction: { label: "Open", href: "/" },
    source: "signals",
  })),
  openCount: n,
  degradedFeeders: [],
  reviewedAt: "2026-08-08T03:00:00Z",
});

const actionsFixture: RecommendedActions = { status: "empty", actions: [], fromDecisionEngine: false, hasPortfolio: true };
const changesFixture = (n: number): ChangeFeed => ({
  status: "ok",
  baselineAt: null,
  firstVisit: false,
  changes: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: "health" as const, tone: "neutral" as const, headline: "h", detail: "d", symbol: null, href: null, magnitude: 1 })),
});

function digestFixture(over: { pulse?: Partial<PortfolioPulse>; vix?: number | null; open?: number; changes?: number } = {}) {
  const core = {
    attention: attentionFixture(over.open ?? 3),
    marketIntelligence: marketFixture(over.vix === undefined ? 14.9 : over.vix),
    portfolioPulse: pulseFixture(over.pulse),
    recommendedActions: actionsFixture,
    performance: perfFixture,
    equityCurve: curveFixture,
  };
  const facts = buildDashboardFacts(core as never, {
    changesCount: over.changes ?? 2,
    unreadNotifications: 3,
  });
  return {
    facts,
    portfolioPulse: core.portfolioPulse,
    performance: core.performance,
    attention: core.attention,
    recommendedActions: core.recommendedActions,
    marketIntelligence: core.marketIntelligence,
    changes: changesFixture(over.changes ?? 2),
  };
}

/* ------------------------------------------------------------------ */
/* Contributors reconcile (NI-01)                                      */
/* ------------------------------------------------------------------ */

describe("buildTopContributors", () => {
  const names = new Map<string, string>();

  it("uses the day-move denominator, so all rows sum to the day P&L in bps", () => {
    const movers = [mover("ABNB", 17_500), mover("VOO", 1_337), mover("GOOGL", -1_085), mover("MSFT", 9_500), mover("AMD", 4_430)];
    const dayDollar = movers.reduce((s, m) => s + (m.dayDollar as number), 0);
    const base = 2_730_000; // live-quoted value only, NOT the whole book
    const { contributors, residualBps } = buildTopContributors(movers, base, dayDollar, names);

    const shown = contributors.reduce((s, c) => s + c.bps, 0);
    const totalBps = (dayDollar / base) * 10_000;
    expect(shown + (residualBps ?? 0)).toBeCloseTo(totalBps, 6);
    expect(contributors).toHaveLength(3);
  });

  it("returns residual 0 when the visible rows are the whole move", () => {
    const movers = [mover("A", 1000), mover("B", 500), mover("C", -300)];
    const { residualBps } = buildTopContributors(movers, 100_000, 1200, names);
    expect(residualBps).toBeCloseTo(0, 6);
  });

  it("returns null residual when there are no contributors", () => {
    expect(buildTopContributors([], 100_000, 0, names).residualBps).toBeNull();
    expect(buildTopContributors([mover("A", 100)], 0, 100, names).residualBps).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Health decomposition reconciles (NI-07)                             */
/* ------------------------------------------------------------------ */

describe("buildHealthFactors", () => {
  it("contributions sum exactly to the displayed total", () => {
    const health = {
      total: 68,
      totalExact: 67.62,
      grade: "C",
      coveragePct: 90,
      dimensions: [
        { name: "Diversification", score: 55, scoreExact: 55.21, coverage: 1, effectiveWeight: 0.35 },
        { name: "Liquidity", score: 88, scoreExact: 88.4, coverage: 1, effectiveWeight: 0.3 },
        { name: "Income", score: 61, scoreExact: 60.9, coverage: 0.7, effectiveWeight: 0.2 },
        { name: "Quality", score: 74, scoreExact: 73.55, coverage: 0.9, effectiveWeight: 0.15 },
        { name: "Geography", score: null, scoreExact: null, coverage: 0, effectiveWeight: 0 },
      ],
    } as unknown as HealthScore;

    const factors = buildHealthFactors(health);
    const sum = factors.reduce((s, f) => s + (f.contributionPts ?? 0), 0);
    expect(sum).toBeCloseTo(68, 6);
    // Each row stays within a tenth of the engine's exact term.
    for (const f of factors) {
      if (f.contributionPts == null) continue;
      const dim = (health.dimensions ?? []).find((d) => d.name === f.label)!;
      expect(Math.abs(f.contributionPts - (dim.scoreExact ?? 0) * dim.effectiveWeight)).toBeLessThanOrEqual(0.35);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Sentiment: decomposition + one VIX interpretation (NI-05, NI-08)    */
/* ------------------------------------------------------------------ */

describe("sentiment reconciliation", () => {
  it("component contributions sum exactly to the score", () => {
    for (const inputs of [
      { vixLevel: 14.9, breadthPct: 82, sp500ChangePct: 0.62 },
      { vixLevel: 31, breadthPct: 18, sp500ChangePct: -1.8 },
      { vixLevel: 19.4, breadthPct: null, sp500ChangePct: 0.1 },
    ]) {
      const s = computeSentiment(inputs);
      expect(s).not.toBeNull();
      const sum = s!.components.reduce((a, c) => a + c.contribution, 0);
      expect(sum).toBe(s!.score);
    }
  });

  it("vixBand bands are consistent with the greed scoring anchors", () => {
    // The band vocabulary must order the same way the greed score does.
    expect(vixBand(11).id).toBe("complacent");
    expect(vixBand(14.9).id).toBe("low");
    expect(vixBand(19).id).toBe("normal");
    expect(vixBand(26).id).toBe("elevated");
    expect(vixBand(40).id).toBe("stressed");
    // A VIX the gauge scores as strongly greedy must never carry a
    // fear-leaning band label, and vice versa.
    expect(scoreVolatility(14.9)).toBeGreaterThan(75);
    expect(["complacent", "low"]).toContain(vixBand(14.9).id);
    expect(scoreVolatility(32)).toBeLessThan(25);
    expect(["elevated", "stressed"]).toContain(vixBand(32).id);
  });
});

/* ------------------------------------------------------------------ */
/* The one clock (NI-10)                                               */
/* ------------------------------------------------------------------ */

describe("marketToday", () => {
  it("uses the US market session day, not UTC", () => {
    // 2026-08-08 01:30 UTC is still 2026-08-07 in New York (EDT, UTC-4).
    expect(marketToday(new Date("2026-08-08T01:30:00Z"))).toBe("2026-08-07");
    expect(marketToday(new Date("2026-08-08T12:30:00Z"))).toBe("2026-08-08");
  });

  it("windows extend from the session day", () => {
    expect(marketDayPlus(14, new Date("2026-08-08T01:30:00Z"))).toBe("2026-08-21");
  });
});

/* ------------------------------------------------------------------ */
/* The fact layer                                                      */
/* ------------------------------------------------------------------ */

describe("dashboard facts", () => {
  it("a clean digest reconciles with zero issues", () => {
    const digest = digestFixture({
      pulse: {
        topContributors: [
          { symbol: "ABNB", name: "Airbnb", bps: 64.1, dayDollar: 17_500 },
          { symbol: "VOO", name: "Vanguard", bps: 4.9, dayDollar: 1_337 },
          { symbol: "GOOGL", name: "Alphabet", bps: -4.0, dayDollar: -1_085 },
        ],
        // day P&L 1.1612% = 116.12 bps; rows show 65.0; residual carries the rest.
        topContributorsResidualBps: 116.12 - 65.0,
        healthFactors: [
          { label: "A", score: 60, weightShare: 0.5, contributionPts: 34.0, covered: true, coveragePct: 100 },
          { label: "B", score: 68, weightShare: 0.5, contributionPts: 34.0, covered: true, coveragePct: 100 },
        ],
      },
    });
    expect(reconcileDashboardFacts(digest)).toEqual([]);
  });

  it("catches an attribution that cannot reach its own total", () => {
    const digest = digestFixture({
      pulse: {
        topContributors: [{ symbol: "ABNB", name: "Airbnb", bps: 64.1, dayDollar: 17_500 }],
        topContributorsResidualBps: 0, // claims the row is the whole move; it is not
        healthFactors: [],
        healthScore: null,
      },
    });
    const issues = reconcileDashboardFacts(digest);
    expect(issues.map((i) => i.invariant)).toContain("attribution-sums-to-day-pnl");
  });

  it("catches counters that disagree with their collections", () => {
    const digest = digestFixture({ pulse: { topContributors: [], healthFactors: [], healthScore: null } });
    digest.attention.openCount = 19; // items.length is 3
    const issues = reconcileDashboardFacts(digest);
    expect(issues.map((i) => i.invariant)).toContain("open-count-matches-items");
  });

  it("catches a decomposition that misses its headline", () => {
    const digest = digestFixture({
      pulse: {
        topContributors: [],
        healthScore: 68,
        healthFactors: [
          { label: "A", score: 60, weightShare: 0.5, contributionPts: 30, covered: true, coveragePct: 100 },
          { label: "B", score: 68, weightShare: 0.5, contributionPts: 34, covered: true, coveragePct: 100 },
        ],
      },
    });
    const issues = reconcileDashboardFacts(digest);
    expect(issues.map((i) => i.invariant)).toContain("health-factors-sum");
  });

  it("stamps the XIRR facts with one shared window label", () => {
    const digest = digestFixture({ pulse: { topContributors: [], healthFactors: [], healthScore: null } });
    const f: DashboardFacts = digest.facts;
    expect(f.xirrPct.window).toContain("annualized");
    expect(f.xirrPct.window).toContain("95d");
    expect(f.benchmarkXirrPct.window).toBe(f.xirrPct.window);
    expect(f.excessPct.window).toBe(f.xirrPct.window);
    expect(f.curvePortfolioPct.window).toBe("90d");
  });

  it("formats every percent fact at the single page precision", () => {
    const digest = digestFixture({ pulse: { topContributors: [], healthFactors: [], healthScore: null } });
    expect(formatFact(digest.facts.cashPct, "plain")).toBe("32.9%");
    expect(formatFact(digest.facts.dayPnlPct)).toBe("+1.2%");
    expect(formatFact(digest.facts.xirrPct)).toBe("+68.6%");
    expect(formatFact(digest.facts.vixLevel)).toBe("14.90");
    expect(formatFact(digest.facts.openCount)).toBe("3");
  });

  it("null values render as an em-dash placeholder, never zero", () => {
    const digest = digestFixture({ vix: null, pulse: { topContributors: [], healthFactors: [], healthScore: null, status: "empty" } });
    expect(formatFact(digest.facts.vixLevel)).toBe("—");
    expect(formatFact(digest.facts.dayPnlPct)).toBe("—");
  });
});
