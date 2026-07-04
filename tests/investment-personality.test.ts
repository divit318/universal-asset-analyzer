import { describe, expect, it } from "vitest";
import { classifyInvestmentPersonality, computeScore } from "@/lib/scoring";
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
