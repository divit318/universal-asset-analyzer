import { AllocationDiffChart } from "../allocation-diff-chart";
import type { PreviewResponse } from "./use-preview";

/**
 * Portfolio Diff (Feature 13) — current vs. projected asset-class allocation
 * for the current trade selection. Thin adapter over the shared
 * AllocationDiffChart (also used by the Cash tab's deployment plan); only
 * asset classes that actually change weight are shown, so a 20-class
 * portfolio doesn't drown the two or three that matter for this selection.
 */
export function PortfolioDiffChart({ preview }: { preview: PreviewResponse | null }) {
  if (!preview) return null;
  return <AllocationDiffChart before={preview.before.allocation} after={preview.after.allocation} />;
}
