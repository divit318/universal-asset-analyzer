import { describe, it, expect } from "vitest";
import type { MarketEvent, NewsItem, RiskAlert, EmergingTheme, SectorImpact, ScannerOpportunity } from "@/lib/types";
import { storyIdFor } from "@/lib/story-id";
import {
  eventStoryIds,
  storyIdsForEventIds,
  riskStoryIds,
  resolveArticles,
  insightsForStories,
} from "@/lib/wire/evidence";

function newsItem(headline: string, url: string, withId = true): NewsItem {
  const base: NewsItem = { headline, source: "Reuters", url, publishedAt: "2026-07-31T10:00:00Z", tickers: [], summary: null };
  return withId ? { ...base, storyId: storyIdFor(base) } : base;
}

function marketEvent(id: string, items: NewsItem[], opts: Partial<MarketEvent> = {}): MarketEvent {
  return {
    id,
    category: "company",
    headline: `Event ${id}`,
    summary: "s",
    publishedAt: "2026-07-31T10:00:00Z",
    sources: items.map((i) => ({ headline: i.headline, source: i.source, url: i.url, storyId: i.storyId })),
    affectedTickers: [],
    affectedSectors: [],
    affectedThemes: [],
    causalChain: [],
    sourceStoryIds: items.map((i) => i.storyId ?? storyIdFor(i)),
    ...opts,
  };
}

const A = newsItem("Chevron reports Q2 results", "https://x.test/cvx-q2");
const B = newsItem("Fed holds rates steady", "https://x.test/fed");
const C = newsItem("Equinox and Orla complete merger", "https://x.test/eqx");

describe("storyIdFor", () => {
  it("is deterministic and URL-first", () => {
    expect(storyIdFor(A)).toBe(storyIdFor({ ...A, headline: "rewritten headline" }));
    const noUrl = { url: "", headline: "h", source: "s" };
    expect(storyIdFor(noUrl)).toBe(storyIdFor({ ...noUrl }));
    expect(storyIdFor(noUrl)).not.toBe(storyIdFor({ ...noUrl, source: "other" }));
  });
});

describe("eventStoryIds — graceful on pre-storyId payloads", () => {
  it("prefers the recorded sourceStoryIds", () => {
    const e = marketEvent("e1", [A, B]);
    expect(eventStoryIds(e)).toEqual([A.storyId, B.storyId]);
  });

  it("derives ids from sources when the recorded field is missing (stale cache)", () => {
    const stale = marketEvent("e1", [A]);
    delete stale.sourceStoryIds;
    delete stale.sources[0].storyId;
    expect(eventStoryIds(stale)).toEqual([storyIdFor(A)]);
  });
});

describe("storyIdsForEventIds", () => {
  it("unions storyIds across events and ignores unknown event ids", () => {
    const e1 = marketEvent("e1", [A]);
    const e2 = marketEvent("e2", [A, C]); // A shared — must not duplicate
    const ids = storyIdsForEventIds(["e1", "e2", "missing"], [e1, e2]);
    expect(ids.sort()).toEqual([A.storyId!, C.storyId!].sort());
  });
});

describe("riskStoryIds — approximate, and says so", () => {
  it("joins by sector/ticker overlap and is always flagged approximate", () => {
    const e1 = marketEvent("e1", [A], { affectedSectors: ["Energy"] });
    const e2 = marketEvent("e2", [B], { affectedSectors: ["Financials"] });
    const risk: RiskAlert = { id: "r1", headline: "Energy risk", severity: "high", affectedSectors: ["Energy"], affectedTickers: [], rationale: "r" };
    const { storyIds, approximate } = riskStoryIds(risk, [e1, e2]);
    expect(storyIds).toEqual([A.storyId]);
    expect(approximate).toBe(true);
  });
});

describe("resolveArticles", () => {
  it("resolves from the feed first, event sources second, and drops unknowns", () => {
    const e = marketEvent("e1", [C]);
    const resolved = resolveArticles([A.storyId!, C.storyId!, "sdoesnotexist"], [A], [e]);
    expect(resolved.map((r) => r.storyId)).toEqual([A.storyId, C.storyId]);
    expect(resolved[0].publishedAt).not.toBeNull(); // feed carries full metadata
    expect(resolved[1].publishedAt).toBeNull();     // event source has no timestamp
  });

  it("resolves a fully pre-storyId payload by derivation alone", () => {
    const staleItem = newsItem("Chevron reports Q2 results", "https://x.test/cvx-q2", false);
    const staleEvent = marketEvent("e1", [staleItem]);
    delete staleEvent.sourceStoryIds;
    delete staleEvent.sources[0].storyId;
    const ids = eventStoryIds(staleEvent);
    const resolved = resolveArticles(ids, [staleItem], [staleEvent]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].headline).toBe(staleItem.headline);
  });
});

describe("insightsForStories — forward trace from a Tape story", () => {
  const e1 = marketEvent("e1", [A]);
  const e2 = marketEvent("e2", [C]);
  const theme: EmergingTheme = { name: "Energy earnings", description: "d", momentum: 60, drivingEvents: ["e1"], topTickers: [], thematicResearchUrl: "/thematic" };
  const impact: SectorImpact = { sector: "Energy", etfTicker: "XLE", direction: "bullish", strength: 60, rationale: "r", keyBeneficiaries: [], keyLosers: [], drivingEvents: ["e1"] };
  const opp = { id: "o1", ticker: "CVX", sourceEventIds: ["e1"] } as ScannerOpportunity;
  const unrelatedOpp = { id: "o2", ticker: "EQX", sourceEventIds: ["e2"] } as ScannerOpportunity;

  it("lights up exactly the insights derived from the story, nothing else", () => {
    const hits = insightsForStories([A.storyId!], {
      events: [e1, e2],
      emergingThemes: [theme],
      sectorImpacts: [impact],
      opportunities: [opp, unrelatedOpp],
    });
    expect(hits.eventIds).toEqual(["e1"]);
    expect(hits.themeNames).toEqual(["Energy earnings"]);
    expect(hits.sectorNames).toEqual(["Energy"]);
    expect(hits.opportunityIds).toEqual(["o1"]);
  });

  it("returns nothing for a story no insight was derived from", () => {
    const hits = insightsForStories([B.storyId!], {
      events: [e1, e2],
      emergingThemes: [theme],
      sectorImpacts: [impact],
      opportunities: [opp],
    });
    expect(hits.eventIds).toEqual([]);
    expect(hits.themeNames).toEqual([]);
    expect(hits.sectorNames).toEqual([]);
    expect(hits.opportunityIds).toEqual([]);
  });
});
