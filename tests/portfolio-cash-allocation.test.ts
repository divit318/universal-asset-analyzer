import { describe, expect, it } from "vitest";
import { computeCashAllocation } from "@/lib/portfolio-analytics";
import type { EnrichedPosition, PortfolioReport, PositionRecommendation } from "@/lib/portfolio-analytics";
import type { ScoreResult } from "@/lib/types";

function score(composite: number): ScoreResult {
  return {
    total: composite,
    composite,
    buckets: [],
    recommendation: "HOLD",
    confidence: 70,
    rationale: "",
    signals: { fundamentals: composite, analysts: null, momentum: null },
  };
}

function position(o: Partial<EnrichedPosition> = {}): EnrichedPosition {
  return {
    symbol: "TEST",
    name: "Test Co",
    shares: 10,
    avgCost: 100,
    price: 100,
    value: 1000,
    costBasis: 1000,
    unrealizedPL: 0,
    unrealizedPct: 0,
    todayChangePct: 0,
    todayChangeDollar: 0,
    weight: 10,
    sector: "Technology",
    score: null,
    momentum: null,
    dividendYield: null,
    upsidePercent: null,
    ...o,
  };
}

function recommendation(o: Partial<PositionRecommendation> = {}): PositionRecommendation {
  return {
    symbol: "TEST",
    name: "Test Co",
    action: "HOLD",
    confidence: 60,
    currentWeight: 10,
    targetWeight: 10,
    delta: 0,
    suggestedDollar: 0,
    suggestedShares: null,
    composite: 50,
    fundamentalScore: 50,
    analystScore: null,
    momentumScore: null,
    reasoning: "Reasoning text.",
    keyMetrics: [],
    catalysts: [],
    risks: [],
    ...o,
  };
}

function report(o: Partial<PortfolioReport> = {}): PortfolioReport {
  return {
    generatedAt: "2026-07-10T00:00:00Z",
    positionCount: 1,
    totalCost: 1000,
    totalValue: 1000,
    totalReturn: 0,
    totalReturnDollar: 0,
    todayChangeDollar: 0,
    todayChangePct: 0,
    positions: [],
    sectorAllocation: [],
    concentrationWarnings: [],
    health: { total: 0, grade: "F", dimensions: [], summary: "" },
    recommendations: [],
    rebalance: { trades: [], sectorChanges: [], buyTotal: 0, sellTotal: 0, netCash: 0, estimatedRiskReduction: null },
    gaps: { missing: [], overweight: [], concentrationScore: 0 },
    risk: { annualizedVolatility: null, beta: null, sharpeRatio: null, sortinoRatio: null, maxDrawdown: null, var95Pct: null, var95Dollar: null, hhi: 0, topPositionWeight: 0, topSectorWeight: 0, concentrationRisk: "low" },
    factors: { tilts: [], topFactor: "", bottomFactor: "" },
    scenarios: [],
    correlation: null,
    benchmark: null,
    opportunities: [],
    alerts: [],
    ...o,
  };
}

describe("computeCashAllocation", () => {
  it("still allocates cash to a STRONG_BUY position whose delta is <= 0 (the AVGO $0.00 bug)", () => {
    // classifyAction grants STRONG_BUY for composite >= 78 even when delta is
    // slightly negative (already at/above its computed target weight).
    const rec = recommendation({
      symbol: "AVGO",
      name: "Broadcom Inc.",
      action: "STRONG_BUY",
      composite: 83,
      currentWeight: 10.2,
      targetWeight: 9.8,
      delta: -0.4,
      reasoning: "Strong Buy — composite score 83/100 (81% confidence).",
    });
    const r = report({
      positions: [position({ symbol: "AVGO", name: "Broadcom Inc.", price: 250, weight: 10.2 })],
      recommendations: [rec],
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(10_000, r);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].dollarAmount).toBeGreaterThan(0);
    expect(allocations[0].dollarAmount).toBeCloseTo(10_000, 0);
  });

  it("splits cash proportionally across multiple buys, weighting by both room-to-target and conviction", () => {
    const recs = [
      recommendation({ symbol: "MU", action: "INCREASE", composite: 87, currentWeight: 4, targetWeight: 10, delta: 6 }),
      recommendation({ symbol: "AVGO", action: "STRONG_BUY", composite: 83, currentWeight: 10.2, targetWeight: 9.8, delta: -0.4 }),
    ];
    const r = report({
      positions: [
        position({ symbol: "MU", price: 100, weight: 4 }),
        position({ symbol: "AVGO", price: 250, weight: 10.2 }),
      ],
      recommendations: recs,
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(10_000, r);
    const total = allocations.reduce((s, a) => s + a.dollarAmount, 0);
    expect(total).toBeCloseTo(10_000, 0);
    // MU has a much larger weight gap and should receive materially more cash than AVGO
    const mu = allocations.find((a) => a.symbol === "MU")!;
    const avgo = allocations.find((a) => a.symbol === "AVGO")!;
    expect(mu.dollarAmount).toBeGreaterThan(avgo.dollarAmount);
    expect(avgo.dollarAmount).toBeGreaterThan(0);
  });

  it("does not leave cash unallocated when there are more than 5 buy candidates", () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G"];
    const recs = symbols.map((s, i) =>
      recommendation({ symbol: s, action: "INCREASE", composite: 90 - i, currentWeight: 2, targetWeight: 8, delta: 6 }),
    );
    const r = report({
      positions: symbols.map((s) => position({ symbol: s, price: 50, weight: 2 })),
      recommendations: recs,
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(10_000, r);
    expect(allocations).toHaveLength(5);
    const total = allocations.reduce((s, a) => s + a.dollarAmount, 0);
    expect(total).toBeCloseTo(10_000, 0);
  });

  it("falls back to top-scoring held positions when nothing qualifies as a buy", () => {
    const r = report({
      positions: [
        position({ symbol: "A", price: 100, weight: 50, score: score(80) }),
        position({ symbol: "B", price: 100, weight: 50, score: score(60) }),
      ],
      recommendations: [
        recommendation({ symbol: "A", action: "HOLD", composite: 80, currentWeight: 50, targetWeight: 50, delta: 0 }),
        recommendation({ symbol: "B", action: "HOLD", composite: 60, currentWeight: 50, targetWeight: 50, delta: 0 }),
      ],
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(5_000, r);
    expect(allocations[0].symbol).toBe("A");
    // Only 2 positions exist, so the [0.5, 0.3] fallback weights are
    // renormalized to [0.625, 0.375] rather than leaving 20% unallocated.
    expect(allocations[0].dollarAmount).toBeCloseTo(3_125, 0);
    const total = allocations.reduce((s, a) => s + a.dollarAmount, 0);
    expect(total).toBeCloseTo(5_000, 0);
  });

  it("handles a position with no price data by returning a null share count instead of throwing", () => {
    const r = report({
      positions: [position({ symbol: "AVGO", price: null, weight: 5 })],
      recommendations: [recommendation({ symbol: "AVGO", action: "STRONG_BUY", composite: 90, currentWeight: 5, targetWeight: 12, delta: 7 })],
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(1_000, r);
    expect(allocations[0].shareCount).toBeNull();
    expect(allocations[0].dollarAmount).toBeCloseTo(1_000, 0);
  });

  it("handles very small investments without producing negative or NaN amounts", () => {
    const r = report({
      positions: [position({ symbol: "A", price: 500, weight: 5 })],
      recommendations: [recommendation({ symbol: "A", action: "INCREASE", composite: 75, currentWeight: 5, targetWeight: 10, delta: 5 })],
      totalValue: 100_000,
    });

    const allocations = computeCashAllocation(1, r);
    expect(allocations[0].dollarAmount).toBeCloseTo(1, 2);
    expect(allocations[0].shareCount).toBe(0);
  });
});
