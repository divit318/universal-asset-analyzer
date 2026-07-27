/**
 * Deterministic per-class risk flags for the Compare framework — reuses each
 * asset class's own `warnings` array (lib/assets/*.ts) exactly as declared,
 * the same set lib/screener/explain.ts evaluates for the Screener. No new
 * flags are invented here; this just runs the existing tests against the
 * symbols being compared instead of a screened universe.
 */

import { getAssetClass } from "../assets/registry";
import type { AssetClassId } from "../assets/types";

export interface ClassRiskFlag {
  id: string;
  label: string;
}

export function computeClassRiskFlags(
  assetClass: AssetClassId,
  metrics: Record<string, number | null>,
  attributes: Record<string, string | null>,
): ClassRiskFlag[] {
  const def = getAssetClass(assetClass);
  return def.warnings
    .filter((w) => {
      try {
        return w.test(metrics, attributes);
      } catch {
        return false; // a flag that throws on odd data must not take down the compare
      }
    })
    .map((w) => ({ id: w.id, label: w.label }));
}
