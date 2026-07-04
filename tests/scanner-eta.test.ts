import { describe, it, expect } from "vitest";
import { averageHistoricalDuration, estimateRemainingMs } from "@/lib/scanner-eta";

describe("averageHistoricalDuration", () => {
  it("returns null for empty history", () => {
    expect(averageHistoricalDuration([])).toBeNull();
  });

  it("averages past durations", () => {
    expect(averageHistoricalDuration([10_000, 20_000, 30_000])).toBe(20_000);
  });
});

describe("estimateRemainingMs", () => {
  it("falls back to historical average when pct is 0", () => {
    const remaining = estimateRemainingMs({ elapsedMs: 0, pct: 0, historicalAvgMs: 60_000 });
    expect(remaining).toBe(60_000);
  });

  it("uses a bootstrap default when no history and pct is 0", () => {
    const remaining = estimateRemainingMs({ elapsedMs: 0, pct: 0, historicalAvgMs: null });
    expect(remaining).toBeGreaterThan(0);
  });

  it("uses pure live extrapolation when no historical data exists", () => {
    // 25% done in 10s → total ~40s → remaining ~30s
    const remaining = estimateRemainingMs({ elapsedMs: 10_000, pct: 25, historicalAvgMs: null });
    expect(remaining).toBe(30_000);
  });

  it("blends live extrapolation with historical average as pct rises", () => {
    // At pct=50, live estimate (40s total) and historical (60s total) blend evenly → 50s total → 30s remaining
    const remaining = estimateRemainingMs({ elapsedMs: 20_000, pct: 50, historicalAvgMs: 60_000 });
    expect(remaining).toBe(30_000);
  });

  it("converges toward live extrapolation as pct approaches 100", () => {
    const remaining = estimateRemainingMs({ elapsedMs: 90_000, pct: 95, historicalAvgMs: 60_000 });
    // live estimate total ~94.7s, historical 60s, weighted heavily toward live
    expect(remaining).toBeLessThan(10_000);
  });

  it("never returns negative remaining time", () => {
    const remaining = estimateRemainingMs({ elapsedMs: 100_000, pct: 100, historicalAvgMs: 50_000 });
    expect(remaining).toBe(0);
  });
});
