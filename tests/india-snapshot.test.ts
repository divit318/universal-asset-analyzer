import { describe, it, expect } from "vitest";
import { computeIndiaSnapshot, overallVerdict } from "@/lib/india-snapshot";
import type { ScreenerInCompany } from "@/lib/screener-in";

/** Minimal ScreenerInCompany with sensible empty defaults; override per test. */
function company(overrides: Partial<ScreenerInCompany> = {}): ScreenerInCompany {
  return {
    name: "Test Ltd",
    symbol: "TEST",
    bseCode: null,
    sector: null,
    industry: null,
    marketCap: 10000,
    currentPrice: 100,
    high52w: 120,
    low52w: 80,
    pe: null,
    bookValue: null,
    dividendYield: null,
    roce: null,
    roe: null,
    debt: null,
    changePercent: null,
    promoterHolding: null,
    ratios: [],
    peers: [],
    shareholding: [],
    shareholdingPeriods: [],
    annualPL: [],
    quarterlyPL: [],
    ...overrides,
  };
}

const NO_DERIVED = {
  debtToEquity: null,
  interestCoverage: null,
  evToEbitda: null,
  priceToBook: null,
};

describe("computeIndiaSnapshot", () => {
  it("scores a high-quality, cheap compounder highly", () => {
    const snap = computeIndiaSnapshot(
      company({ roce: 28, roe: 24, pe: 14, dividendYield: 2 }),
      { debtToEquity: 0.2, interestCoverage: 12, evToEbitda: 7, priceToBook: 3 },
    );
    expect(snap.quality).toBeGreaterThanOrEqual(80);
    expect(snap.valuation).toBeGreaterThanOrEqual(60);
    expect(snap.composite).toBeGreaterThan(65);
    expect(["Strong Buy", "Accumulate"]).toContain(snap.verdict.label);
  });

  it("scores a weak, expensive, levered name poorly", () => {
    const snap = computeIndiaSnapshot(
      company({ roce: 6, roe: 7, pe: 60 }),
      { debtToEquity: 2.5, interestCoverage: 1, evToEbitda: 25, priceToBook: 9 },
    );
    expect(snap.quality).toBeLessThan(45);
    expect(snap.composite).toBeLessThan(46);
    expect(["Reduce", "Avoid"]).toContain(snap.verdict.label);
  });

  it("composite exactly matches the documented 35/25/25/15 weighting", () => {
    const snap = computeIndiaSnapshot(company({ roce: 15, roe: 15, pe: 20 }), NO_DERIVED);
    const expected = Math.round(
      snap.quality * 0.35 + snap.valuation * 0.25 + snap.growth * 0.25 + snap.capitalAllocation * 0.15,
    );
    expect(snap.composite).toBe(expected);
  });

  it("verdict thresholds map composite → label consistently", () => {
    expect(overallVerdict(80).label).toBe("Strong Buy");
    expect(overallVerdict(65).label).toBe("Accumulate");
    expect(overallVerdict(52).label).toBe("Hold");
    expect(overallVerdict(35).label).toBe("Reduce");
    expect(overallVerdict(10).label).toBe("Avoid");
  });

  it("exposes a Recommendation aligned with the verdict (for the Macro ladder)", () => {
    const strong = computeIndiaSnapshot(
      company({ roce: 28, roe: 24, pe: 14, dividendYield: 2 }),
      { debtToEquity: 0.2, interestCoverage: 12, evToEbitda: 7, priceToBook: 3 },
    );
    expect(["STRONG_BUY", "BUY"]).toContain(strong.recommendation);

    const weak = computeIndiaSnapshot(
      company({ roce: 6, roe: 7, pe: 60 }),
      { debtToEquity: 2.5, interestCoverage: 1, evToEbitda: 25, priceToBook: 9 },
    );
    expect(["SELL", "STRONG_SELL"]).toContain(weak.recommendation);
  });

  it("all sub-scores and composite stay within 0–100", () => {
    const snap = computeIndiaSnapshot(company({ roce: 40, roe: 40, pe: 1, dividendYield: 9 }), {
      debtToEquity: 0,
      interestCoverage: 100,
      evToEbitda: 1,
      priceToBook: 0.5,
    });
    for (const v of [snap.quality, snap.valuation, snap.growth, snap.capitalAllocation, snap.composite]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});
