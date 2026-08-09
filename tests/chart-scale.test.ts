import { describe, expect, it } from "vitest";
import { niceTicks, niceDomain } from "@/lib/chart-scale";

describe("niceTicks", () => {
  it("produces round intervals covering the range", () => {
    // The SYF price axis case: raw padding produced $61.9/$67.9/$73.9/$79.9.
    const ticks = niceTicks(61.9, 82.9, 6);
    expect(ticks[0]).toBeLessThanOrEqual(61.9);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(82.9);
    const step = ticks[1] - ticks[0];
    // Every gap equal, and the step on the 1/2/2.5/5 ladder.
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBeCloseTo(step, 8);
    }
    const mag = Math.pow(10, Math.floor(Math.log10(step)));
    expect([1, 2, 2.5, 5]).toContain(Number((step / mag).toPrecision(6)));
    // Ticks land on multiples of the step (round labels like $60, $65, $70…).
    for (const t of ticks) {
      expect(Math.abs(t / step - Math.round(t / step))).toBeLessThan(1e-6);
    }
  });

  it("handles small percentage ranges (margin chart)", () => {
    const ticks = niceTicks(18, 26, 5);
    expect(ticks[0]).toBeLessThanOrEqual(18);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(26);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(9);
  });

  it("survives a degenerate flat series", () => {
    const ticks = niceTicks(22, 22, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]).toBeLessThanOrEqual(22);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(22);
  });

  it("returns [] for non-finite input", () => {
    expect(niceTicks(Number.NaN, 10)).toEqual([]);
    expect(niceTicks(0, Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("niceDomain", () => {
  it("matches the first/last tick", () => {
    const ticks = niceTicks(61.9, 82.9, 6);
    expect(niceDomain(61.9, 82.9, 6)).toEqual([ticks[0], ticks[ticks.length - 1]]);
  });
});
