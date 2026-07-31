/**
 * Evidence linking — pure joins from every Wire insight back to the articles
 * that produced it, and forward from an article to everything it produced.
 *
 * Sources of truth:
 *   - NewsItem.storyId (minted in lib/news.ts at collection)
 *   - MarketEvent.sourceStoryIds (attached in lib/scanner/dedup.ts)
 *   - drivingEvents / sourceEventIds on themes, sector impacts, opportunities
 *
 * Payloads cached before those fields existed degrade gracefully: ids are a
 * deterministic function of url/headline/source (lib/story-id.ts), so they
 * are re-derived on read rather than trusted to exist.
 *
 * Risk alerts carry no pipeline-recorded event linkage (adding one means
 * editing extractRiskAlerts in lib/scanner/index.ts, which another session
 * owns right now), so their evidence is an approximate sector/ticker-overlap
 * join and is labelled as such — `approximate: true` — never presented with
 * the same authority as a recorded link.
 */

import type { MarketEvent, NewsItem, RiskAlert, ScannerResult } from "../types";
import { storyIdFor } from "../story-id";

export interface EvidenceRequest {
  /** What the drawer titles itself with — the insight the user clicked. */
  title: string;
  storyIds: string[];
  /** True when the linkage is a heuristic join, not pipeline-recorded. */
  approximate?: boolean;
}

/** An article resolved for display in the drawer. */
export interface EvidenceArticle {
  storyId: string;
  headline: string;
  source: string;
  url: string;
  publishedAt: string | null;
}

/** storyIds of one event — recorded field first, derived from sources otherwise. */
export function eventStoryIds(event: MarketEvent): string[] {
  if (event.sourceStoryIds && event.sourceStoryIds.length > 0) return event.sourceStoryIds;
  return event.sources.map((s) => s.storyId ?? storyIdFor(s));
}

/** Union of storyIds across a set of event ids (themes, impacts, opportunities). */
export function storyIdsForEventIds(eventIds: string[], events: MarketEvent[]): string[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const ids = new Set<string>();
  for (const eventId of eventIds) {
    const event = byId.get(eventId);
    if (!event) continue;
    for (const sid of eventStoryIds(event)) ids.add(sid);
  }
  return [...ids];
}

/**
 * Approximate evidence for a risk alert: events sharing a ticker or sector.
 * Returns ids plus the flag the drawer must surface.
 */
export function riskStoryIds(risk: RiskAlert, events: MarketEvent[]): { storyIds: string[]; approximate: true } {
  const tickers = new Set(risk.affectedTickers.map((t) => t.toUpperCase()));
  const sectors = new Set(risk.affectedSectors.map((s) => s.toLowerCase()));
  const ids = new Set<string>();
  for (const event of events) {
    const tickerHit = event.affectedTickers.some((t) => tickers.has(t.toUpperCase()));
    const sectorHit = event.affectedSectors.some((s) => sectors.has(s.toLowerCase()));
    if (!tickerHit && !sectorHit) continue;
    for (const sid of eventStoryIds(event)) ids.add(sid);
  }
  return { storyIds: [...ids], approximate: true };
}

/**
 * Resolve storyIds to displayable articles. Resolution order: the raw feed
 * (full article metadata), then event sources (stale payloads whose feed and
 * ids no longer line up still resolve anything an event recorded). Unresolved
 * ids are dropped — the drawer shows what it can prove, and its count says so.
 */
export function resolveArticles(
  storyIds: string[],
  newsItems: NewsItem[],
  events: MarketEvent[],
): EvidenceArticle[] {
  const byId = new Map<string, EvidenceArticle>();
  for (const item of newsItems) {
    const sid = item.storyId ?? storyIdFor(item);
    if (!byId.has(sid)) {
      byId.set(sid, { storyId: sid, headline: item.headline, source: item.source, url: item.url, publishedAt: item.publishedAt });
    }
  }
  for (const event of events) {
    for (const src of event.sources) {
      const sid = src.storyId ?? storyIdFor(src);
      if (!byId.has(sid)) {
        byId.set(sid, { storyId: sid, headline: src.headline, source: src.source, url: src.url, publishedAt: null });
      }
    }
  }
  return storyIds
    .map((sid) => byId.get(sid))
    .filter((a): a is EvidenceArticle => a != null);
}

export interface DownstreamInsights {
  eventIds: string[];
  themeNames: string[];
  sectorNames: string[];
  opportunityIds: string[];
}

/**
 * Forward trace: which insights did these articles produce? Used when a Tape
 * row is traced — every downstream card whose evidence intersects lights up.
 * Only pipeline-recorded links participate; approximate risk joins do not
 * claim articles they were never derived from.
 */
export function insightsForStories(
  storyIds: string[],
  result: Pick<Partial<ScannerResult>, "events" | "emergingThemes" | "sectorImpacts" | "opportunities">,
): DownstreamInsights {
  const wanted = new Set(storyIds);
  const events = result.events ?? [];
  const hitEvents = events.filter((e) => eventStoryIds(e).some((sid) => wanted.has(sid)));
  const hitEventIds = new Set(hitEvents.map((e) => e.id));

  return {
    eventIds: [...hitEventIds],
    themeNames: (result.emergingThemes ?? [])
      .filter((t) => t.drivingEvents.some((id) => hitEventIds.has(id)))
      .map((t) => t.name),
    sectorNames: (result.sectorImpacts ?? [])
      .filter((s) => s.drivingEvents.some((id) => hitEventIds.has(id)))
      .map((s) => s.sector),
    opportunityIds: (result.opportunities ?? [])
      .filter((o) => o.sourceEventIds.some((id) => hitEventIds.has(id)))
      .map((o) => o.id),
  };
}
