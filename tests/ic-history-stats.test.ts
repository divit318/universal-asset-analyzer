import { describe, it, expect } from "vitest";
import { percentileRank, median, computeHistoryStats, type PricePoint } from "@/lib/ic/history-stats";

describe("percentileRank", () => {
  it("matches known distributions", () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileRank(sample, 5.5)).toBeCloseTo(50, 5);
    expect(percentileRank(sample, 1)).toBeCloseTo(5, 5); // midpoint of the tie at min
    expect(percentileRank(sample, 10)).toBeCloseTo(95, 5);
    expect(percentileRank(sample, 0)).toBe(0);
    expect(percentileRank(sample, 11)).toBe(100);
  });

  it("a value below the median can never rank above 50", () => {
    for (let trial = 0; trial < 50; trial++) {
      const sample = Array.from({ length: 101 }, () => Math.random() * 100);
      const med = median(sample);
      const value = med - 0.0001;
      expect(percentileRank(sample, value)).toBeLessThanOrEqual(50);
    }
  });

  it("handles ties by midpoint", () => {
    expect(percentileRank([1, 2, 2, 2, 3], 2)).toBeCloseTo((1 + 1.5) / 5 * 100, 5);
  });
});

describe("median", () => {
  it("interpolates even-sized samples", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([3, 1, 2])).toBe(2);
  });
});

/** Synthetic daily price series with a given final-year burst. */
function syntheticSeries(years: number, dailyDrift: number, lastYearDrift?: number): PricePoint[] {
  const days = Math.round(years * 252);
  const out: PricePoint[] = [];
  let price = 100;
  const start = new Date("2000-01-03").getTime();
  for (let i = 0; i < days; i++) {
    const drift = lastYearDrift != null && i >= days - 252 ? lastYearDrift : dailyDrift;
    price *= 1 + drift;
    const date = new Date(start + i * 1.4 * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, close: price });
  }
  return out;
}

describe("computeHistoryStats", () => {
  it("returns null for fewer than 21 points", () => {
    expect(computeHistoryStats(syntheticSeries(0.05, 0.001))).toBeNull();
  });

  it("verdict numbers all come from the same window (self-consistency)", () => {
    const stats = computeHistoryStats(syntheticSeries(12, 0.0004, 0.002));
    expect(stats).not.toBeNull();
    const v = stats!.verdict!;
    const w = stats!.windows.find((x) => x.years === v.windowYears)!;
    expect(w.cagr).toBe(v.cagr);
    expect(w.medianCagr).toBe(v.medianCagr);
    expect(w.percentile).toBe(v.percentile);
    // consistency: cagr above its own median implies percentile > 50 and vice versa
    if (v.cagr > v.medianCagr) expect(v.percentile).toBeGreaterThanOrEqual(50);
    if (v.cagr < v.medianCagr) expect(v.percentile).toBeLessThanOrEqual(50);
  });

  it("a hot final year ranks high in the 1Y window", () => {
    const stats = computeHistoryStats(syntheticSeries(10, 0.0002, 0.003));
    const w1 = stats!.windows.find((w) => w.years === 1)!;
    expect(w1.percentile).toBeGreaterThanOrEqual(80);
    expect(w1.signal).toBe("run_hot");
  });

  it("a cold final year ranks low in the 1Y window", () => {
    const stats = computeHistoryStats(syntheticSeries(10, 0.001, -0.001));
    const w1 = stats!.windows.find((w) => w.years === 1)!;
    expect(w1.percentile).toBeLessThanOrEqual(20);
    expect(w1.signal).toBe("run_cold");
  });

  it("short-history tickers get since-listing context, no fabricated percentile", () => {
    const stats = computeHistoryStats(syntheticSeries(0.5, 0.001));
    expect(stats).not.toBeNull();
    expect(stats!.verdict).toBeNull();
    expect(stats!.sinceListing).not.toBeNull();
    expect(stats!.windows.every((w) => w.percentile === null)).toBe(true);
  });

  it("a ~2.5y IPO gets a 1Y window but no 5Y+ windows", () => {
    const stats = computeHistoryStats(syntheticSeries(2.5, 0.0008));
    const w1 = stats!.windows.find((w) => w.years === 1)!;
    const w5 = stats!.windows.find((w) => w.years === 5)!;
    expect(w1.available).toBe(true);
    expect(w5.available).toBe(false);
  });

  it("ignores non-positive closes", () => {
    const series = syntheticSeries(3, 0.0005);
    series[10] = { ...series[10], close: 0 };
    expect(() => computeHistoryStats(series)).not.toThrow();
  });
});
