import { describe, it, expect } from "vitest";
import { computeOverlaps, overlapBetween, pearson } from "@/lib/thematic-overlap";
import type { ThematicReport } from "@/lib/thematic-engine";

/** Just enough of a report for the overlap math. */
function reportWith(opts: {
  theme: string;
  symbols: string[];
  proxies?: string[];
  series?: { date: string; close: number }[];
}): ThematicReport {
  return {
    theme: opts.theme,
    generatedAt: "2026-08-01T00:00:00.000Z",
    tierCompanies: opts.symbols.map((s) => ({ symbol: s })),
    supplyDemand: { commodityProxies: (opts.proxies ?? []).map((t) => ({ ticker: t })) },
    proxyPerformance: opts.series
      ? { proxies: [{ ticker: opts.proxies?.[0] ?? "X", name: "x", series: opts.series, maxDrawdown1Y: null }], benchmark: null }
      : null,
  } as unknown as ThematicReport;
}

const dates = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);

describe("pearson", () => {
  it("returns 1 for identical series, -1 for inverted, null when too short", () => {
    const a = [1, 2, 3, 1, 4, 2, 5, 3, 6, 4];
    expect(pearson(a, a)).toBe(1);
    expect(pearson(a, a.map((v) => -v))).toBe(-1);
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    expect(pearson(a, a.map(() => 2))).toBeNull(); // zero variance
  });
});

describe("overlapBetween", () => {
  it("computes shared symbols, Jaccard, and shared proxies", () => {
    const current = reportWith({ theme: "AI Compute", symbols: ["NVDA", "AMD", "VRT", "ETN"], proxies: ["SMH"] });
    const other = reportWith({ theme: "Robotics", symbols: ["NVDA", "ABB", "ETN"], proxies: ["SMH", "BOTZ"] });
    const o = overlapBetween(current, other);
    expect(o.sharedSymbols).toEqual(["ETN", "NVDA"]);
    expect(o.companiesA).toBe(4);
    expect(o.companiesB).toBe(3);
    expect(o.jaccard).toBeCloseTo(2 / 5); // |∩|=2, |∪|=5
    expect(o.sharedProxies).toEqual(["SMH"]);
  });

  it("correlates the lead proxy series over their shared dates", () => {
    const rising = dates.map((date, i) => ({ date, close: 100 + i }));
    const risingToo = dates.map((date, i) => ({ date, close: 50 + i * 2 }));
    const current = reportWith({ theme: "A", symbols: ["X"], proxies: ["AAA"], series: rising });
    const other = reportWith({ theme: "B", symbols: ["Y"], proxies: ["BBB"], series: risingToo });
    const o = overlapBetween(current, other);
    // Both strictly rising with deterministic (declining-rate) returns — strongly positive.
    expect(o.proxyCorrelation1Y).not.toBeNull();
    expect(o.proxyCorrelation1Y!).toBeGreaterThan(0.9);
  });
});

describe("computeOverlaps", () => {
  it("drops themes with nothing in common and sorts by shared names", () => {
    const current = reportWith({ theme: "AI Compute", symbols: ["NVDA", "AMD", "VRT"] });
    const strong = reportWith({ theme: "Robotics", symbols: ["NVDA", "AMD"] });
    const weak = reportWith({ theme: "Semis", symbols: ["NVDA"] });
    const none = reportWith({ theme: "Gold", symbols: ["GOLD", "NEM"] });
    const self = reportWith({ theme: "ai compute", symbols: ["NVDA"] });
    const out = computeOverlaps(current, [weak, none, strong, self]);
    expect(out.map((o) => o.theme)).toEqual(["Robotics", "Semis"]);
  });
});
