import { describe, expect, it } from "vitest";
import { mapFundamentals } from "@/lib/enrich";

// Four fiscal years, each compounding revenue and EPS at exactly 10%/yr.
const ts = [
  { totalRevenue: 100, dilutedEPS: 1.0, freeCashFlow: 20, dilutedAverageShares: 1100, operatingIncome: 180, investedCapital: 900, netDebt: 380, taxRateForCalcs: 0.2 },
  { totalRevenue: 110, dilutedEPS: 1.1, freeCashFlow: 25, dilutedAverageShares: 1050, operatingIncome: 190, investedCapital: 950, netDebt: 390, taxRateForCalcs: 0.2 },
  { totalRevenue: 120, dilutedEPS: 1.2, freeCashFlow: 28, dilutedAverageShares: 1000, operatingIncome: 195, investedCapital: 980, netDebt: 395, taxRateForCalcs: 0.2 },
  { totalRevenue: 133.1, dilutedEPS: 1.331, freeCashFlow: 30, dilutedAverageShares: 950, operatingIncome: 200, investedCapital: 1000, netDebt: 400, taxRateForCalcs: 0.2 },
];

const raw = {
  assetProfile: { sector: "Technology", industry: "Semiconductors" },
  summaryDetail: { dividendYield: 0.015, forwardPE: 19 },
  financialData: {
    ebitda: 200,
    grossMargins: 0.5,
    operatingMargins: 0.3,
    returnOnEquity: 0.25,
    revenueGrowth: 0.12,
    earningsGrowth: 0.18,
    freeCashflow: 30,
    debtToEquity: 80,
    currentRatio: 1.8,
  },
  defaultKeyStatistics: { enterpriseToEbitda: 12, forwardPE: 18 },
  majorHoldersBreakdown: { institutionsPercentHeld: 0.72 },
  earningsHistory: { history: [{ surprisePercent: 0.02 }, { surprisePercent: 0.05 }] },
};

describe("mapFundamentals", () => {
  const f = mapFundamentals("ABC", "ABC Corp", raw, ts);

  it("carries through identity + profile", () => {
    expect(f.symbol).toBe("ABC");
    expect(f.sector).toBe("Technology");
    expect(f.industry).toBe("Semiconductors");
  });

  it("computes ROIC from NOPAT / invested capital", () => {
    // 200 * (1 - 0.2) / 1000 = 16%
    expect(f.roic!).toBeCloseTo(16, 5);
  });

  it("computes 3-year CAGRs at ~10%", () => {
    expect(f.revenueCagr3y!).toBeCloseTo(10, 1);
    expect(f.epsCagr3y!).toBeCloseTo(10, 1);
  });

  it("derives FCF margin and net-debt/EBITDA", () => {
    expect(f.fcfMargin!).toBeCloseTo((30 / 133.1) * 100, 3);
    expect(f.netDebtToEbitda!).toBeCloseTo(2, 5); // 400 / 200
  });

  it("derives buyback yield from the fall in share count", () => {
    // (1000 - 950) / 1000 = 5%
    expect(f.buybackYield!).toBeCloseTo(5, 5);
  });

  it("normalizes percentages and ratios", () => {
    expect(f.roe!).toBeCloseTo(25, 5);
    expect(f.grossMargin!).toBeCloseTo(50, 5);
    expect(f.debtToEquity!).toBeCloseTo(0.8, 5); // 80 -> 0.8x
    expect(f.dividendYield!).toBeCloseTo(1.5, 5);
    expect(f.institutionalOwnership!).toBeCloseTo(72, 5);
    expect(f.earningsSurprisePct!).toBeCloseTo(5, 5); // uses the latest
    expect(f.evToEbitda).toBe(12);
  });
});
