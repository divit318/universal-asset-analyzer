import { describe, expect, it } from "vitest";
import {
  buildBlocks,
  classifyIntent,
  estimateTokens,
  selectBlocks,
} from "@/lib/ai/retrieval";
import type { CompanyContext, ContextBlock } from "@/lib/ai/types";
import type { Quote } from "@/lib/types";

const quote: Quote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 200,
  previousClose: 190,
  change: 10,
  changePercent: 5.26,
  currency: "USD",
  marketCap: 3e12,
  peRatio: 30,
  dayHigh: 201,
  dayLow: 195,
  fiftyTwoWeekHigh: 220,
  fiftyTwoWeekLow: 150,
  volume: 1_000_000,
  exchange: "NasdaqGS",
};

function ctxFixture(over: Partial<CompanyContext> = {}): CompanyContext {
  return {
    symbol: "AAPL",
    name: "Apple Inc.",
    builtAt: "2026-06-15T00:00:00.000Z",
    quote,
    profile: {
      symbol: "AAPL",
      description: "Apple designs and sells consumer electronics and services.",
      sector: "Technology",
      industry: "Consumer Electronics",
      country: "United States",
      website: "https://apple.com",
      employees: 161000,
      enterpriseValue: 3.1e12,
      institutionalOwnership: 61,
      insiderOwnership: 0.07,
      officers: [{ name: "Tim Cook", title: "CEO" }],
    },
    snapshot: null,
    statements: null,
    analyst: null,
    insider: null,
    score: null,
    risks: [],
    momentum: null,
    personality: null,
    peers: null,
    filings: [
      { form: "10-K", filedAt: "2025-11-01", description: "Annual report", documentUrl: "https://sec.gov/aapl-10k" },
    ],
    news: [{ headline: "Apple unveils new chip", source: "Reuters", url: "https://x/1", publishedAt: "2026-06-10T00:00:00Z", tickers: [], summary: null }],
    onWatchlist: false,
    warnings: [],
    ownership: null,
    sectorRotation: null,
    recentTimelineEvents: [],
    relatedOpportunities: null,
    graphNeighbors: [],
    ...over,
  };
}

describe("classifyIntent", () => {
  it("detects valuation questions", () => {
    expect(classifyIntent("Is this stock undervalued?")).toContain("valuation");
  });
  it("detects risk + decline questions", () => {
    expect(classifyIntent("What could cause a 30% decline?")).toContain("risks");
  });
  it("maps Buffett-style questions to thesis", () => {
    expect(classifyIntent("Would Buffett invest in this company?")).toContain("thesis");
  });
  it("falls back to general", () => {
    expect(classifyIntent("hello there")).toEqual(["general"]);
  });
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(40))).toBe(10);
  });
});

describe("buildBlocks", () => {
  it("always includes the overview and price anchors", () => {
    const ids = buildBlocks(ctxFixture()).map((b) => b.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("price");
  });
  it("source-tags every block", () => {
    for (const b of buildBlocks(ctxFixture())) {
      expect(b.source).toMatch(/:|news/);
    }
  });
  it("emits a data-gaps block when sources failed", () => {
    const ids = buildBlocks(ctxFixture({ warnings: ["statements: EDGAR down"] })).map((b) => b.id);
    expect(ids).toContain("gaps");
  });
});

describe("selectBlocks", () => {
  const blocks: ContextBlock[] = [
    { id: "overview", source: "yahoo:profile", heading: "O", body: "x".repeat(40), priority: 100 },
    { id: "price", source: "yahoo:price", heading: "P", body: "x".repeat(40), priority: 90 },
    { id: "valuation", source: "yahoo:valuation", heading: "V", body: "x".repeat(40), priority: 50 },
    { id: "news", source: "news", heading: "N", body: "x".repeat(40), priority: 35 },
  ];

  it("keeps anchors even under a tiny budget", () => {
    const ids = selectBlocks(blocks, ["news"], 1).map((b) => b.id);
    expect(ids).toContain("overview");
    expect(ids).toContain("price");
  });

  it("boosts intent-relevant sections into the selection", () => {
    const ids = selectBlocks(blocks, ["valuation"], 60).map((b) => b.id);
    expect(ids).toContain("valuation");
  });
});
