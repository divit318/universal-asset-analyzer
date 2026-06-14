import { describe, expect, it } from "vitest";
import { mapHistory, mapQuote } from "@/lib/yahoo";

describe("mapQuote", () => {
  it("maps a full raw quote", () => {
    const q = mapQuote({
      symbol: "AAPL",
      longName: "Apple Inc.",
      regularMarketPrice: 200,
      regularMarketPreviousClose: 190,
      regularMarketChange: 10,
      regularMarketChangePercent: 5.26,
      currency: "USD",
      marketCap: 3e12,
      trailingPE: 30,
      regularMarketVolume: 1000000,
      fullExchangeName: "NasdaqGS",
    });
    expect(q).toMatchObject({
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 200,
      change: 10,
      marketCap: 3e12,
      peRatio: 30,
      exchange: "NasdaqGS",
    });
  });

  it("derives change from price/previousClose when missing", () => {
    const q = mapQuote({
      symbol: "X",
      regularMarketPrice: 110,
      regularMarketPreviousClose: 100,
    });
    expect(q.change).toBeCloseTo(10);
    expect(q.changePercent).toBeCloseTo(10);
  });

  it("falls back to nulls for absent fundamentals", () => {
    const q = mapQuote({ symbol: "Y", regularMarketPrice: 5 });
    expect(q.marketCap).toBeNull();
    expect(q.peRatio).toBeNull();
    expect(q.currency).toBe("USD");
    expect(q.name).toBe("Y");
  });
});

describe("mapHistory", () => {
  it("normalizes dates and drops gaps", () => {
    const points = mapHistory([
      { date: new Date("2024-01-01T00:00:00Z"), close: 100 },
      { date: "2024-01-02T00:00:00Z", close: null },
      { date: null, close: 102 },
      { date: "2024-01-03T00:00:00Z", close: 103 },
    ]);
    expect(points).toEqual([
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-03", close: 103 },
    ]);
  });
});
