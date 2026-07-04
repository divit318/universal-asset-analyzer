import { describe, expect, it } from "vitest";
import { computeCustomScenario } from "@/lib/portfolio-analytics";
import type { EnrichedPosition } from "@/lib/portfolio-analytics";
import type { SectorRotationSnapshot, SectorRotationEntry } from "@/lib/types";

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
    weight: 50,
    sector: "Technology",
    score: null,
    momentum: null,
    dividendYield: null,
    upsidePercent: null,
    ...o,
  };
}

function rotationEntry(o: Partial<SectorRotationEntry> = {}): SectorRotationEntry {
  return {
    sector: "Technology",
    etfTicker: "XLK",
    returns: { "1w": null, "1m": null, "3m": null, "6m": null },
    relativeStrength: 0,
    momentum: 0,
    rank: 1,
    rankChange: null,
    classification: "leading",
    ...o,
  };
}

function snapshot(entries: SectorRotationEntry[]): SectorRotationSnapshot {
  return { asOf: "2026-07-03", primaryWindow: "1m", sectors: entries, leaders: [], laggards: [], leadershipChanges: [] };
}

describe("computeCustomScenario", () => {
  it("applies a uniform shock across positions weighted by portfolio %", () => {
    const positions = [position({ symbol: "A", sector: "Technology", weight: 60 }), position({ symbol: "B", sector: "Healthcare", weight: 40 })];
    const scenario = computeCustomScenario(positions, 10_000, { Technology: -30 });
    // Technology (60% weight) shocked -30%; Healthcare (40%) uses the -20% default
    expect(scenario.portfolioImpact).toBeCloseTo(-30 * 0.6 + -20 * 0.4, 1);
  });

  it("identifies the worst and best affected holdings", () => {
    const positions = [
      position({ symbol: "HIT", sector: "Energy", weight: 50 }),
      position({ symbol: "SAFE", sector: "Utilities", weight: 50 }),
    ];
    const scenario = computeCustomScenario(positions, 10_000, { Energy: -50, Utilities: 5 });
    expect(scenario.worstHolding).toBe("HIT");
    expect(scenario.bestHolding).toBe("SAFE");
  });

  it("computes dollar impact proportional to total portfolio value", () => {
    const positions = [position({ symbol: "A", sector: "Technology", weight: 100 })];
    const scenario = computeCustomScenario(positions, 50_000, { Technology: -10 });
    expect(scenario.dollarImpact).toBe(-5000);
  });

  it("amplifies a negative shock for a lagging/weakening sector (Sector Rotation Engine)", () => {
    const positions = [position({ symbol: "A", sector: "Technology", weight: 100 })];
    const lagging = snapshot([rotationEntry({ sector: "Technology", classification: "lagging" })]);
    const baseline = computeCustomScenario(positions, 10_000, { Technology: -20 }, "base", "d", null);
    const adjusted = computeCustomScenario(positions, 10_000, { Technology: -20 }, "adj", "d", lagging);
    expect(adjusted.portfolioImpact).toBeLessThan(baseline.portfolioImpact); // more negative
  });

  it("dampens a negative shock for a leading/strengthening sector", () => {
    const positions = [position({ symbol: "A", sector: "Technology", weight: 100 })];
    const leading = snapshot([rotationEntry({ sector: "Technology", classification: "leading" })]);
    const baseline = computeCustomScenario(positions, 10_000, { Technology: -20 }, "base", "d", null);
    const adjusted = computeCustomScenario(positions, 10_000, { Technology: -20 }, "adj", "d", leading);
    expect(adjusted.portfolioImpact).toBeGreaterThan(baseline.portfolioImpact); // less negative
  });

  it("does not adjust a positive shock even for a lagging sector", () => {
    const positions = [position({ symbol: "A", sector: "Energy", weight: 100 })];
    const lagging = snapshot([rotationEntry({ sector: "Energy", classification: "lagging" })]);
    const scenario = computeCustomScenario(positions, 10_000, { Energy: 15 }, "up", "d", lagging);
    expect(scenario.portfolioImpact).toBeCloseTo(15, 1);
  });

  it("falls back to the default -20% shock for a sector not in the shock map", () => {
    const positions = [position({ symbol: "A", sector: "Real Estate", weight: 100 })];
    const scenario = computeCustomScenario(positions, 10_000, { Technology: -30 });
    expect(scenario.portfolioImpact).toBeCloseTo(-20, 1);
  });
});
