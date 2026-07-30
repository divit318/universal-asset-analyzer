import { describe, expect, it } from "vitest";
import {
  daysSince,
  distanceToTargetPercent,
  formatAge,
  isTargetReached,
  isUsablePrice,
  percentFrom52WeekHigh,
  rangePosition52Week,
  resolveTargetDirection,
  suggestTargetDirection,
  upsidePercent,
} from "@/lib/watchlist-metrics";

/**
 * The watchlist's arithmetic.
 *
 * Every case below corresponds to something the page previously got wrong or
 * could not represent: the sign and denominator of upside, a stored target of 0
 * dividing to Infinity, a target reached in the wrong direction firing forever,
 * an unparseable timestamp rendering "NaNd ago", and a 52-week high the live
 * print has just exceeded reporting a positive drawdown.
 */

describe("isUsablePrice", () => {
  it("accepts only finite positives", () => {
    expect(isUsablePrice(1)).toBe(true);
    expect(isUsablePrice(0.0001)).toBe(true);
    for (const bad of [0, -1, NaN, Infinity, -Infinity, null, undefined]) {
      expect(isUsablePrice(bad)).toBe(false);
    }
  });
});

describe("upsidePercent", () => {
  it("is (target - price) / price, the same formula as every other UAA surface", () => {
    // 100 → 120 is +20% upside, NOT the +16.67% that (target-price)/target gives
    // and NOT the -16.67% the old watchlist column reported.
    expect(upsidePercent(100, 120)).toBeCloseTo(20, 10);
    expect(upsidePercent(169.02, 200)).toBeCloseTo(18.329, 3);
  });

  it("is negative when the target sits below the market", () => {
    expect(upsidePercent(120, 100)).toBeCloseTo(-16.6667, 4);
  });

  it("is exactly zero when price equals target", () => {
    expect(upsidePercent(150, 150)).toBe(0);
  });

  it("returns null rather than Infinity for a zero or negative leg", () => {
    // The old column divided by the target, so a stored 0 produced "+Infinity%".
    expect(upsidePercent(100, 0)).toBeNull();
    expect(upsidePercent(0, 100)).toBeNull();
    expect(upsidePercent(-10, 100)).toBeNull();
    expect(upsidePercent(100, -10)).toBeNull();
  });

  it("returns null for missing or non-finite input", () => {
    expect(upsidePercent(null, 100)).toBeNull();
    expect(upsidePercent(100, null)).toBeNull();
    expect(upsidePercent(undefined, undefined)).toBeNull();
    expect(upsidePercent(NaN, 100)).toBeNull();
    expect(upsidePercent(100, Infinity)).toBeNull();
  });

  it("stays finite and correctly signed at extreme magnitudes", () => {
    expect(upsidePercent(0.01, 1000)).toBeCloseTo(9_999_900, 0);
    expect(upsidePercent(1000, 0.01)).toBeCloseTo(-99.999, 3);
  });

  it("null is distinguishable from 0 so a missing target sinks instead of ranking flat", () => {
    const values = [upsidePercent(100, 120), upsidePercent(100, null), upsidePercent(100, 100)];
    expect(values).toEqual([20, null, 0]);
  });
});

describe("resolveTargetDirection", () => {
  it("honours an explicitly recorded direction regardless of the price", () => {
    expect(resolveTargetDirection("above", 100, 500)).toBe("above");
    expect(resolveTargetDirection("below", 500, 100)).toBe("below");
  });

  it("infers the direction the price would have to travel for a legacy row", () => {
    expect(resolveTargetDirection(null, 200, 150)).toBe("above");
    expect(resolveTargetDirection(null, 150, 200)).toBe("below");
  });

  it("treats a target equal to the price as an 'above' target", () => {
    expect(resolveTargetDirection(null, 100, 100)).toBe("above");
  });

  it("falls back to 'above' when there is nothing to infer from", () => {
    expect(resolveTargetDirection(null, null, null)).toBe("above");
    expect(resolveTargetDirection(undefined, 0, 0)).toBe("above");
  });
});

describe("suggestTargetDirection", () => {
  it("pre-selects an exit level above the market and a buy limit below it", () => {
    expect(suggestTargetDirection(220, 200)).toBe("above");
    expect(suggestTargetDirection(180, 200)).toBe("below");
  });
});

describe("isTargetReached", () => {
  it("respects the direction rather than assuming one", () => {
    expect(isTargetReached(205, 200, "above")).toBe(true);
    expect(isTargetReached(195, 200, "above")).toBe(false);
    expect(isTargetReached(195, 200, "below")).toBe(true);
    expect(isTargetReached(205, 200, "below")).toBe(false);
  });

  it("is inclusive at the target in both directions", () => {
    expect(isTargetReached(200, 200, "above")).toBe(true);
    expect(isTargetReached(200, 200, "below")).toBe(true);
  });

  it("is false whenever either leg is unusable", () => {
    expect(isTargetReached(null, 200, "above")).toBe(false);
    expect(isTargetReached(200, null, "above")).toBe(false);
    expect(isTargetReached(200, 0, "below")).toBe(false);
    expect(isTargetReached(NaN, 200, "above")).toBe(false);
  });
});

describe("distanceToTargetPercent", () => {
  it("is a non-negative distance, so 'closest to target' ranks in one direction", () => {
    expect(distanceToTargetPercent(100, 120, "above")).toBeCloseTo(20, 10);
    expect(distanceToTargetPercent(120, 100, "below")).toBeCloseTo(16.6667, 4);
  });

  it("collapses to 0 once the target is reached", () => {
    expect(distanceToTargetPercent(205, 200, "above")).toBe(0);
    expect(distanceToTargetPercent(195, 200, "below")).toBe(0);
  });

  it("is null with no target", () => {
    expect(distanceToTargetPercent(100, null, "above")).toBeNull();
  });
});

describe("percentFrom52WeekHigh", () => {
  it("is a drawdown: zero or negative, never positive", () => {
    expect(percentFrom52WeekHigh(80, 100)).toBeCloseTo(-20, 10);
    expect(percentFrom52WeekHigh(100, 100)).toBe(0);
  });

  it("clamps a live print above the provider's cached high to 0", () => {
    // Otherwise "+0.14% from the high" is a stale-data artefact reported as a finding.
    expect(percentFrom52WeekHigh(100.14, 100)).toBe(0);
  });

  it("is null without a usable high", () => {
    expect(percentFrom52WeekHigh(100, null)).toBeNull();
    expect(percentFrom52WeekHigh(100, 0)).toBeNull();
  });
});

describe("rangePosition52Week", () => {
  it("maps the low to 0 and the high to 100", () => {
    expect(rangePosition52Week(50, 50, 150)).toBe(0);
    expect(rangePosition52Week(150, 50, 150)).toBe(100);
    expect(rangePosition52Week(100, 50, 150)).toBe(50);
  });

  it("clamps prices outside the reported range", () => {
    expect(rangePosition52Week(200, 50, 150)).toBe(100);
    expect(rangePosition52Week(10, 50, 150)).toBe(0);
  });

  it("is null for a degenerate range rather than dividing by zero", () => {
    expect(rangePosition52Week(100, 100, 100)).toBeNull();
    expect(rangePosition52Week(100, 150, 50)).toBeNull();
  });
});

describe("daysSince / formatAge", () => {
  const day = 86_400_000;
  // A fixed UTC noon, so the calendar-day arithmetic is unambiguous.
  const now = Date.parse("2026-07-28T12:00:00.000Z");

  it("counts calendar days, not 24-hour windows", () => {
    // Added at 23:00 the previous date. The old `(now - then) / 86.4e6` floor
    // called this "today" because only 13 hours had passed.
    expect(daysSince("2026-07-27T23:00:00.000Z", now)).toBe(1);
    expect(formatAge("2026-07-27T23:00:00.000Z", now)).toBe("1d");
  });

  it("reads today as today", () => {
    expect(daysSince("2026-07-28T01:00:00.000Z", now)).toBe(0);
    expect(formatAge("2026-07-28T01:00:00.000Z", now)).toBe("today");
  });

  it("never goes negative for a future timestamp", () => {
    expect(daysSince("2026-08-01T00:00:00.000Z", now)).toBe(0);
    expect(formatAge("2026-08-01T00:00:00.000Z", now)).toBe("today");
  });

  it("returns null for an unparseable or missing timestamp instead of NaN", () => {
    expect(daysSince("not a date", now)).toBeNull();
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince("", now)).toBeNull();
    // The old helper rendered these as the string "NaNd ago".
    expect(formatAge("not a date", now)).toBe("—");
    expect(formatAge(undefined, now)).toBe("—");
  });

  it("rolls days up into months and years so long-held names stay readable", () => {
    expect(formatAge(new Date(now - 45 * day).toISOString(), now)).toBe("45d");
    expect(formatAge(new Date(now - 120 * day).toISOString(), now)).toBe("4mo");
    expect(formatAge(new Date(now - 800 * day).toISOString(), now)).toBe("2.2y");
  });
});
