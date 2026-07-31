import { describe, it, expect } from "vitest";
import type { SectorImpact, SectorRotationEntry, RotationClass } from "@/lib/types";
import {
  buildUnifiedSectorTiles,
  sentimentScore,
  priceScore,
  DIVERGENCE_THRESHOLD,
} from "@/lib/wire/sector-divergence";

function impact(sector: string, direction: SectorImpact["direction"], strength: number): SectorImpact {
  return { sector, etfTicker: null, direction, strength, rationale: "r", keyBeneficiaries: [], keyLosers: [], drivingEvents: [] };
}

function entry(sector: string, rank: number, ret1m: number | null = 1, classification: RotationClass = "leading"): SectorRotationEntry {
  return {
    sector,
    etfTicker: "XLK",
    returns: { "1w": null, "1m": ret1m, "3m": null, "6m": null },
    relativeStrength: 0,
    momentum: 0,
    rank,
    rankChange: null,
    classification,
  };
}

/** The 11 GICS entries the price panel always carries, ranks 1..11. */
const ENTRIES: SectorRotationEntry[] = [
  "Healthcare", "Financials", "Industrials", "Utilities", "Consumer Staples",
  "Real Estate", "Materials", "Consumer Cyclical", "Communication Services",
  "Energy", "Technology",
].map((s, i) => entry(s, i + 1));

describe("signal scales", () => {
  it("maps sentiment to a signed −100..+100 score", () => {
    expect(sentimentScore({ direction: "bullish", strength: 70 })).toBe(70);
    expect(sentimentScore({ direction: "bearish", strength: 70 })).toBe(-70);
    expect(sentimentScore({ direction: "neutral", strength: 70 })).toBe(0);
  });

  it("maps rank to a signed score: 1 → +100, mid → 0, 11 → −100", () => {
    expect(priceScore({ rank: 1 })).toBe(100);
    expect(priceScore({ rank: 6 })).toBe(0);
    expect(priceScore({ rank: 11 })).toBe(-100);
  });
});

describe("buildUnifiedSectorTiles — divergence", () => {
  it("flags bullish news on a price-lagging sector as news-ahead divergence", () => {
    // Technology: rank 11 (price −100) + bullish 75 (news +75) → spread 175.
    const tiles = buildUnifiedSectorTiles([impact("Technology", "bullish", 75)], ENTRIES);
    const tech = tiles.find((t) => t.sector === "Technology")!;
    expect(tech.divergence).not.toBeNull();
    expect(tech.divergence!.flagged).toBe(true);
    expect(tech.divergence!.kind).toBe("news_ahead_of_price");
    expect(tech.divergence!.magnitude).toBeGreaterThanOrEqual(DIVERGENCE_THRESHOLD);
  });

  it("flags bearish news on a price-leading sector as price-ahead divergence", () => {
    const tiles = buildUnifiedSectorTiles([impact("Healthcare", "bearish", 60)], ENTRIES);
    const hc = tiles.find((t) => t.sector === "Healthcare")!;
    expect(hc.divergence!.flagged).toBe(true);
    expect(hc.divergence!.kind).toBe("price_ahead_of_news");
  });

  it("does not flag agreement, and respects the exported threshold exactly", () => {
    // Financials: rank 2 → price +80; bullish 60 → news +60; spread 20 < 60.
    const tiles = buildUnifiedSectorTiles([impact("Financials", "bullish", 60)], ENTRIES);
    const fin = tiles.find((t) => t.sector === "Financials")!;
    expect(fin.divergence).not.toBeNull();
    expect(fin.divergence!.magnitude).toBeLessThan(DIVERGENCE_THRESHOLD);
    expect(fin.divergence!.flagged).toBe(false);
  });
});

describe("buildUnifiedSectorTiles — fail-closed joins", () => {
  it("a sector with price but no sentiment renders with divergence null, never inferred", () => {
    const tiles = buildUnifiedSectorTiles([], ENTRIES);
    expect(tiles).toHaveLength(11);
    for (const t of tiles) {
      expect(t.price).not.toBeNull();
      expect(t.sentiment).toBeNull();
      expect(t.divergence).toBeNull();
    }
  });

  it("an unmappable sentiment label gets its own price-less tile — no guessed join", () => {
    const tiles = buildUnifiedSectorTiles([impact("Quantum Computing", "bullish", 80)], ENTRIES);
    const orphan = tiles.find((t) => t.sector === "Quantum Computing")!;
    expect(orphan.price).toBeNull();
    expect(orphan.sentiment).not.toBeNull();
    expect(orphan.divergence).toBeNull();
    // And it did not contaminate any priced tile.
    expect(tiles.filter((t) => t.sentiment != null)).toHaveLength(1);
  });

  it("legacy cached labels join via the fallback map — 'Banking' attaches to Financials", () => {
    const tiles = buildUnifiedSectorTiles([impact("Banking", "bearish", 55)], ENTRIES);
    const fin = tiles.find((t) => t.sector === "Financials")!;
    expect(fin.sentiment).not.toBeNull();
    expect(fin.sentiment!.direction).toBe("bearish");
    expect(tiles.some((t) => t.sector === "Banking")).toBe(false);
  });

  it("when legacy and canonical labels both target one sector, the stronger signal wins", () => {
    const tiles = buildUnifiedSectorTiles(
      [impact("Banking", "bearish", 40), impact("Financials", "bullish", 70)],
      ENTRIES,
    );
    const fin = tiles.find((t) => t.sector === "Financials")!;
    expect(fin.sentiment!.strength).toBe(70);
    expect(fin.sentiment!.direction).toBe("bullish");
  });
});

describe("buildUnifiedSectorTiles — ordering", () => {
  it("sorts by divergence magnitude first, then price rank; price-less tiles last", () => {
    const tiles = buildUnifiedSectorTiles(
      [
        impact("Technology", "bullish", 75),   // rank 11 → huge divergence
        impact("Financials", "bullish", 60),   // rank 2 → tiny divergence
        impact("Quantum Computing", "bullish", 80), // unmappable → last
      ],
      ENTRIES,
    );
    expect(tiles[0].sector).toBe("Technology");
    expect(tiles[tiles.length - 1].sector).toBe("Quantum Computing");
    // Among the undiverged/priced remainder, price rank ascending.
    const ranked = tiles.filter((t) => t.price != null && t.divergence == null);
    const ranks = ranked.map((t) => t.price!.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
