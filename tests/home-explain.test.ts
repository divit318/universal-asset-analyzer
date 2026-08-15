import { describe, it, expect } from "vitest";
import { explainAttentionScore, explainDecision, explainAlignment, explainSentiment } from "@/lib/home/explain";
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
    alignmentScore: 72,
    alignmentLabel: "Well aligned",
    alignmentConfirmed: false,
    topMismatch: null,
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
    alignmentEvidencePct: 85,
    alignmentFactors: [
      { label: "Concentration", score: 80, weightShare: 0.5, contributionPts: 40, covered: true, evidencePct: 100, unratedReason: null },
      { label: "Liquidity", score: 64, weightShare: 0.5, contributionPts: 32, covered: true, evidencePct: 70, unratedReason: null },
      { label: "Income", score: null, weightShare: null, contributionPts: null, covered: false, evidencePct: 100, unratedReason: "opted_out" },
      { label: "Geography & currency", score: null, weightShare: null, contributionPts: null, covered: false, evidencePct: 20, unratedReason: "insufficient_data" },
    ],
    topContributors: [],
    topContributorsResidualBps: null,
    dayCoveragePct: null,
    topPositions: [],
    sleeves: [],
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

describe("explainAlignment", () => {
  it("returns null when there is nothing to decompose", () => {
    expect(explainAlignment(pulse({ alignmentScore: null }))).toBeNull();
    expect(explainAlignment(pulse({ alignmentFactors: [] }))).toBeNull();
  });

  it("carries the engine's own contributions, which sum to the total", () => {
    const ex = explainAlignment(pulse());
    expect(ex).not.toBeNull();
    const contribs = pulse().alignmentFactors.map((f) => f.contributionPts ?? 0);
    expect(contribs.reduce((a, b) => a + b, 0)).toBe(72);
    // unrated themes render as muted rows, not fake scores — and each states why
    const optedOut = ex!.factors.find((f) => f.label === "Income");
    expect(optedOut?.muted).toBe(true);
    expect(optedOut?.display).toBe("not a priority");
    const noData = ex!.factors.find((f) => f.label === "Geography & currency");
    expect(noData?.muted).toBe(true);
    expect(noData?.display).toBe("insufficient data");
  });

  it("flags thin evidence and an unconfirmed policy as caveats", () => {
    const ex = explainAlignment(pulse());
    expect(ex!.caveats.some((c) => c.includes("85%"))).toBe(true);
    expect(ex!.confidence?.label).toContain("85%");
    // scored against assumed defaults until the investor saves a policy
    expect(ex!.caveats.some((c) => c.includes("assumed default"))).toBe(true);
    const confirmed = explainAlignment(pulse({ alignmentConfirmed: true }));
    expect(confirmed!.caveats.some((c) => c.includes("assumed default"))).toBe(false);
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
      alignmentBefore: 72,
      alignmentAfter: 75.1,
      alignmentDelta: 3.1,
      riskDeltaPp: -0.8,
      incomeDeltaAnnual: 120,
      diversificationDelta: -200,
    },
    alternativesEvaluated: 12,
    thesis: null,
  };

  it("returns null for unscored queue items rather than inventing a breakdown", () => {
    expect(explainDecision({ ...decision, decisionScore: null, impact: null })).toBeNull();
  });

  it("states the simulated before → after and the honest no-forecast caveat", () => {
    const ex = explainDecision(decision);
    expect(ex).not.toBeNull();
    const alignment = ex!.factors.find((f) => f.label === "Alignment impact");
    expect(alignment?.detail).toContain("72 → 75.1");
    expect(ex!.caveats.some((c) => c.includes("12 alternative"))).toBe(true);
    expect(ex!.caveats.some((c) => c.includes("No forward price-return"))).toBe(true);
    // risk reduction (negative delta) is presented as a positive factor
    expect(ex!.factors.find((f) => f.label === "Risk")?.direction).toBe(1);
  });
});
