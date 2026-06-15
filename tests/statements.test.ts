import { describe, expect, it } from "vitest";
import {
  cagr,
  deriveStatements,
  extractAnnual,
  pickBestSeries,
} from "@/lib/statements";

describe("extractAnnual", () => {
  it("keeps FY 10-K annual periods and drops quarterly/short periods", () => {
    const series = extractAnnual({
      units: {
        USD: [
          { form: "10-K", fp: "FY", fy: 2023, start: "2022-10-01", end: "2023-09-30", val: 100 },
          { form: "10-K", fp: "FY", fy: 2024, start: "2023-10-01", end: "2024-09-28", val: 120 },
          { form: "10-Q", fp: "Q1", fy: 2024, start: "2024-01-01", end: "2024-03-31", val: 30 },
          { form: "10-K", fp: "FY", fy: 2024, start: "2024-09-01", end: "2024-09-28", val: 5 },
        ],
      },
    });
    expect(series).toEqual([
      { fy: 2023, value: 100 },
      { fy: 2024, value: 120 },
    ]);
  });
});

describe("pickBestSeries", () => {
  it("chooses the series reaching the latest fiscal year", () => {
    const stale = [
      { fy: 2019, value: 1 },
      { fy: 2020, value: 2 },
    ];
    const fresh = [
      { fy: 2023, value: 5 },
      { fy: 2024, value: 6 },
    ];
    expect(pickBestSeries([stale, fresh])).toBe(fresh);
  });

  it("returns [] when all candidates are empty", () => {
    expect(pickBestSeries([[], []])).toEqual([]);
  });
});

describe("cagr", () => {
  it("computes compound annual growth rate", () => {
    expect(cagr([{ fy: 2020, value: 100 }, { fy: 2024, value: 200 }])).toBeCloseTo(0.1892, 3);
  });
  it("returns null when the base is non-positive or single point", () => {
    expect(cagr([{ fy: 2020, value: 0 }, { fy: 2024, value: 200 }])).toBeNull();
    expect(cagr([{ fy: 2024, value: 1 }])).toBeNull();
  });
});

describe("deriveStatements", () => {
  const result = deriveStatements("X", {
    revenue: [{ fy: 2023, value: 100 }, { fy: 2024, value: 200 }],
    grossProfit: [{ fy: 2023, value: 40 }, { fy: 2024, value: 100 }],
    operatingIncome: [{ fy: 2023, value: 20 }, { fy: 2024, value: 50 }],
    netIncome: [{ fy: 2023, value: 10 }, { fy: 2024, value: 40 }],
    opCashFlow: [{ fy: 2023, value: 30 }, { fy: 2024, value: 60 }],
    capex: [{ fy: 2023, value: 5 }, { fy: 2024, value: 10 }],
  });

  it("derives margins per fiscal year", () => {
    expect(result.grossMargin).toEqual([{ fy: 2023, value: 0.4 }, { fy: 2024, value: 0.5 }]);
    expect(result.operatingMargin.at(-1)!.value).toBeCloseTo(0.25);
    expect(result.netMargin.at(-1)!.value).toBeCloseTo(0.2);
  });

  it("computes free cash flow as operating CF minus capex", () => {
    expect(result.freeCashFlow).toEqual([{ fy: 2023, value: 25 }, { fy: 2024, value: 50 }]);
  });

  it("computes revenue and FCF CAGR", () => {
    expect(result.revenueCagr).toBeCloseTo(1.0);
    expect(result.fcfCagr).toBeCloseTo(1.0);
    expect(result.fiscalYears).toEqual([2023, 2024]);
  });
});
