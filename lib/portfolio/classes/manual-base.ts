/**
 * Bridge from the Universal Holdings Model to the manual-asset engines that
 * ALREADY EXIST in lib/manual-asset-analysis.ts.
 *
 * Those engines (cap rate, cash-on-cash, MOIC, barrier distance, payoff curves)
 * are written, tested and correct — they were simply never reachable from the
 * Portfolio, which is the whole bug. lib/types.ts:1096 says so out loud:
 * "Standalone from Portfolio's aggregate analytics for now."
 *
 * So we do not reimplement a single formula here. We reconstruct the `ManualAsset`
 * shape those functions expect from a RawHolding and call straight through.
 */

import type { ManualAsset, ManualAssetCategory } from "../../types";
import type { RawHolding } from "../model/types";

/**
 * A RawHolding sourced from the `manual_asset` table carries the original
 * ManualAsset `details` blob in `meta`. Rebuild the ManualAsset so the existing
 * engines can be called unmodified.
 */
export function toManualAsset<C extends ManualAssetCategory>(
  raw: RawHolding,
  category: C,
): ManualAsset & { category: C } {
  return {
    id: raw.id,
    name: raw.name,
    acquisitionDate: raw.acquiredAt,
    acquisitionCost: raw.costBasis,
    currentValue: raw.manualValue,
    currentValueAsOf: raw.manualValueAsOf,
    notes: null,
    createdAt: raw.acquiredAt,
    updatedAt: raw.manualValueAsOf ?? raw.acquiredAt,
    category,
    // The details blob round-trips through meta untouched.
    details: raw.meta.details,
  } as ManualAsset & { category: C };
}

/**
 * Staleness bounds for manually-entered valuations, in days.
 *
 * These are not arbitrary. A self-reported value that has not been revisited in
 * this long stops being evidence and starts being an anchor — and an anchor that
 * silently sizes every allocation percentage in the portfolio. Past the bound the
 * holding is flagged `stale`, its score confidence is discounted, and the UI says
 * so rather than presenting a three-year-old number next to a live quote as
 * though they were the same kind of fact.
 */
export const MANUAL_STALENESS_DAYS: Record<ManualAssetCategory, number> = {
  // Property revalues slowly, but a year-old estimate is genuinely dated.
  real_estate: 365,
  // Marks move at funding rounds; 18 months without one is a real signal.
  private_market: 548,
  // Collectibles are thinly traded; two years between marks is normal.
  alternative: 730,
  // Value is model-derived from live underlyings, so it never goes stale this way.
  structured_product: 3650,
};
