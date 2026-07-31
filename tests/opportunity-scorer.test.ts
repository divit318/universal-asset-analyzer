import { describe, it, expect, vi } from "vitest";
import type { ScannerOpportunity, CompositeScores, Quote, SectorImpact } from "@/lib/types";

// Isolate scoring math from the DB-backed rotation snapshot: a missing
// snapshot is the documented degraded path (event-driven signal alone).
vi.mock("@/lib/sector-rotation", () => ({
  getLatestSectorRotation: () => null,
  findSectorRotationEntry: () => null,
}));

const { scoreOpportunities, segmentOpportunities } = await import("@/lib/scanner/opportunity-scorer");

function compositeScores(overrides: Partial<CompositeScores> = {}): CompositeScores {
  return { value: 50, growth: 50, quality: 50, financialHealth: 50, momentum: 50, overall: 50, ...overrides };
}

function opportunity(overrides: Partial<ScannerOpportunity> = {}): ScannerOpportunity {
  return {
    id: "id-1",
    ticker: "AAA",
    name: "Alpha Corp",
    isIndian: false,
    direction: "bullish",
    theme: "Technology",
    category: "company",
    rationale: "r",
    timeframe: "medium",
    quote: null,
    compositeScores: null,
    opportunityScore: {
      catalystStrength: 60,
      fundamentalQuality: 0,
      valuation: 0,
      momentum: 0,
      composite: 0,
      verdict: "weak",
    },
    thesis: null,
    sourceEventIds: ["e1"],
    dividendYieldPct: null,
    profile: null,
    ...overrides,
  };
}

function quoteWith(changePercent: number): Quote {
  return { symbol: "AAA", price: 100, changePercent } as Quote;
}

function sectorImpact(sector: string, strength: number, direction: SectorImpact["direction"] = "bullish"): SectorImpact {
  return { sector, etfTicker: null, direction, strength, rationale: "r", keyBeneficiaries: [], keyLosers: [], drivingEvents: ["e1"] };
}

describe("scoreOpportunities — factor score scale", () => {
  it("momentum is an integer even when the quote's changePercent is fractional", () => {
    // The reported bug: Catalyst/Quality/Valuation rendered as integers while
    // Momentum rendered raw floats (78.00794) — directionBoost carries the
    // quote's fractional changePercent into the score unrounded.
    const [scored] = scoreOpportunities(
      [opportunity({
        compositeScores: compositeScores({ momentum: 78 }),
        quote: quoteWith(0.00397),
        direction: "bullish",
      })],
      [sectorImpact("Technology", 60)],
    );
    expect(scored.opportunityScore.momentum).toBe(78);
    expect(Number.isInteger(scored.opportunityScore.momentum)).toBe(true);
  });

  it("momentum is an integer on the no-composite fallback path too", () => {
    const [scored] = scoreOpportunities(
      [opportunity({ compositeScores: null, quote: quoteWith(-1.23456), direction: "bearish" })],
      [sectorImpact("Technology", 60)],
    );
    // base 50 + |−1.23456| × 2 = 52.46912 → 52
    expect(scored.opportunityScore.momentum).toBe(52);
    expect(Number.isInteger(scored.opportunityScore.momentum)).toBe(true);
  });

  it("every factor score and the composite are integers", () => {
    const [scored] = scoreOpportunities(
      [opportunity({
        compositeScores: compositeScores({ momentum: 91, overall: 73, value: 61 }),
        quote: quoteWith(0.97163),
      })],
      [sectorImpact("Technology", 55)],
    );
    const s = scored.opportunityScore;
    for (const key of ["catalystStrength", "fundamentalQuality", "valuation", "momentum", "composite"] as const) {
      expect(Number.isInteger(s[key]), `${key} should be an integer, got ${s[key]}`).toBe(true);
    }
  });
});

describe("scoreOpportunities — differentiation", () => {
  it("clearly strong and clearly weak inputs produce different composites and verdicts", () => {
    const strong = opportunity({
      id: "s", ticker: "STRONG", theme: "Technology",
      compositeScores: compositeScores({ overall: 85, value: 80, momentum: 85 }),
      quote: quoteWith(2.5),
      direction: "bullish",
    });
    const weak = opportunity({
      id: "w", ticker: "WEAK", theme: "Real Estate",
      compositeScores: compositeScores({ overall: 40, value: 35, momentum: 30 }),
      quote: quoteWith(1.5), // moving AGAINST its bearish thesis — no boost
      direction: "bearish",
    });
    const scored = scoreOpportunities(
      [strong, weak],
      [sectorImpact("Technology", 80, "bullish"), sectorImpact("Real Estate", 50, "bearish")],
    );
    const s = scored.find((o) => o.ticker === "STRONG")!.opportunityScore;
    const w = scored.find((o) => o.ticker === "WEAK")!.opportunityScore;
    expect(s.composite).toBeGreaterThan(w.composite);
    expect(s.composite - w.composite).toBeGreaterThanOrEqual(20);
    expect(s.verdict).not.toBe(w.verdict);
  });

  it("preserves each opportunity's own direction — scoring never overwrites it", () => {
    const scored = scoreOpportunities(
      [
        opportunity({ id: "a", ticker: "AAA", direction: "bullish" }),
        opportunity({ id: "b", ticker: "BBB", direction: "bearish" }),
      ],
      [sectorImpact("Technology", 60)],
    );
    expect(scored.find((o) => o.ticker === "AAA")!.direction).toBe("bullish");
    expect(scored.find((o) => o.ticker === "BBB")!.direction).toBe("bearish");
  });
});

describe("segmentOpportunities", () => {
  it("splits on the documented composite bands", () => {
    const mk = (id: string, composite: number) => {
      const o = opportunity({ id, ticker: id });
      o.opportunityScore = { ...o.opportunityScore, composite };
      return o;
    };
    const { all, highConviction, developing } = segmentOpportunities([mk("hi", 75), mk("dev", 55), mk("lo", 30)]);
    expect(all.map((o) => o.ticker)).toEqual(["hi", "dev", "lo"]);
    expect(highConviction.map((o) => o.ticker)).toEqual(["hi"]);
    expect(developing.map((o) => o.ticker)).toEqual(["dev"]);
  });
});
