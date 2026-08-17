/**
 * Top Developments — deterministic ranking of a scan's MarketEvents into the
 * few stories that matter most right now, joined to live market reaction and
 * the user's own names.
 *
 * This is the Wire's lead section, so the bar is: no model calls, no fetches,
 * no fabricated causality. Everything here is a pure function of what the
 * pipeline already measured (events, causal chains, source counts) plus live
 * sector performance and the user's tracked symbols. The LLM analyzed each
 * event once, upstream; this module only *ranks and joins* that analysis.
 *
 * Status labels are deliberately conservative: "breaking" requires recency
 * AND corroboration, and "market-moving" requires an actual measured sector
 * move — a label the tape can't back up is worse than no label.
 */

import type { MarketEvent, SignalDirection } from "../types";
import { canonicalizeSector } from "../gics-sectors";

/* -------------------------------------------------------------------------- */
/* Tunable constants (exported so tests pin behavior)                          */
/* -------------------------------------------------------------------------- */

/** "Breaking" = younger than this AND corroborated by ≥2 outlets. */
export const BREAKING_MAX_AGE_MS = 90 * 60 * 1000;

/** "Developing" = younger than this (multi-source not required). */
export const DEVELOPING_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** "Market-moving" = an affected sector actually moved at least this much today. */
export const MARKET_MOVING_MIN_ABS_PCT = 1.5;

/** How many developments the section shows by default. */
export const DEFAULT_DEVELOPMENT_LIMIT = 5;

export type DevelopmentStatus = "breaking" | "market-moving" | "developing" | "context";

export interface SectorReaction {
  sector: string;
  /** Today's ETF move for that sector; null renders as "no read", never 0. */
  changePercent: number | null;
}

export interface WireDevelopment {
  event: MarketEvent;
  status: DevelopmentStatus;
  /** Deterministic rank score — higher first. Exposed for tests/debugging. */
  score: number;
  /** ms since publishedAt at ranking time; null if the timestamp is bad. */
  ageMs: number | null;
  sourceCount: number;
  /**
   * The strongest first-order causal effect, verbatim from the pipeline's
   * event analysis — the "why it matters" line. Null when the event carries
   * no causal chain (only macro/policy/geopolitics events get one).
   */
  whyItMatters: string | null;
  /** Direction of the effect quoted in whyItMatters. */
  whyDirection: SignalDirection | null;
  /** Second-order effect, when the chain has one — the "what follows" line. */
  secondOrder: string | null;
  /** Live sector moves for the event's affected sectors (joined, ≤3). */
  reactions: SectorReaction[];
  /** Affected tickers the user holds / watches (portfolio wins overlaps). */
  heldTickers: string[];
  watchedTickers: string[];
}

/** .NS/.BO-insensitive symbol key — same normalization as the impact panels. */
function symbolKey(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/, "").toUpperCase();
}

const CATEGORY_WEIGHT: Record<MarketEvent["category"], number> = {
  macro: 3,
  policy: 3,
  geopolitics: 3,
  commodity: 2,
  market: 2,
  company: 1,
  sentiment: 0,
};

function ageOf(event: MarketEvent, now: number): number | null {
  const t = Date.parse(event.publishedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, now - t);
}

function recencyBonus(ageMs: number | null): number {
  if (ageMs == null) return 0;
  if (ageMs <= 2 * 60 * 60 * 1000) return 6;
  if (ageMs <= DEVELOPING_MAX_AGE_MS) return 4;
  if (ageMs <= 24 * 60 * 60 * 1000) return 2;
  return 0;
}

/** Every ticker an event touches: direct mentions plus causal-chain effects. */
export function eventTickers(event: MarketEvent): string[] {
  const all = new Set<string>();
  for (const t of event.affectedTickers) all.add(symbolKey(t));
  for (const effect of event.causalChain) {
    for (const t of effect.affectedTickers) all.add(symbolKey(t));
  }
  return [...all];
}

/** Every canonical sector an event touches (direct + causal-chain), deduped. */
export function eventSectors(event: MarketEvent): string[] {
  const all = new Set<string>();
  for (const s of event.affectedSectors) {
    const c = canonicalizeSector(s);
    if (c) all.add(c);
  }
  for (const effect of event.causalChain) {
    for (const s of effect.affectedSectors) {
      const c = canonicalizeSector(s);
      if (c) all.add(c);
    }
  }
  return [...all];
}

/** Strongest first-order effect: bullish/bearish beats neutral, order kept otherwise. */
function leadEffect(event: MarketEvent): { description: string; direction: SignalDirection } | null {
  const firstOrder = event.causalChain.filter((e) => e.order === 1);
  if (firstOrder.length === 0) return null;
  const directional = firstOrder.find((e) => e.direction !== "neutral");
  const pick = directional ?? firstOrder[0];
  return { description: pick.description, direction: pick.direction };
}

export interface RankOptions {
  now?: number;
  /** Live sector performance (canonical GICS names) for reaction joins. */
  sectorPerf?: { sector: string; changePercent: number | null }[];
  portfolioSymbols?: string[];
  watchlistSymbols?: string[];
  limit?: number;
}

/**
 * Rank events into the developments the section leads with.
 *
 * Score = corroboration + recency + category weight + causal richness +
 * personal relevance. Deterministic and stable: ties break on recency, then
 * on headline so the same inputs always render in the same order.
 */
export function rankDevelopments(events: MarketEvent[], opts: RankOptions = {}): WireDevelopment[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? DEFAULT_DEVELOPMENT_LIMIT;
  const held = new Set((opts.portfolioSymbols ?? []).map(symbolKey));
  const watched = new Set((opts.watchlistSymbols ?? []).map(symbolKey));
  const perfBySector = new Map(
    (opts.sectorPerf ?? []).map((s) => [s.sector, s.changePercent] as const),
  );

  const ranked = events.map((event): WireDevelopment => {
    const ageMs = ageOf(event, now);
    const sourceCount = Math.max(1, event.sources.length);
    const tickers = eventTickers(event);
    const heldTickers = tickers.filter((t) => held.has(t));
    const watchedTickers = tickers.filter((t) => !held.has(t) && watched.has(t));

    const sectors = eventSectors(event);
    const reactions: SectorReaction[] = sectors
      .map((sector) => ({ sector, changePercent: perfBySector.get(sector) ?? null }))
      .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
      .slice(0, 3);

    const effect = leadEffect(event);
    const secondOrder = event.causalChain.find((e) => e.order === 2)?.description ?? null;

    const score =
      Math.min(sourceCount, 5) * 3 +
      recencyBonus(ageMs) +
      (CATEGORY_WEIGHT[event.category] ?? 1) +
      Math.min(event.causalChain.length, 4) +
      Math.min(heldTickers.length * 2 + watchedTickers.length, 4);

    const maxAbsMove = reactions.reduce(
      (m, r) => (r.changePercent != null ? Math.max(m, Math.abs(r.changePercent)) : m),
      0,
    );

    let status: DevelopmentStatus = "context";
    if (ageMs != null && ageMs <= BREAKING_MAX_AGE_MS && sourceCount >= 2) status = "breaking";
    else if (maxAbsMove >= MARKET_MOVING_MIN_ABS_PCT) status = "market-moving";
    else if (ageMs != null && ageMs <= DEVELOPING_MAX_AGE_MS) status = "developing";

    return {
      event,
      status,
      score,
      ageMs,
      sourceCount,
      whyItMatters: effect?.description ?? null,
      whyDirection: effect?.direction ?? null,
      secondOrder,
      reactions,
      heldTickers,
      watchedTickers,
    };
  });

  return ranked
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.ageMs ?? Number.MAX_SAFE_INTEGER) - (b.ageMs ?? Number.MAX_SAFE_INTEGER) ||
        a.event.headline.localeCompare(b.event.headline),
    )
    .slice(0, limit);
}
