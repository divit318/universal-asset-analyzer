/**
 * GICS sector taxonomy — mirrors lib/sector-rotation.ts's SECTOR_ETF_MAP keys.
 * Kept as a zero-I/O literal (like lib/sector-rotation-utils.ts) so client
 * components can import it without pulling in lib/db.ts (node:sqlite),
 * which lib/sector-rotation.ts reaches transitively — see ARCHITECTURE.md,
 * "Watchlist Intelligence" section, for the incident this pattern avoids.
 */
export const GICS_SECTORS: string[] = [
  "Technology", "Financials", "Energy", "Healthcare", "Industrials",
  "Consumer Cyclical", "Consumer Staples", "Utilities", "Real Estate",
  "Materials", "Communication Services",
];

/**
 * Legacy / open-vocabulary sector labels → the canonical GICS-11 name above.
 * The sector-impact prompt is constrained to the canonical names at
 * generation time; this map exists for two demoted purposes only:
 *   1. parse-time re-mapping when the model strays anyway (logged), and
 *   2. reading cached ScannerResult payloads produced before the constraint.
 * It is NOT the primary join mechanism — see AGENTS.md on variant-map drift.
 */
export const LEGACY_SECTOR_MAP: Record<string, string> = {
  // Yahoo assetProfile sector names that differ from the canonical GICS-11
  // labels above (the source of the knowledge graph's dual-taxonomy bug).
  "basic materials": "Materials",
  "consumer defensive": "Consumer Staples",
  "banking": "Financials",
  "banks": "Financials",
  "financial services": "Financials",
  "finance": "Financials",
  "it services": "Technology",
  "information technology": "Technology",
  "tech": "Technology",
  "semiconductors": "Technology",
  "pharma": "Healthcare",
  "pharmaceuticals": "Healthcare",
  "biotechnology": "Healthcare",
  "biotech": "Healthcare",
  "auto": "Consumer Cyclical",
  "automobiles": "Consumer Cyclical",
  "consumer discretionary": "Consumer Cyclical",
  "retail": "Consumer Cyclical",
  "fmcg": "Consumer Staples",
  "infrastructure": "Industrials",
  "defense": "Industrials",
  "aerospace & defense": "Industrials",
  "construction": "Industrials",
  "power": "Utilities",
  "electric utilities": "Utilities",
  "metals": "Materials",
  "metals & mining": "Materials",
  "mining": "Materials",
  "steel": "Materials",
  "chemicals": "Materials",
  "telecom": "Communication Services",
  "telecommunications": "Communication Services",
  "media": "Communication Services",
  "oil & gas": "Energy",
  "oil and gas": "Energy",
  "reits": "Real Estate",
  "property": "Real Estate",
};

const CANONICAL_LOOKUP = new Map(GICS_SECTORS.map((s) => [s.toLowerCase(), s]));

/**
 * Resolve any sector label to its canonical GICS-11 name, or null when it
 * cannot be resolved. Null means null — callers must fail closed (render
 * without the joined data), never guess a sector.
 */
export function canonicalizeSector(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return CANONICAL_LOOKUP.get(key) ?? LEGACY_SECTOR_MAP[key] ?? null;
}
