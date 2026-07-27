import { describe, expect, it } from "vitest";
import { drawdown } from "@/lib/screener/metrics-util";
import type { HistoryPoint } from "@/lib/types";

function historyFromCloses(closes: number[]): HistoryPoint[] {
  return closes.map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    close,
    adjClose: close,
  })) as HistoryPoint[];
}

describe("drawdown", () => {
  it("reports a realistic percentage, not a 100x-scaled one", () => {
    // 100 -> 90 is a 10% peak-to-trough decline. Padded with flat days so the
    // 20-session minimum is met.
    const closes = [...Array(15).fill(100), 95, 92, 90, 91, 93, 96, 100];
    const dd = drawdown(historyFromCloses(closes));
    expect(dd).not.toBeNull();
    expect(dd!).toBeLessThan(0);
    expect(dd!).toBeGreaterThan(-15); // was -1000 before the fix, not -10
    expect(dd!).toBeCloseTo(-10, 0);
  });

  it("returns null with insufficient history", () => {
    expect(drawdown(historyFromCloses([100, 99, 98]))).toBeNull();
  });
});
