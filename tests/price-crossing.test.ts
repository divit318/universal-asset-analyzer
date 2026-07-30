import { describe, expect, it } from "vitest";
import {
  crossingDedupKey,
  detectCrossing,
  detectDropBreach,
  dropDedupKey,
  satisfiesThreshold,
} from "@/lib/price-crossing";

/**
 * Crossing detection.
 *
 * The distinction being pinned here is between a condition being TRUE and
 * something having HAPPENED. A threshold alert is an event, and an event needs
 * two observations to exist at all — which is why "armed" is a first-class
 * result rather than a silent no-op.
 */

describe("satisfiesThreshold", () => {
  it("is inclusive at the level, in both directions", () => {
    expect(satisfiesThreshold(200, 200, "above")).toBe(true);
    expect(satisfiesThreshold(200, 200, "below")).toBe(true);
  });

  it("respects direction", () => {
    expect(satisfiesThreshold(201, 200, "above")).toBe(true);
    expect(satisfiesThreshold(199, 200, "above")).toBe(false);
    expect(satisfiesThreshold(199, 200, "below")).toBe(true);
    expect(satisfiesThreshold(201, 200, "below")).toBe(false);
  });
});

describe("detectCrossing", () => {
  const base = { threshold: 200, direction: "above" as const };

  it("arms rather than firing when there is no previous observation", () => {
    expect(detectCrossing({ ...base, previousPrice: null, currentPrice: 205 })).toEqual({ kind: "armed" });
    expect(detectCrossing({ ...base, previousPrice: undefined, currentPrice: 205 })).toEqual({ kind: "armed" });
    // A zero/negative stored price is not a usable baseline either.
    expect(detectCrossing({ ...base, previousPrice: 0, currentPrice: 205 })).toEqual({ kind: "armed" });
  });

  it("reports a crossing with both endpoints, so the message can be specific", () => {
    expect(detectCrossing({ ...base, previousPrice: 195, currentPrice: 201 })).toEqual({
      kind: "crossed",
      from: 195,
      to: 201,
    });
  });

  it("does not re-report a level that was already satisfied", () => {
    expect(detectCrossing({ ...base, previousPrice: 230, currentPrice: 240 })).toEqual({
      kind: "no_change",
      satisfied: true,
    });
  });

  it("does not report while still short of the level", () => {
    expect(detectCrossing({ ...base, previousPrice: 190, currentPrice: 195 })).toEqual({
      kind: "no_change",
      satisfied: false,
    });
  });

  it("does not report a crossing in the wrong direction", () => {
    // Falling through an 'above' target is not that target being reached.
    expect(detectCrossing({ ...base, previousPrice: 210, currentPrice: 190 }).kind).toBe("no_change");
  });

  it("handles a 'below' (buy limit) target symmetrically", () => {
    const buy = { threshold: 200, direction: "below" as const };
    expect(detectCrossing({ ...buy, previousPrice: 205, currentPrice: 199 }).kind).toBe("crossed");
    expect(detectCrossing({ ...buy, previousPrice: 199, currentPrice: 195 }).kind).toBe("no_change");
    expect(detectCrossing({ ...buy, previousPrice: 205, currentPrice: 210 }).kind).toBe("no_change");
  });

  it("fires exactly once when the price stops precisely on the level", () => {
    expect(detectCrossing({ ...base, previousPrice: 199, currentPrice: 200 }).kind).toBe("crossed");
    // Standing still at the level is not a second event — the bug the strict
    // `!was && is` test exists to prevent.
    expect(detectCrossing({ ...base, previousPrice: 200, currentPrice: 200 }).kind).toBe("no_change");
  });

  it("is unavailable, never an event, on unusable input", () => {
    expect(detectCrossing({ ...base, previousPrice: 190, currentPrice: null }).kind).toBe("unavailable");
    expect(detectCrossing({ ...base, previousPrice: 190, currentPrice: 0 }).kind).toBe("unavailable");
    expect(detectCrossing({ ...base, previousPrice: 190, currentPrice: NaN }).kind).toBe("unavailable");
    expect(detectCrossing({ previousPrice: 190, currentPrice: 205, threshold: null, direction: "above" }).kind).toBe(
      "unavailable",
    );
    expect(detectCrossing({ previousPrice: 190, currentPrice: 205, threshold: 0, direction: "above" }).kind).toBe(
      "unavailable",
    );
  });

  it("detects a net crossing across an arbitrarily long gap", () => {
    // Monitoring downtime: the baseline is simply older. A net crossing is never
    // missed, though intra-gap round trips cannot be reconstructed.
    expect(detectCrossing({ ...base, previousPrice: 100, currentPrice: 500 }).kind).toBe("crossed");
  });
});

describe("crossingDedupKey", () => {
  const at = Date.parse("2026-07-28T09:30:00Z");

  it("is stable for the same level, direction and day", () => {
    expect(crossingDedupKey("AAPL", 200, "above", at)).toBe(crossingDedupKey("aapl", 200, "above", at));
  });

  it("separates level, direction and day", () => {
    const k = crossingDedupKey("AAPL", 200, "above", at);
    expect(k).not.toBe(crossingDedupKey("AAPL", 210, "above", at));
    expect(k).not.toBe(crossingDedupKey("AAPL", 200, "below", at));
    expect(k).not.toBe(crossingDedupKey("AAPL", 200, "above", at + 86_400_000));
  });

  it("treats trivially different spellings of the same level as one level", () => {
    expect(crossingDedupKey("AAPL", 200, "above", at)).toBe(crossingDedupKey("AAPL", 200.001, "above", at));
  });
});

describe("dropDedupKey", () => {
  it("changes with the calendar day, not on a rolling window", () => {
    const a = Date.parse("2026-07-28T20:00:00Z");
    const b = Date.parse("2026-07-29T14:00:00Z"); // 18h later, next day
    expect(dropDedupKey("TSLA", a)).not.toBe(dropDedupKey("TSLA", b));
    // A rolling 24h window would have collapsed these two into one alert.
    expect(b - a).toBeLessThan(86_400_000);
  });
});

describe("detectDropBreach", () => {
  it("fires on the transition past the threshold", () => {
    expect(
      detectDropBreach({ previousChangePercent: -3, currentChangePercent: -6, thresholdPct: 5 }),
    ).toBe(true);
  });

  it("does not fire again as the decline deepens", () => {
    expect(
      detectDropBreach({ previousChangePercent: -6, currentChangePercent: -9, thresholdPct: 5 }),
    ).toBe(false);
  });

  it("fires on a cold start that is already breached", () => {
    expect(detectDropBreach({ previousChangePercent: null, currentChangePercent: -9, thresholdPct: 5 })).toBe(true);
  });

  it("is inclusive at exactly the threshold", () => {
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: -5, thresholdPct: 5 })).toBe(true);
  });

  it("ignores an unset or zero threshold", () => {
    // 0 would make every flat tick a "drop".
    for (const t of [null, undefined, 0, NaN]) {
      expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: -20, thresholdPct: t })).toBe(false);
    }
  });

  it("reads a signed threshold as a magnitude rather than as 'unset'", () => {
    // A -5 could only come from a row written before `updateWatchlistItem`
    // normalized the sign. Honouring it as 5% keeps that row alerting; rejecting
    // it would silently disable an alert the user believes is armed.
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: -6, thresholdPct: -5 })).toBe(true);
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: -3, thresholdPct: -5 })).toBe(false);
  });

  it("never fires on an up day or on unusable input", () => {
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: 4, thresholdPct: 5 })).toBe(false);
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: null, thresholdPct: 5 })).toBe(false);
    expect(detectDropBreach({ previousChangePercent: -1, currentChangePercent: NaN, thresholdPct: 5 })).toBe(false);
  });
});
