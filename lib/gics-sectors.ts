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
