import { describe, expect, it } from "vitest";
import {
  computeScores,
  financialHealthScore,
  qualityScore,
  valueScore,
} from "@/lib/composite";
import type { ScorableMetrics } from "@/lib/composite";

/** All-null scorable metrics; override only what a test cares about. */
const m = (o: Partial<ScorableMetrics> = {}): ScorableMetrics => ({
  symbol: "X",
  name: "X",
  sector: null,
  industry: null,
  price: null,
  marketCap: null,
  forwardPE: null,
  evToEbitda: null,
  fcfYield: null,
  revenueGrowthYoY: null,
  revenueCagr3y: null,
  epsGrowthYoY: null,
  epsCagr3y: null,
  roic: null,
  roe: null,
  grossMargin: null,
  operatingMargin: null,
  debtToEquity: null,
  netDebtToEbitda: null,
  netDebt: null,
  currentRatio: null,
  fcfMargin: null,
  fcfGrowthYoY: null,
  dividendYield: null,
  buybackYield: null,
  oneYearReturn: null,
  distanceFrom52WkHigh: null,
  institutionalOwnership: null,
  earningsSurprisePct: null,
  ...o,
});

describe("valueScore", () => {
  it("rewards cheap multiples and rich FCF yield", () => {
    const cheap = valueScore(m({ forwardPE: 8, evToEbitda: 5, fcfYield: 8 }))!;
    const pricey = valueScore(m({ forwardPE: 45, evToEbitda: 25, fcfYield: 0 }))!;
    expect(cheap).toBeGreaterThan(90);
    expect(pricey).toBeLessThan(10);
  });
});

describe("qualityScore", () => {
  it("scores high-ROIC, high-margin businesses near the top", () => {
    const great = qualityScore(
      m({ roic: 30, roe: 35, grossMargin: 70, operatingMargin: 35, fcfMargin: 30 }),
    )!;
    expect(great).toBeGreaterThanOrEqual(95);
  });
});

describe("financialHealthScore", () => {
  it("treats net cash + low leverage as healthiest", () => {
    const fortress = financialHealthScore(
      m({ debtToEquity: 0.05, netDebtToEbitda: -1, currentRatio: 3 }),
    )!;
    const fragile = financialHealthScore(
      m({ debtToEquity: 2.5, netDebtToEbitda: 5, currentRatio: 0.7 }),
    )!;
    expect(fortress).toBeGreaterThan(90);
    expect(fragile).toBeLessThan(10);
  });
});

describe("computeScores", () => {
  it("returns null dimensions when data is absent but still scores others", () => {
    const s = computeScores(m({ roic: 25, roe: 30, grossMargin: 60, operatingMargin: 28, fcfMargin: 22 }));
    expect(s.quality).not.toBeNull();
    expect(s.value).toBeNull();
    expect(s.growth).toBeNull();
    // Overall renormalizes over available dimensions, so it's still defined.
    expect(s.overall).not.toBeNull();
  });

  it("gives an all-null company a null overall", () => {
    expect(computeScores(m()).overall).toBeNull();
  });

  it("ranks a great business above a poor one overall", () => {
    const good = computeScores(
      m({
        forwardPE: 14,
        evToEbitda: 10,
        fcfYield: 6,
        revenueGrowthYoY: 18,
        epsGrowthYoY: 22,
        roic: 25,
        roe: 30,
        grossMargin: 60,
        operatingMargin: 28,
        debtToEquity: 0.3,
        netDebtToEbitda: 0.5,
        currentRatio: 2,
      }),
    );
    const poor = computeScores(
      m({
        forwardPE: 60,
        evToEbitda: 30,
        fcfYield: -2,
        revenueGrowthYoY: -8,
        epsGrowthYoY: -15,
        roic: 2,
        roe: 1,
        grossMargin: 18,
        operatingMargin: 2,
        debtToEquity: 3,
        netDebtToEbitda: 6,
        currentRatio: 0.6,
      }),
    );
    expect(good.overall!).toBeGreaterThan(poor.overall! + 30);
  });
});
