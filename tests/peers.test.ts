import { describe, expect, it } from "vitest";
import { extractPeer, median, medianOf } from "@/lib/peers";

describe("median", () => {
  it("handles odd and even counts and ignores null/NaN", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, null, undefined, NaN, 1])).toBe(3);
  });
  it("returns null for an empty/all-null list", () => {
    expect(median([null, undefined])).toBeNull();
  });
});

describe("extractPeer", () => {
  it("pulls metrics and normalizes debt/equity from a percentage", () => {
    expect(
      extractPeer({
        summaryDetail: { trailingPE: 30 },
        financialData: { returnOnEquity: 0.25, revenueGrowth: 0.1, debtToEquity: 80 },
      }),
    ).toEqual({ pe: 30, roe: 0.25, revenueGrowth: 0.1, debtToEquity: 0.8 });
  });

  it("yields nulls when fields are absent", () => {
    expect(extractPeer({})).toEqual({ pe: null, roe: null, revenueGrowth: null, debtToEquity: null });
  });
});

describe("medianOf", () => {
  it("computes a per-metric median across peers", () => {
    const m = medianOf([
      { pe: 10, roe: 0.1, revenueGrowth: 0.05, debtToEquity: 0.2 },
      { pe: 20, roe: 0.2, revenueGrowth: 0.15, debtToEquity: 0.4 },
      { pe: 30, roe: 0.3, revenueGrowth: 0.25, debtToEquity: 0.6 },
    ]);
    expect(m).toEqual({ pe: 20, roe: 0.2, revenueGrowth: 0.15, debtToEquity: 0.4 });
  });
});
