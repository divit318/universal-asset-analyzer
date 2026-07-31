/**
 * Unified Sector Rotation — pure join + divergence logic for The Wire.
 *
 * Merges the two sector datasets the page used to show as separate,
 * identically-titled grids:
 *   - price:     SectorRotationEntry (continuous relative-strength rank
 *                across the 11 GICS ETFs, from /api/sector-rotation)
 *   - sentiment: SectorImpact (this scan's event-driven directional signal)
 *
 * The key insight the merge exists to surface is DIVERGENCE — news sentiment
 * and price trend disagreeing by a meaningful margin. Both signals are mapped
 * onto a common −100..+100 scale and compared; the flag threshold is a named
 * constant, not an inline literal.
 *
 * Fail-closed by contract: a sector that cannot be joined renders with the
 * data it has and an explicit absence on the other side. Divergence is never
 * computed — let alone flagged — unless BOTH sides are genuinely present.
 */

import type { SectorImpact, SectorRotationEntry, RotationClass, SignalDirection } from "../types";
import { canonicalizeSector } from "../gics-sectors";

/**
 * Minimum |sentimentScore − priceScore| (each −100..+100, so the spread is
 * 0..200) for a tile to carry the divergence flag. 60 means e.g. clearly
 * bullish news (+45) on a bottom-third sector (−20) flags, while mildly
 * bullish news on a mid-rank sector does not.
 */
export const DIVERGENCE_THRESHOLD = 60;

/** Sentiment mapped to −100..+100: direction signs the 0-100 strength. */
export function sentimentScore(impact: Pick<SectorImpact, "direction" | "strength">): number {
  const strength = Math.max(0, Math.min(100, impact.strength));
  if (impact.direction === "bullish") return strength;
  if (impact.direction === "bearish") return -strength;
  return 0;
}

/**
 * Price trend mapped to −100..+100 from the rotation rank: rank 1 of 11 →
 * +100, rank 6 → 0, rank 11 → −100. Rank rather than raw return, so the
 * scale is unitless and stable across calm and violent tapes.
 */
export function priceScore(entry: Pick<SectorRotationEntry, "rank">, sectorCount = 11): number {
  const rank = Math.max(1, Math.min(sectorCount, entry.rank));
  const mid = (sectorCount + 1) / 2;
  return Math.round(((mid - rank) / (mid - 1)) * 100);
}

export interface SectorDivergence {
  /** sentimentScore − priceScore, −200..+200. Positive = news ahead of price. */
  value: number;
  magnitude: number;
  /** Which side is more optimistic. */
  kind: "news_ahead_of_price" | "price_ahead_of_news";
  /** True when magnitude ≥ DIVERGENCE_THRESHOLD. */
  flagged: boolean;
}

export interface UnifiedSectorTile {
  /** Canonical GICS-11 name. */
  sector: string;
  price: {
    rank: number;
    perf1mPct: number | null;
    classification: RotationClass;
    rankChange: number | null;
  } | null;
  sentiment: {
    direction: SignalDirection;
    strength: number;
    rationale: string;
  } | null;
  /** Null whenever either side is missing — never inferred from a failed join. */
  divergence: SectorDivergence | null;
}

function toDivergence(sScore: number, pScore: number): SectorDivergence {
  const value = sScore - pScore;
  const magnitude = Math.abs(value);
  return {
    value,
    magnitude,
    kind: value >= 0 ? "news_ahead_of_price" : "price_ahead_of_news",
    flagged: magnitude >= DIVERGENCE_THRESHOLD,
  };
}

/**
 * Join both datasets into one tile per sector, sorted by divergence magnitude
 * first (the insight), then by price rank.
 *
 * Joining uses canonical GICS names. Impacts are canonicalized on the way in
 * (cached payloads from before the generation-time constraint may still carry
 * legacy labels like "Banking"); an impact that cannot be canonicalized gets
 * its own price-less tile rather than being guessed onto a sector.
 */
export function buildUnifiedSectorTiles(
  impacts: SectorImpact[],
  entries: SectorRotationEntry[],
): UnifiedSectorTile[] {
  // Strongest impact wins when a canonical sector receives several
  // (e.g. legacy "Banking" and "Financials" in one cached payload).
  const impactBySector = new Map<string, SectorImpact>();
  const unmappable: SectorImpact[] = [];
  for (const impact of impacts) {
    const canonical = canonicalizeSector(impact.sector);
    if (!canonical) {
      unmappable.push(impact);
      continue;
    }
    const existing = impactBySector.get(canonical);
    if (!existing || impact.strength > existing.strength) {
      impactBySector.set(canonical, impact);
    }
  }

  const tiles: UnifiedSectorTile[] = entries.map((entry) => {
    const impact = impactBySector.get(entry.sector) ?? null;
    const price = {
      rank: entry.rank,
      perf1mPct: entry.returns["1m"],
      classification: entry.classification,
      rankChange: entry.rankChange,
    };
    const sentiment = impact
      ? { direction: impact.direction, strength: impact.strength, rationale: impact.rationale }
      : null;
    return {
      sector: entry.sector,
      price,
      sentiment,
      divergence: sentiment
        ? toDivergence(sentimentScore(sentiment), priceScore(entry, entries.length))
        : null,
    };
  });

  // Sentiment that joined no price entry still renders — price-less, flagless.
  const priced = new Set(entries.map((e) => e.sector));
  for (const [sector, impact] of impactBySector) {
    if (priced.has(sector)) continue;
    tiles.push({
      sector,
      price: null,
      sentiment: { direction: impact.direction, strength: impact.strength, rationale: impact.rationale },
      divergence: null,
    });
  }
  for (const impact of unmappable) {
    tiles.push({
      sector: impact.sector,
      price: null,
      sentiment: { direction: impact.direction, strength: impact.strength, rationale: impact.rationale },
      divergence: null,
    });
  }

  // Divergence magnitude is the page's key insight → primary sort; price rank
  // second; tiles with no price data (rank unknowable) last.
  return tiles.sort((a, b) => {
    const magA = a.divergence?.magnitude ?? -1;
    const magB = b.divergence?.magnitude ?? -1;
    if (magA !== magB) return magB - magA;
    const rankA = a.price?.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.price?.rank ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB;
  });
}
