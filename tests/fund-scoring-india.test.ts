/**
 * India-category-aware fund scoring (lib/fund-scoring-india.ts, ADR-002).
 *
 * Golden values are closed-form: series are constructed as exact exponentials
 * (daily compounding of a known annual rate), so rolling CAGRs, tracking
 * differences and drawdowns have hand-computable expectations.
 */
import { describe, expect, it } from "vitest";
import {
  rollingCagrs,
  medianOf,
  maxDrawdown,
  cagrDifferencePp,
  downsideCapture,
  indiaCategoryBenchmark,
  indiaFundBuckets,
} from "@/lib/fund-scoring-india";
import { computeFundScore } from "@/lib/fund-scoring";
import type { FundProfileData, HistoryPoint } from "@/lib/types";

/** Daily series compounding at `annualPct` for `days` calendar days. */
function expSeries(annualPct: number, days: number, start = 100): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  const daily = Math.pow(1 + annualPct / 100, 1 / 365.25);
  const d0 = new Date("2021-01-01").getTime();
  for (let i = 0; i < days; i++) {
    out.push({
      date: new Date(d0 + i * 86400000).toISOString().slice(0, 10),
      close: start * Math.pow(daily, i),
    });
  }
  return out;
}

const fundBase = (over: Partial<FundProfileData>): FundProfileData =>
  ({
    family: "Test AMC",
    category: null,
    legalType: null,
    expenseRatio: 0.012,
    expenseRatioSource: "amfi",
    turnoverPercent: 0.3,
    totalNetAssets: 5e10,
    currency: "INR",
    morningstarRating: null,
    inceptionDate: "2015-01-01",
    holdings: [
      { name: "A", symbol: "A", weightPercent: 8 },
      { name: "B", symbol: "B", weightPercent: 7 },
      { name: "C", symbol: "C", weightPercent: 6 },
    ] as FundProfileData["holdings"],
    sectorWeights: [{ sector: "Financial Services", weightPercent: 30 }],
    assetAllocation: { stock: 95, bond: 0, cash: 5, other: 0 },
    trailingReturns: { ytd: 5, oneYear: 12, threeYear: 14, fiveYear: 15 },
    categoryRelativeReturns: { oneYear: null, threeYear: null },
    risk: { beta: 0.9, alpha: 2, stdDev: 15, sharpeRatio: 0.8 },
    amfiCategory: { group: "equity", category: "Flexi Cap" },
    amfiPlan: "direct",
    amfiSchemeName: "Test Flexi Cap Fund",
    ...over,
  }) as FundProfileData;

describe("series math", () => {
  it("rolling 3y CAGRs of an exact 12%/yr series are all ~12%", () => {
    const cagrs = rollingCagrs(expSeries(12, 1500), 3);
    expect(cagrs.length).toBeGreaterThan(3);
    for (const c of cagrs) expect(c).toBeCloseTo(12, 6);
    expect(medianOf(cagrs)).toBeCloseTo(12, 6);
  });

  it("returns no rolling windows when history is shorter than the window", () => {
    expect(rollingCagrs(expSeries(12, 400), 3)).toEqual([]);
  });

  it("max drawdown finds a constructed -30% peak-to-trough", () => {
    const h = expSeries(10, 400);
    // Inject a crash: 30% below the running peak at bar 200.
    const peak = Math.max(...h.slice(0, 200).map((p) => p.close));
    h[200] = { ...h[200], close: peak * 0.7 };
    expect(maxDrawdown(h)!).toBeCloseTo(-0.3, 10);
  });

  it("tracking/CAGR difference of 10% fund vs 12% benchmark is ~-2pp", () => {
    const diff = cagrDifferencePp(expSeries(10, 1200), expSeries(12, 1200), 3);
    expect(diff).not.toBeNull();
    expect(diff!).toBeCloseTo(-2, 1);
  });

  it("downside capture of a half-beta fund is ~0.5", () => {
    // Benchmark alternates -1%/+1%; fund moves exactly half as much.
    const d0 = new Date("2023-01-01").getTime();
    const bench: HistoryPoint[] = [];
    const fund: HistoryPoint[] = [];
    let b = 100;
    let f = 100;
    for (let i = 0; i < 300; i++) {
      const r = i % 2 ? -0.01 : 0.01;
      b *= 1 + r;
      f *= 1 + r / 2;
      const date = new Date(d0 + i * 86400000).toISOString().slice(0, 10);
      bench.push({ date, close: b });
      fund.push({ date, close: f });
    }
    expect(downsideCapture(fund, bench)!).toBeCloseTo(0.5, 2);
  });
});

describe("indiaCategoryBenchmark", () => {
  it("maps SEBI equity categories to their tier-1 index (PRI-labelled)", () => {
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Large Cap" } }))!.symbol).toBe("^NSEI");
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Mid Cap" } }))!.symbol).toBe("NIFTYMIDCAP150.NS");
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Small Cap" } }))!.symbol).toBe("NIFTYSMLCAP250.NS");
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Flexi Cap" } }))!.symbol).toBe("^CRSLDX");
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Flexi Cap" } }))!.label).toContain("(PRI)");
  });

  it("refuses a benchmark where none is defensible", () => {
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "equity", category: "Sectoral/Thematic" } }))).toBeNull();
    expect(indiaCategoryBenchmark(fundBase({ amfiCategory: { group: "debt", category: "Liquid" } }))).toBeNull();
  });

  it("detects an index fund's own underlying index from the AMFI scheme name", () => {
    const f = fundBase({
      amfiCategory: { group: "other", category: "Index Fund" },
      amfiSchemeName: "Test Nifty 500 Index Fund",
    });
    expect(indiaCategoryBenchmark(f)!.symbol).toBe("^CRSLDX");
    const unknown = fundBase({
      amfiCategory: { group: "other", category: "Index Fund" },
      amfiSchemeName: "Test Quality 30 Index Fund",
    });
    expect(indiaCategoryBenchmark(unknown)).toBeNull();
  });
});

describe("indiaFundBuckets / computeFundScore India path", () => {
  const history = expSeries(14, 1825);

  it("activates only for INR funds with a resolved AMFI category", () => {
    expect(indiaFundBuckets(fundBase({ currency: "USD" }), history)).toBeNull();
    expect(indiaFundBuckets(fundBase({ amfiCategory: null }), history)).toBeNull();
    expect(indiaFundBuckets(fundBase({}), history)).not.toBeNull();
  });

  it("judges an Indian flexi-cap by rolling returns and category-sized risk", () => {
    const score = computeFundScore(fundBase({}), history);
    const labels = score.buckets.map((b) => b.name);
    expect(labels).toContain("Performance (rolling)");
    expect(labels).toContain("Risk (category-sized)");
    const rolling = score.buckets.flatMap((b) => b.factors).find((f) => f.label === "Median rolling 3y return");
    expect(rolling?.detail).toContain("Rolling 3y median: +14.0%");
    expect(score.rationale).toContain("Flexi Cap, direct plan");
  });

  it("scores passive funds on tracking difference, skipping diversification judgment", () => {
    const passive = fundBase({
      amfiCategory: { group: "other", category: "ETF" },
      amfiSchemeName: "Test Nifty 50 ETF",
      expenseRatio: 0.0005,
    });
    const bench = expSeries(14.5, 1825); // fund lags its index by ~0.5pp
    const score = computeFundScore(passive, history, undefined, bench);
    const labels = score.buckets.map((b) => b.name);
    expect(labels).toContain("Tracking");
    expect(labels).not.toContain("Diversification");
    const td = score.buckets.flatMap((b) => b.factors).find((f) => f.label === "1y tracking difference");
    expect(td?.detail).toContain("vs NIFTY 50 (PRI)");
  });

  it("does not penalize a sectoral fund's mandated concentration like a diversified fund", () => {
    const concentrated = {
      holdings: Array.from({ length: 10 }, (_, i) => ({
        name: `H${i}`,
        symbol: `H${i}`,
        weightPercent: 8,
      })) as FundProfileData["holdings"],
      sectorWeights: [{ sector: "Technology", weightPercent: 95 }],
    };
    const sectoral = computeFundScore(
      fundBase({ ...concentrated, amfiCategory: { group: "equity", category: "Sectoral/Thematic" } }),
      history,
    );
    const diversifiedMandate = computeFundScore(fundBase({ ...concentrated }), history);
    const structureScore = (s: typeof sectoral) => {
      const b = s.buckets.find((x) => /structure|diversification/i.test(x.name))!;
      return b.points / b.max;
    };
    // 80% top-10 concentration: fatal for a flexi-cap, unremarkable for a
    // sectoral mandate.
    expect(structureScore(sectoral)).toBeGreaterThan(structureScore(diversifiedMandate));
  });

  it("prices TER against the plan-aware Indian fee regime", () => {
    // 1.2% TER: mid-band for a regular plan, poor for a direct plan.
    const direct = computeFundScore(fundBase({ amfiPlan: "direct" }), history);
    const regular = computeFundScore(fundBase({ amfiPlan: "regular" }), history);
    const ter = (s: typeof direct) =>
      s.buckets.flatMap((b) => b.factors).find((f) => f.label === "Expense ratio (TER)")!;
    expect(ter(direct).points).toBeLessThan(ter(regular).points);
    expect(ter(direct).detail).toContain("direct plan");
  });

  it("leaves non-Indian funds on the generic path unchanged", () => {
    const us = fundBase({ currency: "USD", amfiCategory: null, amfiPlan: null });
    const score = computeFundScore(us, history);
    expect(score.buckets.map((b) => b.name)).toContain("Cost");
    expect(score.buckets.map((b) => b.name)).not.toContain("Risk (category-sized)");
  });
});
