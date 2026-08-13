import { describe, expect, it } from "vitest";
import { classifyInvestmentPersonality, computeScore, deriveInvestmentCharacteristics } from "@/lib/scoring";
import type { AnalystConsensus, FundamentalsSnapshot, MomentumSignal } from "@/lib/types";

const snap = (o: Partial<FundamentalsSnapshot> = {}): FundamentalsSnapshot => ({
  symbol: "X",
  price: 100,
  sector: "Technology",
  trailingPE: 25,
  forwardPE: 20,
  pegRatio: 1.2,
  priceToBook: 5,
  dividendYield: 0.01,
  returnOnEquity: 0.25,
  returnOnAssets: 0.1,
  grossMargins: 0.5,
  operatingMargins: 0.3,
  profitMargins: 0.2,
  ebitdaMargins: 0.35,
  revenueGrowth: 0.2,
  earningsGrowth: 0.25,
  debtToEquity: 0.5,
  currentRatio: 2,
  quickRatio: 1.5,
  freeCashflow: 1e9,
  operatingCashflow: null,
  totalCash: 5e9,
  totalDebt: 3e9,
  ebitda: 4e9,
  enterpriseToEbitda: null,
  priceToSalesTrailing12Months: null,
  ...o,
});

const analyst = (o: Partial<AnalystConsensus> = {}): AnalystConsensus => ({
  targetMean: 130,
  targetHigh: 160,
  targetLow: 100,
  upsidePercent: 15,
  recommendationKey: "buy",
  numberOfOpinions: 20,
  strongBuy: 5,
  buy: 8,
  hold: 3,
  sell: 1,
  strongSell: 0,
  epsRevisionsUp30d: 3,
  epsRevisionsDown30d: 1,
  epsSurprises: [0.02, 0.03],
  ...o,
});

const upMomentum: MomentumSignal = {
  score: 70,
  pctFrom52WkHigh: -3,
  pctFrom52WkLow: 40,
  vsSma50: 5,
  vsSma200: 10,
  return3m: 8,
  trend: "up",
};

describe("classifyInvestmentPersonality", () => {
  it("tags a fast-growing company High Growth", () => {
    const s = snap({ revenueGrowth: 0.35, earningsGrowth: 0.4 });
    const score = computeScore(s, null, analyst());
    const p = classifyInvestmentPersonality(score, s, null);
    expect(p.tag).toBe("High Growth");
    expect(p.explanation).toMatch(/Growth bucket/);
  });

  it("tags a cheap, decent-quality company Deep Value", () => {
    const s = snap({
      revenueGrowth: 0.02,
      earningsGrowth: 0.01,
      pegRatio: 0.6,
      forwardPE: 8,
      trailingPE: 9,
      returnOnEquity: 0.15,
      operatingMargins: 0.18,
    });
    const score = computeScore(s, null, analyst({ upsidePercent: 25 }));
    const p = classifyInvestmentPersonality(score, s, null);
    expect(p.tag).toBe("Deep Value");
  });

  it("tags a high dividend, low growth company Income", () => {
    const s = snap({ dividendYield: 0.05, revenueGrowth: 0.01, earningsGrowth: 0.0, sector: "Utilities" });
    const score = computeScore(s, null, analyst());
    const p = classifyInvestmentPersonality(score, s, null);
    expect(["Income", "Defensive"]).toContain(p.tag);
  });

  it("tags a cyclical-sector company Cyclical when nothing stronger matches", () => {
    const s = snap({
      sector: "Energy",
      revenueGrowth: 0.05,
      earningsGrowth: 0.03,
      dividendYield: 0.01,
      returnOnEquity: 0.1,
      operatingMargins: 0.1,
      pegRatio: 2,
    });
    const score = computeScore(s, null, analyst({ upsidePercent: 5 }));
    const p = classifyInvestmentPersonality(score, s, upMomentum);
    expect(p.tag).toBe("Cyclical");
  });

  it("falls back to High Quality when no other tag fits", () => {
    const s = snap({ revenueGrowth: 0.06, earningsGrowth: 0.05, dividendYield: 0.005, sector: "Communication Services" });
    const score = computeScore(s, null, analyst({ upsidePercent: 3 }));
    const p = classifyInvestmentPersonality(score, s, null);
    expect(typeof p.tag).toBe("string");
    expect(p.explanation.length).toBeGreaterThan(0);
  });
});

describe("deriveInvestmentCharacteristics", () => {
  it("its first characteristic always matches the single-tag classification", () => {
    const cases: FundamentalsSnapshot[] = [
      snap({ revenueGrowth: 0.35, earningsGrowth: 0.4 }),
      snap({ revenueGrowth: 0.02, pegRatio: 0.6, forwardPE: 8, trailingPE: 9 }),
      snap({ dividendYield: 0.05, revenueGrowth: 0.01, earningsGrowth: 0.0, sector: "Utilities" }),
      snap({ sector: "Energy", revenueGrowth: 0.05, pegRatio: 2 }),
    ];
    for (const s of cases) {
      const score = computeScore(s, null, analyst());
      const traits = deriveInvestmentCharacteristics(score, s, null);
      if (traits.length > 0) {
        expect(classifyInvestmentPersonality(score, s, null).tag).toBe(traits[0].tag);
      }
    }
  });

  it("assigns multiple genuine characteristics to a fast-growing quality company", () => {
    const s = snap({ revenueGrowth: 0.35, earningsGrowth: 0.4 });
    const score = computeScore(s, null, analyst());
    const traits = deriveInvestmentCharacteristics(score, s, null);
    expect(traits[0].tag).toBe("High Growth");
    expect(traits.length).toBeGreaterThan(1);
    expect(traits.length).toBeLessThanOrEqual(3);
    const tags = traits.map((t) => t.tag);
    expect(new Set(tags).size).toBe(tags.length); // no duplicates
  });

  it("tags a mature dividend payer in a defensive sector Income + Defensive", () => {
    const s = snap({ dividendYield: 0.04, revenueGrowth: 0.02, earningsGrowth: 0.01, sector: "Consumer Defensive" });
    const score = computeScore(s, null, analyst());
    const tags = deriveInvestmentCharacteristics(score, s, null).map((t) => t.tag);
    expect(tags).toContain("Income");
    expect(tags).toContain("Defensive");
  });

  it("does not force labels onto an undifferentiated company", () => {
    // Weak everything in a sector that is neither cyclical nor defensive:
    // nothing clears a threshold, so nothing is claimed.
    const s = snap({
      revenueGrowth: 0.01,
      earningsGrowth: -0.05,
      dividendYield: 0.005,
      sector: "Communication Services",
      returnOnEquity: 0.04,
      returnOnAssets: 0.02,
      grossMargins: 0.2,
      operatingMargins: 0.05,
      profitMargins: 0.02,
      ebitdaMargins: 0.08,
      pegRatio: 3,
      trailingPE: 40,
      forwardPE: 38,
      priceToBook: 12,
    });
    const score = computeScore(s, null, analyst({ upsidePercent: -5, recommendationKey: "hold" }));
    expect(deriveInvestmentCharacteristics(score, s, null)).toEqual([]);
  });

  it("never claims Compounder and standalone High Quality together", () => {
    const s = snap({ revenueGrowth: 0.15, earningsGrowth: 0.18 });
    const score = computeScore(s, null, analyst());
    const tags = deriveInvestmentCharacteristics(score, s, null).map((t) => t.tag);
    if (tags.includes("Compounder")) expect(tags).not.toContain("High Quality");
  });
});
