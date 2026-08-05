import { describe, it, expect } from "vitest";
import { dayChange, dateInZone, isCurrentSession, sessionLabel } from "@/lib/day-change";
import { mapQuote } from "@/lib/yahoo";
import type { Quote } from "@/lib/types";

const base: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 304.34,
  previousClose: 333.34,
  change: -29.0,
  changePercent: -8.7,
  currency: "USD",
  marketCap: null,
  peRatio: null,
  dayHigh: null,
  dayLow: null,
  fiftyTwoWeekHigh: null,
  fiftyTwoWeekLow: null,
  volume: null,
  exchange: "NasdaqGS",
  assetType: "EQUITY",
  marketState: "REGULAR",
  // 2026-07-31 13:31 UTC = 09:31 New York
  regularMarketTime: "2026-07-31T13:31:00.000Z",
  exchangeTimezone: "America/New_York",
};

describe("dayChange", () => {
  it("reads Yahoo's own change fields and stamps the session", () => {
    const dc = dayChange(base);
    expect(dc.pct).toBe(-8.7);
    expect(dc.abs).toBe(-29.0);
    expect(dc.previousClose).toBe(333.34);
    expect(dc.sessionDate).toBe("2026-07-31");
    expect(dc.session).toBe("regular");
    expect(dc.asOf).toBe(Date.parse("2026-07-31T13:31:00.000Z"));
  });

  it("session date is computed in the EXCHANGE timezone, not UTC", () => {
    // 01:30 UTC Aug 1 is still Jul 31 in New York (21:30 ET).
    const dc = dayChange({ ...base, regularMarketTime: "2026-08-01T01:30:00.000Z" });
    expect(dc.sessionDate).toBe("2026-07-31");
    // …but Aug 1 in India for an NSE listing.
    const nse = dayChange({
      ...base,
      regularMarketTime: "2026-08-01T01:30:00.000Z",
      exchangeTimezone: "Asia/Kolkata",
    });
    expect(nse.sessionDate).toBe("2026-08-01");
  });

  it("maps market states onto session labels", () => {
    expect(dayChange({ ...base, marketState: "PRE" }).session).toBe("pre");
    expect(dayChange({ ...base, marketState: "POST" }).session).toBe("post");
    expect(dayChange({ ...base, marketState: "CLOSED" }).session).toBe("closed");
    expect(dayChange({ ...base, marketState: null }).session).toBe("closed");
  });

  it("an unknown trade time yields an undated session (never 'today')", () => {
    const dc = dayChange({ ...base, regularMarketTime: null });
    expect(dc.sessionDate).toBeNull();
    expect(dc.asOf).toBeNull();
    expect(isCurrentSession(dc, base.exchangeTimezone)).toBe(false);
    expect(sessionLabel(dc, base.exchangeTimezone)).toBe("as of last close");
  });
});

describe("isCurrentSession / sessionLabel", () => {
  // A Saturday in New York: Friday's session must not be "today".
  const satNoonUtc = Date.parse("2026-08-01T16:00:00.000Z");
  const friSession = dayChange(base); // sessionDate 2026-07-31

  it("Friday's close is not 'today' on Saturday", () => {
    expect(isCurrentSession(friSession, "America/New_York", satNoonUtc)).toBe(false);
    expect(sessionLabel(friSession, "America/New_York", satNoonUtc)).toBe("on Fri, Jul 31");
  });

  it("an intraday print is 'today' during its own session", () => {
    const friMidSession = Date.parse("2026-07-31T15:00:00.000Z");
    expect(isCurrentSession(friSession, "America/New_York", friMidSession)).toBe(true);
    expect(sessionLabel(friSession, "America/New_York", friMidSession)).toBe("today");
  });
});

describe("mapQuote session fields", () => {
  it("carries marketState, trade time, and exchange timezone through", () => {
    const q = mapQuote({
      symbol: "AAPL",
      regularMarketPrice: 309.1,
      regularMarketPreviousClose: 309.38,
      marketState: "REGULAR",
      regularMarketTime: new Date("2026-08-05T17:00:00.000Z"),
      exchangeTimezoneName: "America/New_York",
    });
    expect(q.marketState).toBe("REGULAR");
    expect(q.regularMarketTime).toBe("2026-08-05T17:00:00.000Z");
    expect(q.exchangeTimezone).toBe("America/New_York");
  });

  it("normalizes epoch-seconds trade times to ISO", () => {
    const q = mapQuote({
      symbol: "AAPL",
      regularMarketPrice: 309.1,
      regularMarketTime: 1785948888, // seconds
    });
    expect(q.regularMarketTime).toBe(new Date(1785948888000).toISOString());
  });

  it("omitted session fields map to null, not undefined", () => {
    const q = mapQuote({ symbol: "AAPL", regularMarketPrice: 1 });
    expect(q.marketState).toBeNull();
    expect(q.regularMarketTime).toBeNull();
    expect(q.exchangeTimezone).toBeNull();
  });
});
