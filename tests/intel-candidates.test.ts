import { describe, it, expect } from "vitest";
import {
  newsEventCandidates,
  earningsCandidates,
  quoteAnomalyCandidates,
  portfolioContextCandidates,
  portfolioThreatCandidates,
  concentrationSuggestion,
  compareAsymmetryCandidates,
  listMoverCandidates,
  upcomingEarningsClusterCandidate,
  type IntelPortfolioFacts,
} from "@/lib/intel/candidates";
import { scoreCandidate, INTEL_THRESHOLD } from "@/lib/intel/score";
import type { NewsItem, Quote, PeerComparison } from "@/lib/types";
import type { CalendarEvent } from "@/lib/calendar";

const NOW = Date.parse("2026-08-10T15:00:00Z");

function newsItem(overrides: Partial<NewsItem> = {}): NewsItem {
  return {
    headline: "Company announces new product line",
    source: "Reuters",
    url: "https://example.com/story",
    publishedAt: new Date(NOW - 3 * 3_600_000).toISOString(),
    tickers: ["NVDA"],
    summary: null,
    ...overrides,
  };
}

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    price: 100,
    previousClose: 100,
    change: 0,
    changePercent: 0,
    currency: "USD",
    marketCap: 1e12,
    peRatio: null,
    dayHigh: null,
    dayLow: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    volume: null,
    exchange: "NMS",
    ...overrides,
  };
}

const facts: IntelPortfolioFacts = {
  totalValue: 100_000,
  holdings: [
    { symbol: "NVDA", name: "NVIDIA Corp.", weight: 18, sector: "Technology" },
    { symbol: "MSFT", name: "Microsoft Corp.", weight: 9, sector: "Technology" },
    { symbol: "JNJ", name: "Johnson & Johnson", weight: 5, sector: "Healthcare" },
  ],
  sectorWeights: [
    { sector: "Technology", weight: 27 },
    { sector: "Healthcare", weight: 5 },
  ],
  threats: [
    { id: "threat-conc-holding-0", title: "NVDA concentration", severity: "high", detail: "NVDA is 18% of the portfolio.", href: "/portfolio?tab=risk" },
  ],
};

describe("newsEventCandidates", () => {
  it("surfaces one material fresh headline", () => {
    const out = newsEventCandidates({
      symbol: "NVDA",
      news: [
        newsItem({ headline: "NVIDIA beats earnings estimates, raises guidance" }),
        newsItem({ headline: "NVIDIA shares open higher", url: "https://example.com/2" }),
      ],
      now: NOW,
      surface: "research",
      held: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("event");
    expect(out[0].title).toContain("beats earnings");
    expect(scoreCandidate(out[0].signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("returns nothing when every item is stale", () => {
    const out = newsEventCandidates({
      symbol: "NVDA",
      news: [newsItem({ publishedAt: new Date(NOW - 5 * 86_400_000).toISOString() })],
      now: NOW,
      surface: "research",
      held: false,
    });
    expect(out).toEqual([]);
  });

  it("never turns routine coverage into a card, however fresh", () => {
    const out = newsEventCandidates({
      symbol: "NVDA",
      news: [newsItem({ headline: "NVIDIA adds new office space in Austin", publishedAt: new Date(NOW - 10 * 60_000).toISOString() })],
      now: NOW,
      surface: "research",
      held: true,
    });
    expect(out).toEqual([]);
  });

  it("never sources a card from a content mill, even with a material headline", () => {
    const out = newsEventCandidates({
      symbol: "NVDA",
      news: [newsItem({ headline: "NVIDIA beats earnings estimates", source: "Simply Wall St." })],
      now: NOW,
      surface: "research",
      held: true,
    });
    expect(out).toEqual([]);
  });

  it("does not mistake valuation commentary for an earnings event", () => {
    const out = newsEventCandidates({
      symbol: "KO",
      news: [newsItem({ headline: "Coca-Cola Stock Looks Near Fair Value While Earnings Sit Above Fair Value", tickers: ["KO"] })],
      now: NOW,
      surface: "research",
      held: false,
    });
    expect(out).toEqual([]);
  });

  it("uses a stable fingerprint for the same story", () => {
    const run = () =>
      newsEventCandidates({
        symbol: "NVDA",
        news: [newsItem({ headline: "NVIDIA beats earnings estimates" })],
        now: NOW,
        surface: "research",
        held: false,
      })[0]?.id;
    expect(run()).toBe(run());
  });
});

describe("earningsCandidates", () => {
  const event = (daysFromNow: number): CalendarEvent => ({
    id: "e1",
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    type: "earnings",
    date: new Date(NOW + daysFromNow * 86_400_000).toISOString().slice(0, 10),
    source: "watchlist",
  });

  it("flags earnings today as reported/just-in", () => {
    const out = earningsCandidates({ symbol: "NVDA", name: "NVIDIA", events: [event(0)], now: NOW, held: true });
    expect(out).toHaveLength(1);
    expect(out[0].eyebrow).toBe("Just In");
    expect(out[0].action.kind).toBe("assistant");
    expect(scoreCandidate(out[0].signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("flags upcoming earnings with a calendar action", () => {
    const out = earningsCandidates({ symbol: "NVDA", events: [event(3)], now: NOW, held: false });
    expect(out).toHaveLength(1);
    expect(out[0].action.href).toBe("/calendar");
  });

  it("ignores earnings outside the window and other symbols", () => {
    const far = earningsCandidates({ symbol: "NVDA", events: [event(20)], now: NOW, held: false });
    const other = earningsCandidates({ symbol: "AAPL", events: [event(1)], now: NOW, held: false });
    expect(far).toEqual([]);
    expect(other).toEqual([]);
  });
});

describe("quoteAnomalyCandidates", () => {
  const peers: PeerComparison = {
    sector: "Information Technology",
    peerCount: 10,
    target: { pe: 60, roe: null, revenueGrowth: null, debtToEquity: null },
    median: { pe: 25, roe: null, revenueGrowth: null, debtToEquity: null },
  };

  it("flags a big day move", () => {
    const out = quoteAnomalyCandidates({ quote: quote({ changePercent: -6.2 }), peers: null, surface: "compare", held: true });
    const move = out.find((c) => c.id.includes("day-move"));
    expect(move).toBeDefined();
    expect(move!.action.kind).toBe("assistant");
    expect(scoreCandidate(move!.signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("flags a valuation dislocation vs sector peers", () => {
    const out = quoteAnomalyCandidates({ quote: quote({ peRatio: 60 }), peers, surface: "research", held: false });
    const val = out.find((c) => c.id.includes("pe-vs-peers"));
    expect(val).toBeDefined();
    expect(val!.title).toContain("60×");
    expect(val!.action.href).toContain("/valuation");
    expect(scoreCandidate(val!.signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("stays silent on an unremarkable quote", () => {
    const out = quoteAnomalyCandidates({
      quote: quote({ changePercent: 0.4, peRatio: 26, fiftyTwoWeekHigh: 130, fiftyTwoWeekLow: 80 }),
      peers,
      surface: "research",
      held: false,
    });
    expect(out).toEqual([]);
  });

  it("does not treat a thin peer group as a valuation signal", () => {
    const thinPeers = { ...peers, peerCount: 3 };
    const out = quoteAnomalyCandidates({ quote: quote({ peRatio: 60 }), peers: thinPeers, surface: "research", held: false });
    expect(out.find((c) => c.id.includes("pe-vs-peers"))).toBeUndefined();
  });
});

describe("portfolioContextCandidates", () => {
  it("surfaces an existing heavy position", () => {
    const out = portfolioContextCandidates({ symbol: "NVDA", sector: "Technology", facts, surface: "research" });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("18%");
    expect(out[0].title).toContain("largest position");
    expect(scoreCandidate(out[0].signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("computes the sector-exposure impact of adding a new name", () => {
    const out = portfolioContextCandidates({ symbol: "AMD", name: "AMD", sector: "Technology", facts, surface: "research" });
    expect(out).toHaveLength(1);
    // 27% * 0.95 + 5 = 30.65 → ~30.7%
    expect(out[0].title).toContain("27%");
    expect(out[0].title).toContain("30.7%");
    expect(out[0].action.kind).toBe("assistant");
  });

  it("matches sector labels across case and punctuation variants", () => {
    const out = portfolioContextCandidates({ symbol: "AMD", sector: " TECHNOLOGY ", facts, surface: "research" });
    expect(out).toHaveLength(1);
  });

  it("stays silent with no portfolio or low exposure", () => {
    expect(portfolioContextCandidates({ symbol: "AMD", sector: "Technology", facts: null, surface: "research" })).toEqual([]);
    expect(portfolioContextCandidates({ symbol: "XOM", sector: "Energy", facts, surface: "research" })).toEqual([]);
  });
});

describe("portfolioThreatCandidates", () => {
  it("surfaces the single top threat", () => {
    const out = portfolioThreatCandidates(facts);
    expect(out).toHaveLength(1);
    expect(out[0].action.href).toBe("/portfolio?tab=risk");
    expect(scoreCandidate(out[0].signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("ignores low-severity threats and empty portfolios", () => {
    expect(portfolioThreatCandidates(null)).toEqual([]);
    expect(
      portfolioThreatCandidates({ ...facts, threats: [{ ...facts.threats[0], severity: "low" }] }),
    ).toEqual([]);
  });
});

describe("concentrationSuggestion", () => {
  const sectorPeers = [
    { symbol: "NVDA", name: "NVIDIA Corp." },
    { symbol: "MSFT", name: "Microsoft Corp." },
    { symbol: "AVGO", name: "Broadcom Inc." },
  ];

  it("suggests an unheld same-sector alternative for a concentrated holding", () => {
    const out = concentrationSuggestion({ symbol: "NVDA", sector: "Technology", facts, sectorPeers });
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("suggestion");
    expect(out[0].title).toContain("Broadcom"); // NVDA is self, MSFT is held
    expect(out[0].action.href).toContain("/compare?symbols=NVDA%2CAVGO");
  });

  it("stays silent for positions under the concentration gate", () => {
    expect(concentrationSuggestion({ symbol: "MSFT", sector: "Technology", facts, sectorPeers })).toEqual([]);
    expect(concentrationSuggestion({ symbol: "NVDA", sector: "Technology", facts: null, sectorPeers })).toEqual([]);
  });
});

describe("compareAsymmetryCandidates", () => {
  it("flags a comparison where only one side is held", () => {
    const out = compareAsymmetryCandidates({ symbols: ["NVDA", "AMD"], facts });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("NVDA");
    expect(out[0].title).toContain("AMD");
    expect(scoreCandidate(out[0].signals)).toBeGreaterThan(INTEL_THRESHOLD);
  });

  it("stays silent when both or neither side is held", () => {
    expect(compareAsymmetryCandidates({ symbols: ["NVDA", "MSFT"], facts })).toEqual([]);
    expect(compareAsymmetryCandidates({ symbols: ["AMD", "INTC"], facts })).toEqual([]);
  });
});

describe("listMoverCandidates", () => {
  it("surfaces the single biggest mover past the gate", () => {
    const out = listMoverCandidates({
      quotes: [quote({ symbol: "NVDA", changePercent: -7.1 }), quote({ symbol: "MSFT", changePercent: 5.5 })],
      facts,
      surface: "portfolio",
      membership: "holding",
    });
    expect(out).toHaveLength(1);
    expect(out[0].symbol).toBe("NVDA");
    expect(out[0].title).toContain("18% position");
  });

  it("stays silent for ordinary daily noise", () => {
    const out = listMoverCandidates({
      quotes: [quote({ changePercent: 2.1 }), quote({ symbol: "MSFT", changePercent: -1.4 })],
      facts,
      surface: "watchlist",
      membership: "watchlist",
    });
    expect(out).toEqual([]);
  });
});

describe("upcomingEarningsClusterCandidate", () => {
  it("clusters tracked names reporting soon into one card", () => {
    const events: CalendarEvent[] = [
      { id: "1", symbol: "NVDA", name: "NVIDIA", type: "earnings", date: new Date(NOW + 2 * 86_400_000).toISOString().slice(0, 10), source: "portfolio" },
      { id: "2", symbol: "MSFT", name: "Microsoft", type: "earnings", date: new Date(NOW + 4 * 86_400_000).toISOString().slice(0, 10), source: "watchlist" },
    ];
    const out = upcomingEarningsClusterCandidate({ events, now: NOW, surface: "watchlist" });
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("2 names");
  });

  it("ignores macro events and names the user does not track", () => {
    const events: CalendarEvent[] = [
      { id: "1", name: "CPI", type: "macro", date: new Date(NOW + 1 * 86_400_000).toISOString().slice(0, 10), source: "macro" },
    ];
    expect(upcomingEarningsClusterCandidate({ events, now: NOW, surface: "watchlist" })).toEqual([]);
  });
});
