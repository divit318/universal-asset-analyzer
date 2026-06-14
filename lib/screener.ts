import type { ScreenerCriteria, ScreenerRow } from "./types";

/**
 * Apply screener criteria to a set of rows. Pure and order-preserving so it can
 * be unit-tested independently of any data fetching.
 */
export function applyFilters(
  rows: ScreenerRow[],
  criteria: ScreenerCriteria,
): ScreenerRow[] {
  return rows.filter((row) => {
    if (
      criteria.sector &&
      row.sector.toLowerCase() !== criteria.sector.toLowerCase()
    ) {
      return false;
    }
    if (criteria.minPrice != null && row.price < criteria.minPrice) return false;
    if (criteria.maxPrice != null && row.price > criteria.maxPrice) return false;
    if (
      criteria.minChangePercent != null &&
      row.changePercent < criteria.minChangePercent
    ) {
      return false;
    }
    if (
      criteria.maxChangePercent != null &&
      row.changePercent > criteria.maxChangePercent
    ) {
      return false;
    }
    if (
      criteria.minMarketCap != null &&
      (row.marketCap == null || row.marketCap < criteria.minMarketCap)
    ) {
      return false;
    }
    return true;
  });
}

/** Normalize a raw query/JSON criteria object into typed, bounded numbers. */
export function parseCriteria(input: Record<string, unknown>): ScreenerCriteria {
  const num = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  return {
    sector: str(input.sector),
    minPrice: num(input.minPrice),
    maxPrice: num(input.maxPrice),
    minChangePercent: num(input.minChangePercent),
    maxChangePercent: num(input.maxChangePercent),
    minMarketCap: num(input.minMarketCap),
  };
}
