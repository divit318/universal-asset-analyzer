import { describe, expect, it } from "vitest";
import { applyScreen, parseFundamentalCriteria } from "@/lib/fundamental-screener";
import type { CompositeScores, StockMetrics } from "@/lib/types";

const scores = (o: Partial<CompositeScores> = {}): CompositeScores => ({
  value: 50,
  growth: 50,
  quality: 50,
  financialHealth: 50,
  momentum: 50,
  overall: 50,
  ...o,
});

const stock = (o: Partial<StockMetrics> = {}): StockMetrics => ({
  symbol: "X",
  name: "X",
  sector: "Technology",
  industry: "Software",
  price: 100,
  marketCap: 5e10,
  forwardPE: 20,
  evToEbitda: 14,
  fcfYield: 4,
  revenueGrowthYoY: 12,
  revenueCagr3y: 10,
  epsGrowthYoY: 15,
  epsCagr3y: 12,
  roic: 18,
  roe: 22,
  grossMargin: 55,
  operatingMargin: 25,
  debtToEquity: 0.6,
  netDebtToEbitda: 1.2,
  currentRatio: 1.8,
  fcfMargin: 20,
  fcfGrowthYoY: 10,
  dividendYield: 1.5,
  buybackYield: 2,
  oneYearReturn: 18,
  distanceFrom52WkHigh: -6,
  institutionalOwnership: 70,
  earningsSurprisePct: 3,
  scores: scores(),
  ...o,
});

const universe: StockMetrics[] = [
  stock({ symbol: "AAA", roe: 30, scores: scores({ overall: 88, value: 40 }) }),
  stock({ symbol: "BBB", roe: 10, sector: "Energy", scores: scores({ overall: 55 }) }),
  stock({ symbol: "CCC", roe: null, scores: scores({ overall: 72, value: 80 }) }),
];

describe("applyScreen", () => {
  it("filters by a composite-score floor", () => {
    const r = applyScreen(universe, { overallScore: { min: 70 } });
    expect(r.map((x) => x.symbol)).toEqual(["AAA", "CCC"]);
  });

  it("excludes companies missing a filtered metric", () => {
    const r = applyScreen(universe, { roe: { min: 5 } });
    expect(r.map((x) => x.symbol).sort()).toEqual(["AAA", "BBB"]); // CCC has null ROE
  });

  it("filters by sector", () => {
    const r = applyScreen(universe, { sector: "energy" });
    expect(r.map((x) => x.symbol)).toEqual(["BBB"]);
  });

  it("sorts by a chosen field, nulls last", () => {
    const r = applyScreen(universe, { sortField: "valueScore", sortDir: "desc" });
    expect(r.map((x) => x.symbol)).toEqual(["CCC", "BBB", "AAA"]);
  });

  it("defaults to overall score descending", () => {
    const r = applyScreen(universe, {});
    expect(r.map((x) => x.symbol)).toEqual(["AAA", "CCC", "BBB"]);
  });

  it("respects a min/max range", () => {
    // AAA roe=30 (above max), BBB roe=10 (in range), CCC roe=null (excluded).
    const r = applyScreen(universe, { roe: { min: 8, max: 25 } });
    expect(r.map((x) => x.symbol)).toEqual(["BBB"]);
  });
});

describe("parseFundamentalCriteria", () => {
  it("parses nested range filters, sector and sort", () => {
    const c = parseFundamentalCriteria({
      sector: " Technology ",
      sortField: "qualityScore",
      sortDir: "asc",
      filters: {
        roic: { min: "12", max: "" },
        marketCap: { min: 1e10, max: null },
        bogus: { min: 5 },
      },
    });
    expect(c.sector).toBe("Technology");
    expect(c.sortField).toBe("qualityScore");
    expect(c.sortDir).toBe("asc");
    expect(c.roic).toEqual({ min: 12, max: null });
    expect(c.marketCap).toEqual({ min: 1e10, max: null });
    // unknown keys are ignored
    expect((c as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("drops empty ranges", () => {
    const c = parseFundamentalCriteria({ filters: { roe: { min: "", max: "" } } });
    expect(c.roe).toBeUndefined();
  });
});
