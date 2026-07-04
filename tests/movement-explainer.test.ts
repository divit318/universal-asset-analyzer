import { describe, expect, it } from "vitest";
import { windowReturn, volumeAnomaly } from "@/lib/movement-explainer";
import type { HistoryPoint } from "@/lib/types";

function history(closes: number[], volumes?: number[]): HistoryPoint[] {
  const now = new Date();
  return closes.map((close, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (closes.length - 1 - i));
    return { date: d.toISOString().slice(0, 10), close, volume: volumes?.[i] };
  });
}

describe("windowReturn", () => {
  it("returns null with fewer than 2 points", () => {
    expect(windowReturn(history([100]), 5)).toBeNull();
    expect(windowReturn([], 5)).toBeNull();
  });

  it("computes percent return over the window", () => {
    const h = history([100, 105, 110]);
    const r = windowReturn(h, 5);
    expect(r).not.toBeNull();
    expect(r).toBeCloseTo(10, 0); // 100 -> 110 = +10%
  });

  it("guards against a zero-price start point", () => {
    const h: HistoryPoint[] = [
      { date: "2026-06-01", close: 0 },
      { date: "2026-07-01", close: 50 },
    ];
    expect(windowReturn(h, 30)).toBeNull();
  });
});

describe("volumeAnomaly", () => {
  it("returns null without enough history", () => {
    expect(volumeAnomaly(history([100, 101, 102]))).toBeNull();
  });

  it("detects elevated recent volume vs. baseline", () => {
    const closes = Array.from({ length: 26 }, (_, i) => 100 + i);
    const volumes = Array.from({ length: 26 }, (_, i) => (i >= 23 ? 500_000 : 100_000));
    const h = history(closes, volumes);
    const anomaly = volumeAnomaly(h);
    expect(anomaly).not.toBeNull();
    expect(anomaly!).toBeGreaterThan(0);
  });

  it("returns null when volume data is missing", () => {
    const closes = Array.from({ length: 26 }, (_, i) => 100 + i);
    const h = history(closes); // no volumes
    expect(volumeAnomaly(h)).toBeNull();
  });
});
