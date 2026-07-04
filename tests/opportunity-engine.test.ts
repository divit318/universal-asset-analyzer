import { describe, expect, it } from "vitest";
import { buildOpportunityProfile, groupByCategory } from "@/lib/opportunity-engine";
import type { OpportunityEngineInput } from "@/lib/opportunity-engine";

const base = (o: Partial<OpportunityEngineInput> = {}): OpportunityEngineInput => ({
  symbol: "TEST",
  score: 50,
  dimensions: { value: null, growth: null, quality: null, financialHealth: null, momentum: null },
  ...o,
});

describe("buildOpportunityProfile", () => {
  it("tags a cheap, high-quality stock as value + quality compounder + high conviction", () => {
    const profile = buildOpportunityProfile(
      base({
        score: 78,
        dimensions: { value: 80, growth: 55, quality: 75, financialHealth: 70, momentum: 50 },
        confidence: 70,
      }),
    );
    expect(profile.categories).toContain("value");
    expect(profile.categories).toContain("quality_compounder");
    expect(profile.categories).toContain("high_conviction");
    expect(profile.conviction).toBe("High");
  });

  it("never returns an empty category list", () => {
    const profile = buildOpportunityProfile(base({ score: 40 }));
    expect(profile.categories.length).toBeGreaterThan(0);
  });

  it("tags dividend opportunities from yield alone", () => {
    const profile = buildOpportunityProfile(base({ score: 55, dividendYieldPct: 4.2 }));
    expect(profile.categories).toContain("dividend");
  });

  it("tags momentum leaders from a strong recent return", () => {
    const profile = buildOpportunityProfile(
      base({ score: 60, momentum3mReturn: 22, momentumTrend: "up" }),
    );
    expect(profile.categories).toContain("momentum_leader");
    expect(profile.expectedVolatility).toBe("High");
  });

  it("derives Low conviction for a middling, low-confidence score", () => {
    const profile = buildOpportunityProfile(base({ score: 35, confidence: 30 }));
    expect(profile.conviction).toBe("Low");
  });

  it("prefers the AI thesis narrative and horizon when one is supplied", () => {
    const profile = buildOpportunityProfile(
      base({
        score: 75,
        confidence: 40,
        thesis: {
          headline: "h",
          summary: "AI generated summary",
          bullCase: ["ai bull 1"],
          bearCase: ["ai bear 1"],
          keyCatalysts: ["catalyst 1"],
          keyRisks: ["risk 1"],
          timeHorizon: "quarters",
          confidence: 88,
          potentialWinners: [],
          potentialLosers: [],
        },
      }),
    );
    expect(profile.explanation).toBe("AI generated summary");
    expect(profile.bullCase).toEqual(["ai bull 1"]);
    expect(profile.suggestedHoldingPeriod).toBe("Months – Quarters");
    expect(profile.confidence).toBe(88);
  });

  it("surfaces weak dimensions as bear case when no risk items or thesis are given", () => {
    const profile = buildOpportunityProfile(
      base({ score: 42, dimensions: { value: 30, growth: null, quality: null, financialHealth: null, momentum: null } }),
    );
    expect(profile.bearCase.some((b) => b.includes("Valuation"))).toBe(true);
  });
});

describe("groupByCategory", () => {
  it("groups items under every category they qualify for", () => {
    const items = [
      { id: "a", categories: ["value", "dividend"] as const },
      { id: "b", categories: ["dividend"] as const },
    ];
    const grouped = groupByCategory(items, (i) => ({ categories: [...i.categories] }));
    expect(grouped.get("dividend")?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(grouped.get("value")?.map((i) => i.id)).toEqual(["a"]);
  });
});
