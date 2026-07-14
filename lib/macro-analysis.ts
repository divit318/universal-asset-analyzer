/**
 * Yield curve analysis — the honest, buildable slice of "Fixed Income"
 * research given real data constraints: Yahoo has no individual bond
 * pricing (no CUSIPs, no corporate bond feed), only Treasury *yield*
 * indices (^IRX/^FVX/^TNX/^TYX, quoteType INDEX). Those are economic
 * indicators, not tradeable positions, so — like lib/derivatives-analysis.ts
 * — this deliberately produces no 0-100 "should I buy this" score. A yield
 * curve doesn't have a BUY/SELL call; it has a shape and a direction.
 *
 * Pure computation — the actual Yahoo fetch (current levels + history for
 * the trend) lives in the API route, mirroring how commodity/forex-scoring
 * keep their scorers pure and let the route/engine do I/O.
 */

export const YIELD_CURVE_SYMBOLS = {
  threeMonth: "^IRX",
  fiveYear: "^FVX",
  tenYear: "^TNX",
  thirtyYear: "^TYX",
} as const;

export interface YieldCurvePoint {
  tenor: string; // "3M" | "5Y" | "10Y" | "30Y"
  label: string;
  symbol: string;
  yieldPercent: number | null;
}

export interface MacroSummary {
  curve: YieldCurvePoint[];
  /** Percentage points, 10-year minus 3-month — the spread the NY Fed's own
   *  recession-probability model uses, arguably more predictive than 10y-2y. */
  tenYearMinusThreeMonth: number | null;
  shape: "normal" | "flat" | "inverted" | null;
  /** vs the same spread ~20 trading days ago. */
  curveTrend: "steepening" | "flattening" | "stable" | null;
}

export interface YieldLevels {
  threeMonth: number | null;
  fiveYear: number | null;
  tenYear: number | null;
  thirtyYear: number | null;
}

export function computeMacroSummary(levels: YieldLevels, spreadNDaysAgo: number | null): MacroSummary {
  const curve: YieldCurvePoint[] = [
    { tenor: "3M", label: "13-Week", symbol: YIELD_CURVE_SYMBOLS.threeMonth, yieldPercent: levels.threeMonth },
    { tenor: "5Y", label: "5-Year", symbol: YIELD_CURVE_SYMBOLS.fiveYear, yieldPercent: levels.fiveYear },
    { tenor: "10Y", label: "10-Year", symbol: YIELD_CURVE_SYMBOLS.tenYear, yieldPercent: levels.tenYear },
    { tenor: "30Y", label: "30-Year", symbol: YIELD_CURVE_SYMBOLS.thirtyYear, yieldPercent: levels.thirtyYear },
  ];

  const spread = levels.tenYear != null && levels.threeMonth != null ? levels.tenYear - levels.threeMonth : null;

  const shape: MacroSummary["shape"] =
    spread == null ? null : spread < 0 ? "inverted" : spread < 0.25 ? "flat" : "normal";

  let curveTrend: MacroSummary["curveTrend"] = null;
  if (spread != null && spreadNDaysAgo != null) {
    const diff = spread - spreadNDaysAgo;
    curveTrend = diff > 0.1 ? "steepening" : diff < -0.1 ? "flattening" : "stable";
  }

  return { curve, tenYearMinusThreeMonth: spread, shape, curveTrend };
}
