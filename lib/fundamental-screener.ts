import type {
  FundamentalScreenerCriteria,
  Range,
  StockMetrics,
} from "./types";

/**
 * Pure filter/sort engine for the fundamental screener. Operates on the
 * already-assembled metrics, so it's fully unit-testable without any data
 * fetching. A filter on a metric the company is missing excludes it (you can't
 * confirm an unknown value passes a threshold).
 */

/** Accessor for every filterable/sortable numeric field. */
export const FIELD: Record<string, (m: StockMetrics) => number | null> = {
  marketCap: (m) => m.marketCap,
  forwardPE: (m) => m.forwardPE,
  evToEbitda: (m) => m.evToEbitda,
  fcfYield: (m) => m.fcfYield,
  revenueGrowthYoY: (m) => m.revenueGrowthYoY,
  revenueCagr3y: (m) => m.revenueCagr3y,
  epsGrowthYoY: (m) => m.epsGrowthYoY,
  epsCagr3y: (m) => m.epsCagr3y,
  roic: (m) => m.roic,
  roe: (m) => m.roe,
  grossMargin: (m) => m.grossMargin,
  operatingMargin: (m) => m.operatingMargin,
  debtToEquity: (m) => m.debtToEquity,
  netDebtToEbitda: (m) => m.netDebtToEbitda,
  currentRatio: (m) => m.currentRatio,
  fcfMargin: (m) => m.fcfMargin,
  fcfGrowthYoY: (m) => m.fcfGrowthYoY,
  dividendYield: (m) => m.dividendYield,
  buybackYield: (m) => m.buybackYield,
  oneYearReturn: (m) => m.oneYearReturn,
  distanceFrom52WkHigh: (m) => m.distanceFrom52WkHigh,
  institutionalOwnership: (m) => m.institutionalOwnership,
  earningsSurprisePct: (m) => m.earningsSurprisePct,
  valueScore: (m) => m.scores.value,
  growthScore: (m) => m.scores.growth,
  qualityScore: (m) => m.scores.quality,
  financialHealthScore: (m) => m.scores.financialHealth,
  overallScore: (m) => m.scores.overall,
};

const RANGE_KEYS = Object.keys(FIELD) as (keyof FundamentalScreenerCriteria)[];

function inRange(value: number | null, range: Range | undefined): boolean {
  if (!range || (range.min == null && range.max == null)) return true;
  if (value == null) return false; // an active filter excludes unknown values
  if (range.min != null && value < range.min) return false;
  if (range.max != null && value > range.max) return false;
  return true;
}

export function applyScreen(
  metrics: StockMetrics[],
  criteria: FundamentalScreenerCriteria,
): StockMetrics[] {
  const filtered = metrics.filter((m) => {
    if (criteria.sector && (m.sector ?? "").toLowerCase() !== criteria.sector.toLowerCase()) {
      return false;
    }
    if (
      criteria.industry &&
      !(m.industry ?? "").toLowerCase().includes(criteria.industry.toLowerCase())
    ) {
      return false;
    }
    for (const key of RANGE_KEYS) {
      const range = criteria[key] as Range | undefined;
      if (range && !inRange(FIELD[key](m), range)) return false;
    }
    return true;
  });

  const sortField = criteria.sortField && FIELD[criteria.sortField] ? criteria.sortField : "overallScore";
  const dir = criteria.sortDir === "asc" ? 1 : -1;
  const get = FIELD[sortField];
  filtered.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    // Nulls always sink to the bottom regardless of sort direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });
  return filtered;
}

/* -------------------------------------------------------------------------- */
/* Criteria parsing                                                           */
/* -------------------------------------------------------------------------- */

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function parseRange(v: unknown): Range | undefined {
  if (v == null || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const min = numOrNull(o.min);
  const max = numOrNull(o.max);
  if (min == null && max == null) return undefined;
  return { min, max };
}

/** Normalize a raw request body into typed criteria. */
export function parseFundamentalCriteria(
  body: Record<string, unknown>,
): FundamentalScreenerCriteria {
  const filters = (body.filters as Record<string, unknown>) ?? {};
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim() : null;

  const criteria: FundamentalScreenerCriteria = {
    sector: str(body.sector),
    industry: str(body.industry),
    sortField: str(body.sortField),
    sortDir: body.sortDir === "asc" ? "asc" : body.sortDir === "desc" ? "desc" : null,
  };
  for (const key of RANGE_KEYS) {
    const range = parseRange(filters[key]);
    if (range) (criteria[key] as Range) = range;
  }
  return criteria;
}
