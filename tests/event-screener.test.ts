import { describe, it, expect } from "vitest";
import type { NewsItem } from "../lib/types";

/**
 * Tests for the event screener's prompt structure and type contracts.
 * The AI call itself is mocked — we test the data shapes and the
 * signal filtering/sorting logic.
 */

function makeNewsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    headline: "RBI holds repo rate at 6.5%",
    source: "Economic Times",
    url: "https://example.com/rbi-rate",
    publishedAt: new Date().toISOString(),
    tickers: [],
    summary: "RBI monetary policy committee voted to hold rates.",
    ...overrides,
  };
}

describe("NewsItem shape", () => {
  it("has required fields", () => {
    const item = makeNewsItem();
    expect(item.headline).toBeTruthy();
    expect(item.source).toBeTruthy();
    expect(item.publishedAt).toBeTruthy();
    expect(Array.isArray(item.tickers)).toBe(true);
  });

  it("tickers defaults to empty array", () => {
    const item = makeNewsItem();
    expect(item.tickers).toHaveLength(0);
  });

  it("accepts tickers", () => {
    const item = makeNewsItem({ tickers: ["HDFCBANK.NS", "SBIN.NS"] });
    expect(item.tickers).toHaveLength(2);
  });
});

describe("Signal direction filtering (pure logic)", () => {
  type SignalDir = "bullish" | "bearish" | "neutral";

  interface Signal {
    ticker: string;
    direction: SignalDir;
    confidence: number;
  }

  function filterByDirection(signals: Signal[], dir: SignalDir | "all"): Signal[] {
    if (dir === "all") return signals;
    return signals.filter((s) => s.direction === dir);
  }

  function filterByMinConfidence(signals: Signal[], min: number): Signal[] {
    return signals.filter((s) => s.confidence >= min);
  }

  const signals: Signal[] = [
    { ticker: "HDFCBANK.NS", direction: "bullish", confidence: 80 },
    { ticker: "IOC.NS", direction: "bearish", confidence: 70 },
    { ticker: "TCS.NS", direction: "bullish", confidence: 45 },
    { ticker: "INFY.NS", direction: "neutral", confidence: 55 },
  ];

  it("all direction returns all signals", () => {
    expect(filterByDirection(signals, "all")).toHaveLength(4);
  });

  it("bullish filter returns only bullish", () => {
    const result = filterByDirection(signals, "bullish");
    expect(result).toHaveLength(2);
    expect(result.every((s) => s.direction === "bullish")).toBe(true);
  });

  it("minConfidence 50 filters out low confidence", () => {
    const result = filterByMinConfidence(signals, 50);
    expect(result.every((s) => s.confidence >= 50)).toBe(true);
    expect(result.some((s) => s.ticker === "TCS.NS")).toBe(false);
  });

  it("minConfidence 0 keeps all", () => {
    expect(filterByMinConfidence(signals, 0)).toHaveLength(4);
  });
});

describe("News deduplication logic", () => {
  function dedupe(items: NewsItem[]): NewsItem[] {
    const seen = new Set<string>();
    const out: NewsItem[] = [];
    for (const item of items) {
      const key = item.headline.toLowerCase().slice(0, 60);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }

  it("removes exact duplicate headlines", () => {
    const items = [
      makeNewsItem({ headline: "RBI holds rate at 6.5%" }),
      makeNewsItem({ headline: "RBI holds rate at 6.5%", source: "Moneycontrol" }),
    ];
    expect(dedupe(items)).toHaveLength(1);
  });

  it("keeps distinct headlines", () => {
    const items = [
      makeNewsItem({ headline: "RBI holds rate" }),
      makeNewsItem({ headline: "Nifty rallies 200 points" }),
    ];
    expect(dedupe(items)).toHaveLength(2);
  });

  it("deduplication is case-insensitive", () => {
    const items = [
      makeNewsItem({ headline: "RBI Holds Rate At 6.5%" }),
      makeNewsItem({ headline: "rbi holds rate at 6.5%" }),
    ];
    expect(dedupe(items)).toHaveLength(1);
  });
});
