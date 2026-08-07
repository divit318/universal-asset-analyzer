import { describe, it, expect } from "vitest";
import { explainAttentionScore, explainDecision, explainHealth, explainSentiment } from "@/lib/home/explain";
import { SCORE_EXPONENTS, scoreSeed, priorityBucket } from "@/lib/home/attention";
import type { AttentionItem, PortfolioPulse, RecommendedAction, SentimentGauge } from "@/lib/home/contracts";

function attentionItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: "action:1",
    dedupeKey: "action:AAPL:70",
    kind: "action",
    symbol: "AAPL",
    headline: "Reduce AAPL",
    rationale: "Concentration",
    score: scoreSeed({ impact: 0.7, urgency: 0.6, confidence: 0.8 }),
    impact: 0.7,
    urgency: 0.6,
    confidence: 0.8,
    occursAt: null,
    primaryAction: { label: "Open", href: "/portfolio" },
    source: "actions",
    ...overrides,
  };
}

function pulse(overrides: Partial<PortfolioPulse> = {}): PortfolioPulse {
  return {
    status: "ok",
    healthScore: 72,
    healthGrade: "B",
    totalValue: 100_000,
    todayChangePct: 0,
    todayChangeDollar: 0,
    bestPerformer: null,
    worstPerformer: null,
    sessionNote: null,
    asOf: 0,
    sessionDate: null,
    largestRisk: null,
    largestOpportunity: null,
    cashPct: 5,
    diversificationScore: 60,
    largestDrift: null,
    totalReturnOnCostPct: 3.1,
    marketPricedPct: 100,
    radar: [],
    biggestStrength: null,
    biggestWeakness: null,
    healthCoveragePct: 85,
    healthFactors: [
      { label: "Diversification", score: 80, weightShare: 0.5, contributionPts: 40, covered: true, coveragePct: 100 },
      { label: "Income", score: 64, weightShare: 0.5, contributionPts: 32, covered: true, coveragePct: 70 },
      { label: "Geography", score: null, weightShare: null, contributionPts: null, covered: false, coveragePct: 0 },
    ],
    topContributors: [],
    topContributorsResidualBps: null,
    dayCoveragePct: null,
    ...overrides,
  };
}

describe("explainAttentionScore", () => {
  it("states the real formula and shows each input as its multiplier", () => {
    const item = attentionItem();
    const ex = explainAttentionScore(item);
    expect(ex.method).toContain(`impact^${SCORE_EXPONENTS.impact}`);
    expect(ex.factors).toHaveLength(3);
    // the impact factor's bar is the actual multiplier the formula applies
    const impactFactor = ex.factors[0];
    expect(impactFactor.bar).toBeCloseTo(Math.pow(0.7, SCORE_EXPONENTS.impact), 5);
    // The value leads with the band the UI renders; the raw number lives in
    // the drill-through (audit DU-01/DU-02).
    expect(ex.value).toBe(`${priorityBucket(item.score).label} · ${Math.round(item.score)}/100`);
  });
});

describe("explainHealth", () => {
  it("returns null when there is nothing to decompose", () => {
    expect(explainHealth(pulse({ healthScore: null }))).toBeNull();
    expect(explainHealth(pulse({ healthFactors: [] }))).toBeNull();
  });

  it("carries the engine's own contributions, which sum to the total", () => {
    const ex = explainHealth(pulse());
    expect(ex).not.toBeNull();
    const contribs = pulse().healthFactors.map((f) => f.contributionPts ?? 0);
    expect(contribs.reduce((a, b) => a + b, 0)).toBe(72);
    // abstained dimension renders as a muted row, not a fake score
    const abstained = ex!.factors.find((f) => f.label === "Geography");
    expect(abstained?.muted).toBe(true);
    expect(abstained?.display).toBe("abstained");
  });

  it("flags incomplete coverage as a caveat", () => {
    const ex = explainHealth(pulse());
    expect(ex!.caveats.some((c) => c.includes("15%"))).toBe(true);
    expect(ex!.confidence?.label).toContain("85%");
  });
});

describe("explainSentiment", () => {
  it("names the gauge honestly and mutes missing components", () => {
    const gauge: SentimentGauge = {
      score: 62,
      label: "Greed",
      confidence: "medium",
      components: [
        { name: "Breadth", value: 70, contribution: 8 },
        { name: "Volatility", value: null, contribution: 0 },
      ],
    };
    const ex = explainSentiment(gauge);
    expect(ex.caveats.some((c) => c.includes("NOT CNN"))).toBe(true);
    expect(ex.factors.find((f) => f.label === "Volatility")?.muted).toBe(true);
    expect(ex.factors.find((f) => f.label === "Breadth")?.direction).toBe(1);
  });
});

describe("explainDecision", () => {
  const decision: RecommendedAction = {
    id: "rec-1",
    symbol: "AAPL",
    subject: "AAPL",
    action: "REDUCE",
    title: "Reduce AAPL",
    reason: "Concentration",
    decisionScore: 74,
    priority: 1,
    confidence: 0.85,
    expectedImpact: null,
    expectedImprovement: null,
    severity: "high",
    href: "/portfolio",
    source: "decision",
    why: {
      why: "w",
      whyNow: "now",
      whyThisAmount: "amt",
      whyNotAlternative: "alt",
      whyNotNothing: "nothing",
    },
    impact: {
      healthBefore: 72,
      healthAfter: 75.1,
      healthDelta: 3.1,
      riskDeltaPp: -0.8,
      incomeDeltaAnnual: 120,
      diversificationDelta: -200,
    },
    alternativesEvaluated: 12,
  };

  it("returns null for unscored queue items rather than inventing a breakdown", () => {
    expect(explainDecision({ ...decision, decisionScore: null, impact: null })).toBeNull();
  });

  it("states the simulated before → after and the honest no-forecast caveat", () => {
    const ex = explainDecision(decision);
    expect(ex).not.toBeNull();
    const health = ex!.factors.find((f) => f.label === "Health impact");
    expect(health?.detail).toContain("72 → 75.1");
    expect(ex!.caveats.some((c) => c.includes("12 alternative"))).toBe(true);
    expect(ex!.caveats.some((c) => c.includes("No forward price-return"))).toBe(true);
    // risk reduction (negative delta) is presented as a positive factor
    expect(ex!.factors.find((f) => f.label === "Risk")?.direction).toBe(1);
  });
});
