import { describe, expect, it } from "vitest";
import {
  buildResearchBrief,
  briefFactLines,
  findConflicts,
  readSignals,
  readTrends,
  buildTriggers,
  type SignalReading,
} from "@/lib/ai/tension";
import type { CompanyContext } from "@/lib/ai/types";
import type { FinancialStatements } from "@/lib/types";

/**
 * The tension engine is what makes the verdict synthesis rather than
 * restatement, so its job is to find the disagreement a human analyst would
 * lead with. These tests pin that behaviour on the exact case that motivated
 * the module: Disney, where analysts are very bullish while growth and quality
 * are weak, and the deterministic verdict is nonetheless HOLD.
 */

function ctx(overrides: Partial<CompanyContext> = {}): CompanyContext {
  return {
    symbol: "DIS",
    name: "Walt Disney Co",
    builtAt: new Date().toISOString(),
    quote: { symbol: "DIS", name: "Walt Disney Co", price: 102.53, changePercent: 0.4 } as CompanyContext["quote"],
    profile: null,
    snapshot: null,
    statements: null,
    analyst: null,
    insider: null,
    score: null,
    risks: [],
    momentum: null,
    personality: null,
    peers: null,
    filings: [],
    news: [],
    onWatchlist: false,
    savedNotes: [],
    warnings: [],
    ownership: null,
    sectorRotation: null,
    recentTimelineEvents: [],
    relatedOpportunities: null,
    graphNeighbors: [],
    ...overrides,
  } as CompanyContext;
}

const bucket = (name: string, points: number, max: number, detail = "") => ({
  name,
  points,
  max,
  factors: detail ? [{ label: name, points, max, detail }] : [],
});

/** The real DIS shape: valuation/capital allocation strong, growth/quality weak. */
const DIS_SCORE = {
  total: 55,
  composite: 55,
  recommendation: "HOLD" as const,
  confidence: 70,
  rationale: "mixed",
  signals: { fundamentals: 55, analysts: 72, momentum: 48 },
  buckets: [
    bucket("Valuation", 67, 100, "Fwd P/E 13.79x"),
    bucket("Capital Allocation", 83, 100, "FCF CAGR +111%"),
    bucket("Growth", 20, 100, "EPS growth -48.3%"),
    bucket("Quality", 44, 100, "ROE 8.0%"),
  ],
};

describe("readSignals", () => {
  it("normalizes every score bucket onto one 0-100 scale", () => {
    const signals = readSignals(ctx({ score: DIS_SCORE as never }));
    const byLabel = Object.fromEntries(signals.map((s) => [s.label, s.score]));

    expect(byLabel.Valuation).toBe(67);
    expect(byLabel["Capital Allocation"]).toBe(83);
    expect(byLabel.Growth).toBe(20);
    expect(byLabel.Quality).toBe(44);
  });

  it("assigns stance from the score so signals become comparable", () => {
    const signals = readSignals(ctx({ score: DIS_SCORE as never }));
    const stance = (label: string) => signals.find((s) => s.label === label)?.stance;

    expect(stance("Capital Allocation")).toBe("supportive");
    expect(stance("Growth")).toBe("opposed");
    expect(stance("Quality")).toBe("opposed");
  });

  it("derives analyst consensus from the ratings split, not the bucket", () => {
    const signals = readSignals(
      ctx({
        analyst: {
          strongBuy: 20, buy: 9, hold: 2, sell: 1, strongSell: 0,
          targetMean: 127.72, targetHigh: null, targetLow: null,
          upsidePercent: 24.6, recommendationKey: "strong_buy", numberOfOpinions: 32,
          epsRevisionsUp30d: null, epsRevisionsDown30d: null, epsSurprises: [],
        },
      }),
    );
    const analyst = signals.find((s) => s.key === "analyst-consensus");

    // 29 bullish of 32 → 91/100, and the detail carries the split verbatim.
    expect(analyst?.score).toBe(91);
    expect(analyst?.stance).toBe("supportive");
    expect(analyst?.detail).toContain("29 buy / 2 hold / 1 sell of 32");
  });

  it("omits analyst consensus entirely when no analyst covers the name", () => {
    const signals = readSignals(ctx({ analyst: null }));
    expect(signals.find((s) => s.key === "analyst-consensus")).toBeUndefined();
  });
});

describe("findConflicts", () => {
  it("finds the analyst-vs-growth disagreement and ranks it first by gap", () => {
    const signals: SignalReading[] = [
      { key: "analyst-consensus", label: "Analyst consensus", score: 91, stance: "supportive", detail: null },
      { key: "valuation", label: "Valuation", score: 67, stance: "supportive", detail: null },
      { key: "growth", label: "Growth", score: 20, stance: "opposed", detail: null },
      { key: "quality", label: "Quality", score: 44, stance: "opposed", detail: null },
    ];
    const conflicts = findConflicts(signals);

    expect(conflicts[0].positive.label).toBe("Analyst consensus");
    expect(conflicts[0].negative.label).toBe("Growth");
    expect(conflicts[0].gap).toBe(71);
    expect(conflicts[0].statement).toContain("Analyst consensus is strong (91/100)");
    expect(conflicts[0].statement).toContain("Growth is weak (20/100)");
  });

  it("reports no conflict when every signal agrees — never manufactures tension", () => {
    const signals: SignalReading[] = [
      { key: "valuation", label: "Valuation", score: 78, stance: "supportive", detail: null },
      { key: "growth", label: "Growth", score: 72, stance: "supportive", detail: null },
    ];
    expect(findConflicts(signals)).toEqual([]);
  });

  it("ignores differences too small to be a real disagreement", () => {
    const signals: SignalReading[] = [
      { key: "valuation", label: "Valuation", score: 61, stance: "supportive", detail: null },
      { key: "quality", label: "Quality", score: 45, stance: "opposed", detail: null },
    ];
    // A 16-point gap is below MIN_CONFLICT_GAP — differing, not disagreeing.
    expect(findConflicts(signals)).toEqual([]);
  });

  it("caps at three conflicts, because naming five tensions names none", () => {
    const signals: SignalReading[] = [
      { key: "a", label: "A", score: 95, stance: "supportive", detail: null },
      { key: "b", label: "B", score: 90, stance: "supportive", detail: null },
      { key: "c", label: "C", score: 85, stance: "supportive", detail: null },
      { key: "d", label: "D", score: 10, stance: "opposed", detail: null },
      { key: "e", label: "E", score: 15, stance: "opposed", detail: null },
    ];
    expect(findConflicts(signals)).toHaveLength(3);
  });
});

describe("readTrends", () => {
  const statements = {
    symbol: "DIS",
    fiscalYears: [2022, 2023, 2024, 2025],
    revenue: [], grossProfit: [], operatingIncome: [], netIncome: [], freeCashFlow: [],
    grossMargin: [], netMargin: [],
    operatingMargin: [
      { fy: 2022, value: 0.128 },
      { fy: 2023, value: 0.151 },
      { fy: 2024, value: 0.174 },
      { fy: 2025, value: 0.193 },
    ],
    revenueCagr: 0.068,
    fcfCagr: 1.11,
  } as unknown as FinancialStatements;

  it("reads multi-year margin direction, which point-in-time YoY cannot show", () => {
    const trends = readTrends(statements);
    const op = trends.find((t) => t.label === "Operating margin");

    expect(op?.direction).toBe("improving");
    expect(op?.detail).toContain("12.8% (FY2022) → 19.3% (FY2025)");
    expect(op?.detail).toContain("+6.5pp over 4 years");
  });

  it("returns nothing when there are no statements rather than guessing", () => {
    expect(readTrends(null)).toEqual([]);
  });

  it("does not emit a trend from a single data point", () => {
    const one = { ...statements, operatingMargin: [{ fy: 2025, value: 0.193 }], revenueCagr: null, fcfCagr: null };
    expect(readTrends(one as unknown as FinancialStatements)).toEqual([]);
  });
});

describe("buildTriggers", () => {
  it("derives a measurable trigger from the binding weak bucket", () => {
    const c = ctx({
      score: DIS_SCORE as never,
      snapshot: { earningsGrowth: -0.483, returnOnEquity: 0.08 } as CompanyContext["snapshot"],
    });
    const triggers = buildTriggers(c, readSignals(c));

    expect(triggers.some((t) => t.includes("EPS growth turning positive from -48.3%"))).toBe(true);
    expect(triggers.some((t) => t.includes("ROE sustained above 15%"))).toBe(true);
  });

  it("emits nothing rather than a vague placeholder when data is missing", () => {
    const c = ctx({ score: DIS_SCORE as never, snapshot: null });
    expect(buildTriggers(c, readSignals(c))).toEqual([]);
  });
});

describe("buildResearchBrief + briefFactLines", () => {
  it("hands the model the disagreement, not just the metrics", () => {
    const c = ctx({
      score: DIS_SCORE as never,
      analyst: {
        strongBuy: 20, buy: 9, hold: 2, sell: 1, strongSell: 0,
        targetMean: 127.72, targetHigh: null, targetLow: null,
        upsidePercent: 24.6, recommendationKey: "strong_buy", numberOfOpinions: 32,
        epsRevisionsUp30d: null, epsRevisionsDown30d: null, epsSurprises: [],
      },
    });
    const brief = buildResearchBrief(c);
    const lines = briefFactLines(brief, DIS_SCORE as never).join("\n");

    expect(brief.coherent).toBe(false);
    expect(lines).toContain("THE CENTRAL DISAGREEMENTS");
    expect(lines).toContain("Analyst consensus is strong (91/100) while Growth is weak (20/100)");
    // The settled verdict is stated so the narration argues for it.
    expect(lines).toContain("composite 55/100 → HOLD");
  });

  it("tells the model to say so plainly when signals agree", () => {
    const coherent = {
      ...DIS_SCORE,
      buckets: [bucket("Valuation", 75, 100), bucket("Growth", 80, 100)],
    };
    const brief = buildResearchBrief(ctx({ score: coherent as never }));
    const lines = briefFactLines(brief, coherent as never).join("\n");

    expect(brief.coherent).toBe(true);
    expect(lines).toContain("SIGNAL AGREEMENT");
    expect(lines).toContain("rather than manufacturing a tension");
  });

  it("is pure — an empty context yields an empty brief, never a fabricated one", () => {
    const brief = buildResearchBrief(ctx());
    expect(brief.signals).toEqual([]);
    expect(brief.conflicts).toEqual([]);
    expect(brief.trends).toEqual([]);
    expect(brief.triggers).toEqual([]);
  });
});
