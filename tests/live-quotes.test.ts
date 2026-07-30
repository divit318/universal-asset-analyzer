import { describe, expect, it } from "vitest";
import {
  CLOSED_INTERVAL_MS,
  MAX_BACKOFF_MS,
  OPEN_INTERVAL_MS,
  changedSymbols,
  formatAsOf,
  resolvePollInterval,
} from "@/lib/live-quotes";

/**
 * The polling schedule.
 *
 * There is no streaming feed in this stack, so the quality of "live prices" is
 * entirely the quality of these decisions: not polling a hidden tab, not
 * hammering a closed market, and not retrying an outage at full speed.
 */

/* All Wednesdays, so weekday handling is not what is being exercised.
 *   14:30 UTC → 10:30 New York        → US open
 *   02:00 UTC → 22:00 New York (Tue)  → US closed, and 07:30 Mumbai (pre-open)
 *   05:00 UTC → 01:00 New York        → US closed, but 10:30 Mumbai → IN open */
const OPEN_UTC = new Date("2026-07-29T14:30:00Z");
const CLOSED_UTC = new Date("2026-07-29T02:00:00Z");
const US_CLOSED_IN_OPEN_UTC = new Date("2026-07-29T05:00:00Z");
const SATURDAY = new Date("2026-08-01T14:30:00Z");

describe("resolvePollInterval", () => {
  it("does not poll a hidden tab at all", () => {
    expect(
      resolvePollInterval({ regions: ["US"], visible: false, consecutiveErrors: 0, now: OPEN_UTC }),
    ).toBeNull();
  });

  it("does not poll when there is nothing on screen", () => {
    expect(resolvePollInterval({ regions: [], visible: true, consecutiveErrors: 0, now: OPEN_UTC })).toBeNull();
  });

  it("polls fast while a tracked market is open", () => {
    expect(resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: 0, now: OPEN_UTC })).toBe(
      OPEN_INTERVAL_MS,
    );
  });

  it("polls slowly when every tracked market is closed", () => {
    expect(resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: 0, now: CLOSED_UTC })).toBe(
      CLOSED_INTERVAL_MS,
    );
    expect(resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: 0, now: SATURDAY })).toBe(
      CLOSED_INTERVAL_MS,
    );
  });

  it("uses the fast cadence when ANY tracked market is open", () => {
    // New York is shut but Mumbai is mid-session, so a watchlist holding an
    // Indian listing is genuinely live and must not be polled at the overnight
    // cadence just because the US is closed.
    expect(
      resolvePollInterval({
        regions: ["US", "IN"],
        visible: true,
        consecutiveErrors: 0,
        now: US_CLOSED_IN_OPEN_UTC,
      }),
    ).toBe(OPEN_INTERVAL_MS);
    // Same instant, US-only list: slow.
    expect(
      resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: 0, now: US_CLOSED_IN_OPEN_UTC }),
    ).toBe(CLOSED_INTERVAL_MS);
  });

  it("treats crypto as always open", () => {
    expect(
      resolvePollInterval({ regions: ["CRYPTO"], visible: true, consecutiveErrors: 0, now: SATURDAY }),
    ).toBe(OPEN_INTERVAL_MS);
  });

  it("backs off exponentially on consecutive errors", () => {
    const at = (n: number) =>
      resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: n, now: OPEN_UTC })!;
    expect(at(1)).toBe(OPEN_INTERVAL_MS * 2);
    expect(at(2)).toBe(OPEN_INTERVAL_MS * 4);
    expect(at(3)).toBe(OPEN_INTERVAL_MS * 8);
    // Strictly increasing until the cap.
    expect(at(2)).toBeGreaterThan(at(1));
  });

  it("caps the backoff so an outage never stops retrying entirely", () => {
    expect(
      resolvePollInterval({ regions: ["US"], visible: true, consecutiveErrors: 50, now: OPEN_UTC }),
    ).toBe(MAX_BACKOFF_MS);
  });

  it("never shortens a closed-market interval because of an error", () => {
    const closedWithErrors = resolvePollInterval({
      regions: ["US"],
      visible: true,
      consecutiveErrors: 3,
      now: CLOSED_UTC,
    })!;
    expect(closedWithErrors).toBeGreaterThanOrEqual(CLOSED_INTERVAL_MS);
  });

  it("keeps a hidden tab paused regardless of errors or region", () => {
    for (const errors of [0, 1, 99]) {
      expect(
        resolvePollInterval({ regions: ["CRYPTO"], visible: false, consecutiveErrors: errors, now: OPEN_UTC }),
      ).toBeNull();
    }
  });
});

describe("formatAsOf", () => {
  const now = Date.parse("2026-07-29T14:30:00Z");
  it("describes freshness in the units a reader cares about", () => {
    expect(formatAsOf(null, now)).toBe("never");
    expect(formatAsOf(now - 1_000, now)).toBe("just now");
    expect(formatAsOf(now - 20_000, now)).toBe("20s ago");
    expect(formatAsOf(now - 300_000, now)).toBe("5m ago");
    expect(formatAsOf(now - 7_200_000, now)).toBe("2h ago");
  });

  it("never reports a negative age from clock skew", () => {
    expect(formatAsOf(now + 5_000, now)).toBe("just now");
  });
});

describe("changedSymbols", () => {
  it("reports direction only for prices a reader could see change", () => {
    const before = { AAPL: { price: 190 }, MSFT: { price: 400 }, NVDA: { price: 100 } };
    const after = { AAPL: { price: 191 }, MSFT: { price: 399.5 }, NVDA: { price: 100.001 } };
    const out = changedSymbols(before, after);
    expect(out).toEqual([
      { symbol: "AAPL", direction: "up" },
      { symbol: "MSFT", direction: "down" },
    ]);
    // NVDA moved by a ten-thousandth of a cent — invisible at 2dp, so flashing
    // it would be pure noise.
    expect(out.find((c) => c.symbol === "NVDA")).toBeUndefined();
  });

  it("does not flash a symbol appearing for the first time", () => {
    expect(changedSymbols({}, { AAPL: { price: 190 } })).toEqual([]);
  });
});
