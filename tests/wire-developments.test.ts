import { describe, it, expect } from "vitest";
import {
  rankDevelopments,
  eventTickers,
  eventSectors,
  BREAKING_MAX_AGE_MS,
  DEVELOPING_MAX_AGE_MS,
  MARKET_MOVING_MIN_ABS_PCT,
  DEFAULT_DEVELOPMENT_LIMIT,
} from "@/lib/wire/developments";
import type { MarketEvent, CausalEffect } from "@/lib/types";

const NOW = Date.parse("2026-08-12T12:00:00Z");

function makeEvent(overrides: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id: overrides.id ?? `ev-${Math.random().toString(36).slice(2)}`,
    category: "macro",
    headline: "July CPI comes in line with expectations",
    summary: "Inflation continued easing in July, keeping rate-cut expectations alive.",
    publishedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    sources: [
      { headline: "h1", source: "Reuters", url: "https://a.example/1" },
      { headline: "h2", source: "Bloomberg", url: "https://a.example/2" },
    ],
    affectedTickers: [],
    affectedSectors: [],
    affectedThemes: [],
    causalChain: [],
    ...overrides,
  };
}

const bullishFirstOrder: CausalEffect = {
  order: 1,
  description: "Lower long-end yields support rate-sensitive assets",
  direction: "bullish",
  affectedSectors: ["Real Estate", "Utilities"],
  affectedTickers: ["O", "DLR"],
};

const secondOrder: CausalEffect = {
  order: 2,
  description: "REIT refinancing costs ease over coming quarters",
  direction: "bullish",
  affectedSectors: ["Real Estate"],
  affectedTickers: ["AMT"],
};

describe("rankDevelopments", () => {
  it("returns at most the limit, highest score first, deterministically", () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent({
        id: `ev-${i}`,
        headline: `Event ${i}`,
        sources: Array.from({ length: (i % 4) + 1 }, (_, j) => ({
          headline: `h${j}`,
          source: `s${j}`,
          url: `https://x.example/${i}/${j}`,
        })),
      }),
    );
    const ranked = rankDevelopments(events, { now: NOW });
    expect(ranked).toHaveLength(DEFAULT_DEVELOPMENT_LIMIT);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
    // Same inputs → same order.
    const again = rankDevelopments(events, { now: NOW });
    expect(again.map((d) => d.event.id)).toEqual(ranked.map((d) => d.event.id));
  });

  it("labels a recent multi-source event breaking, but never a single-source one", () => {
    const fresh = makeEvent({
      publishedAt: new Date(NOW - BREAKING_MAX_AGE_MS / 2).toISOString(),
    });
    const [dev] = rankDevelopments([fresh], { now: NOW });
    expect(dev.status).toBe("breaking");

    const singleSource = makeEvent({
      publishedAt: new Date(NOW - BREAKING_MAX_AGE_MS / 2).toISOString(),
      sources: [{ headline: "h", source: "s", url: "https://x.example/solo" }],
    });
    const [solo] = rankDevelopments([singleSource], { now: NOW });
    expect(solo.status).not.toBe("breaking");
  });

  it("labels market-moving only when an affected sector actually moved", () => {
    const event = makeEvent({
      publishedAt: new Date(NOW - DEVELOPING_MAX_AGE_MS * 2).toISOString(),
      affectedSectors: ["Real Estate"],
    });
    const still = rankDevelopments([event], {
      now: NOW,
      sectorPerf: [{ sector: "Real Estate", changePercent: MARKET_MOVING_MIN_ABS_PCT - 0.4 }],
    })[0];
    expect(still.status).toBe("context");

    const moving = rankDevelopments([event], {
      now: NOW,
      sectorPerf: [{ sector: "Real Estate", changePercent: -(MARKET_MOVING_MIN_ABS_PCT + 0.3) }],
    })[0];
    expect(moving.status).toBe("market-moving");
    expect(moving.reactions).toEqual([
      { sector: "Real Estate", changePercent: -(MARKET_MOVING_MIN_ABS_PCT + 0.3) },
    ]);
  });

  it("quotes the strongest first-order effect as why-it-matters and the 2nd order separately", () => {
    const event = makeEvent({
      causalChain: [
        { ...bullishFirstOrder, direction: "neutral", description: "Neutral effect" },
        bullishFirstOrder,
        secondOrder,
      ],
    });
    const [dev] = rankDevelopments([event], { now: NOW });
    expect(dev.whyItMatters).toBe(bullishFirstOrder.description);
    expect(dev.whyDirection).toBe("bullish");
    expect(dev.secondOrder).toBe(secondOrder.description);
  });

  it("splits held vs watched tickers, portfolio winning overlaps, chain tickers included", () => {
    const event = makeEvent({
      affectedTickers: ["NVDA", "TSM.NS"],
      causalChain: [bullishFirstOrder],
    });
    const [dev] = rankDevelopments([event], {
      now: NOW,
      portfolioSymbols: ["TSM", "O"],
      watchlistSymbols: ["TSM", "NVDA", "DLR"],
    });
    expect(dev.heldTickers.sort()).toEqual(["O", "TSM"]);
    expect(dev.watchedTickers.sort()).toEqual(["DLR", "NVDA"]);
  });

  it("never fabricates a reaction: unjoinable sectors carry null change", () => {
    const event = makeEvent({ affectedSectors: ["Banking"] }); // legacy label → Financials
    const [dev] = rankDevelopments([event], { now: NOW, sectorPerf: [] });
    expect(dev.reactions).toEqual([{ sector: "Financials", changePercent: null }]);
  });
});

describe("event join helpers", () => {
  it("eventTickers dedupes across direct and causal mentions, suffix-insensitive", () => {
    const event = makeEvent({
      affectedTickers: ["O.NS", "NVDA"],
      causalChain: [bullishFirstOrder], // O, DLR
    });
    expect(eventTickers(event).sort()).toEqual(["DLR", "NVDA", "O"]);
  });

  it("eventSectors canonicalizes and drops unmappable labels", () => {
    const event = makeEvent({
      affectedSectors: ["Banking", "Something Unmappable"],
      causalChain: [bullishFirstOrder], // Real Estate, Utilities
    });
    expect(eventSectors(event).sort()).toEqual(["Financials", "Real Estate", "Utilities"]);
  });
});
