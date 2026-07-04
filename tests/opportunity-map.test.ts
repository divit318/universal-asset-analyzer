import { describe, expect, it } from "vitest";
import { buildClusters, type OpportunityMapNode } from "@/lib/opportunity-map";

function node(overrides: Partial<OpportunityMapNode>): OpportunityMapNode {
  return {
    id: overrides.id ?? "1",
    symbol: overrides.symbol ?? "AAA",
    name: "Test Co",
    theme: overrides.theme ?? "AI Infrastructure",
    category: "high_conviction",
    categoryLabel: "High Conviction",
    opportunityScore: overrides.opportunityScore ?? 70,
    conviction: "High",
    confidence: 70,
    expectedVolatility: "Medium",
    direction: "bullish",
    timeHorizon: "Months",
    price: 100,
    changePercent: 1,
    marketCap: 1_000_000_000,
    dividendYieldPct: null,
    bullCase: [],
    bearCase: [],
    keyCatalyst: null,
    primaryRisk: null,
    tier: "high_conviction",
    inPortfolio: false,
    inWatchlist: false,
    ...overrides,
  };
}

describe("buildClusters", () => {
  it("groups nodes by theme", () => {
    const nodes = [
      node({ id: "1", theme: "AI Infrastructure" }),
      node({ id: "2", theme: "AI Infrastructure" }),
      node({ id: "3", theme: "Energy" }),
    ];
    const clusters = buildClusters(nodes);
    expect(clusters).toHaveLength(2);
    const ai = clusters.find((c) => c.theme === "AI Infrastructure")!;
    expect(ai.count).toBe(2);
    expect(ai.nodeIds).toEqual(["1", "2"]);
  });

  it("computes the average opportunity score per cluster", () => {
    const nodes = [
      node({ id: "1", theme: "Energy", opportunityScore: 60 }),
      node({ id: "2", theme: "Energy", opportunityScore: 80 }),
    ];
    const clusters = buildClusters(nodes);
    expect(clusters[0].avgScore).toBe(70);
  });

  it("ranks clusters by average score, highest first", () => {
    const nodes = [
      node({ id: "1", theme: "Low Score Theme", opportunityScore: 30 }),
      node({ id: "2", theme: "High Score Theme", opportunityScore: 90 }),
    ];
    const clusters = buildClusters(nodes);
    expect(clusters[0].theme).toBe("High Score Theme");
    expect(clusters[1].theme).toBe("Low Score Theme");
  });

  it("returns an empty array for no nodes", () => {
    expect(buildClusters([])).toEqual([]);
  });

  it("creates a single-member cluster for a unique theme", () => {
    const nodes = [node({ id: "1", theme: "Niche Theme", opportunityScore: 55 })];
    const clusters = buildClusters(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(1);
    expect(clusters[0].avgScore).toBe(55);
  });
});
