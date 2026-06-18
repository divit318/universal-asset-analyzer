import { runScreener } from "./yahoo-screener";

/** One company in the investable universe (symbol + display name). */
export interface UniverseEntry {
  symbol: string;
  name: string;
}

let cache: { entries: UniverseEntry[]; at: number } | null = null;
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000; // refresh the symbol list daily

/**
 * The investable universe: the largest US-listed equities by market cap. Built
 * by paging Yahoo's live screener (250/page). Long-term investors care about
 * established businesses, so ranking by market cap gives exactly the right set.
 */
export async function getUniverse(limit = 1000): Promise<UniverseEntry[]> {
  if (cache && Date.now() - cache.at < UNIVERSE_TTL_MS && cache.entries.length >= limit) {
    return cache.entries.slice(0, limit);
  }

  const seen = new Set<string>();
  const entries: UniverseEntry[] = [];
  const pageSize = 250;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const { rows } = await runScreener(
      // Primary US exchanges only (Nasdaq / NYSE / NYSE American) so the universe
      // is clean US-listed equities, not foreign OTC/pink-sheet ADRs.
      { sortField: "marketCap", sortDir: "desc", exchanges: ["NMS", "NYQ", "ASE"] },
      Math.min(pageSize, limit - offset),
      offset,
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      // Skip foreign listings / derivatives (suffixes like .TO, =F, ^IDX);
      // hyphenated US share classes (BRK-B) are kept.
      if (seen.has(r.symbol) || /[.=^]/.test(r.symbol)) continue;
      seen.add(r.symbol);
      entries.push({ symbol: r.symbol, name: r.name });
    }
  }

  cache = { entries, at: Date.now() };
  return entries.slice(0, limit);
}
