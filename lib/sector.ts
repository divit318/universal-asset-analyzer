/**
 * Shared sector classification utility.
 *
 * Maps Yahoo Finance sector strings to a broad group so scoring functions
 * can apply appropriate thresholds. Financials/banks carry structural
 * leverage; utilities grow slowly by regulatory design; REITs distribute
 * most income. Everything else uses the default growth/tech scales.
 */

export type SectorGroup = "financials" | "utilities" | "reits" | "default";

export function sectorGroup(sector: string | null | undefined): SectorGroup {
  if (!sector) return "default";
  const s = sector.toLowerCase();
  if (
    s === "financials" ||
    s === "financial services" ||
    s.includes("bank") ||
    s.includes("insurance") ||
    s.includes("capital markets") ||
    s.includes("asset management")
  ) return "financials";
  if (s.includes("utilit")) return "utilities";
  if (s === "real estate" || s.includes("reit")) return "reits";
  return "default";
}
