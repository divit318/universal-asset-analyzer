/**
 * Metric semantics for the Compare page: best/worst highlight resolution,
 * explicit metric direction, and sector-aware applicability.
 *
 * Pure and client-safe (types + lib/sector.ts only) so the page component and
 * the API route share ONE definition of "which cells are best/worst" and
 * "does this metric mean anything for this sector" — previously the route
 * happily benchmarked a bank's 0.0% gross margin against a sector average.
 */

import { sectorGroup } from "../sector";

/* -------------------------------------------------------------------------- */
/* Direction                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every comparable metric declares its direction explicitly. `neutral`
 * metrics (counts, descriptive stats like "# Analysts") never receive a
 * best/worst treatment — there is no "winning" number of analysts.
 */
export type MetricDirection = "higher_is_better" | "lower_is_better" | "neutral";

/* -------------------------------------------------------------------------- */
/* Best/worst highlight resolution                                            */
/* -------------------------------------------------------------------------- */

export interface RowHighlights {
  /** Indices of ALL cells tied at the best extreme. */
  best: number[];
  /** Indices of ALL cells tied at the worst extreme. */
  worst: number[];
}

/**
 * Resolve which cells in a row get the best and worst treatment.
 *
 * Rules:
 * - `neutral` metrics get no highlight at all.
 * - Fewer than two non-null values: no highlight (nothing to compare).
 * - Ties at an extreme highlight EVERY tied cell, not none of them.
 * - Ties are judged at DISPLAY precision (via `format`): two debt/equity
 *   ratios that both render "0.6x" must both be green — highlighting one and
 *   not the other on a difference the user cannot see reads as a bug.
 * - When best and worst are indistinguishable at display precision (all
 *   values render identically), the row is skipped entirely.
 * - Null/unavailable cells are never eligible.
 */
export function resolveRowHighlights(
  values: (number | null)[],
  direction: MetricDirection,
  format: (v: number) => string,
): RowHighlights | null {
  if (direction === "neutral") return null;
  const valid = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  if (valid.length < 2) return null;

  const nums = valid.map((x) => x.v);
  const higher = direction === "higher_is_better";
  const bestVal = higher ? Math.max(...nums) : Math.min(...nums);
  const worstVal = higher ? Math.min(...nums) : Math.max(...nums);

  const bestKey = format(bestVal);
  const worstKey = format(worstVal);
  if (bestKey === worstKey) return null; // all values identical on screen

  return {
    best: valid.filter((x) => format(x.v) === bestKey).map((x) => x.i),
    worst: valid.filter((x) => format(x.v) === worstKey).map((x) => x.i),
  };
}

/* -------------------------------------------------------------------------- */
/* Sector applicability                                                       */
/* -------------------------------------------------------------------------- */

export type MetricApplicability =
  | { applicable: true }
  | { applicable: false; reason: string };

/**
 * Metrics that carry no meaning for lenders. A bank's income statement has no
 * cost-of-goods line, its balance sheet is structurally leveraged deposits,
 * and its cash flow embeds loan-book flows — so these render as provider
 * zeros/nulls that must never be scored, benchmarked, or highlighted.
 * Mirrors the same judgment lib/scoring.ts already applies inside its
 * sector-aware buckets (gross margin and current ratio dropped for banks,
 * FCF/NI dropped for lenders).
 */
const FINANCIALS_NOT_APPLICABLE: Record<string, string> = {
  grossMargin: "Banks have no cost-of-goods line, so gross margin is undefined for lenders.",
  ebitdaMargin: "EBITDA is not meaningful for a bank — interest is both its core revenue and its core cost.",
  netDebtToEbitda: "Banks have no EBITDA line, so debt cannot be expressed in years of EBITDA.",
  currentRatio: "A bank's deposits are current liabilities by design — current ratio does not measure its liquidity.",
  quickRatio: "A bank's deposits are current liabilities by design — quick ratio does not measure its liquidity.",
  fcfYield: "A lender's cash flow embeds loan-book in/outflows, so free cash flow is not a meaningful valuation basis.",
  fcfCagr3y: "A lender's cash flow embeds loan-book in/outflows, so free-cash-flow growth is not meaningful.",
};

/**
 * Whether a metric is meaningful for an asset in the given sector.
 * `metricId` is the stable metric identifier from the Compare registry
 * (matches the benchmark key where one exists).
 */
export function metricApplicability(
  metricId: string,
  sector: string | null | undefined,
): MetricApplicability {
  if (sectorGroup(sector) === "financials") {
    const reason = FINANCIALS_NOT_APPLICABLE[metricId];
    if (reason) return { applicable: false, reason };
  }
  return { applicable: true };
}

/**
 * Some providers report a hard 0 where they mean "not reported" (Yahoo sends
 * grossMargins: 0 / ebitdaMargins: 0 for every bank). For ratio metrics where
 * a literal zero is economically implausible, treat provider zero as missing
 * rather than rendering fabricated precision ("0.0% · 18th pct").
 */
export function zeroAsMissing(value: number | null | undefined): number | null {
  if (value == null || value === 0) return null;
  return value;
}
