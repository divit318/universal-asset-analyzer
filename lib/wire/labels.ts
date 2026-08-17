/**
 * Honest-precision labels for model-asserted numbers.
 *
 * The pipeline's per-idea "confidence" is an LLM self-report (company-impact
 * match confidence, or the thesis model's own number, or a hardcoded 55
 * fallback) — not a calibrated probability. Rendering "68% confidence"
 * implies a methodology that does not exist. These helpers map those numbers
 * to coarse tiers, and corroboration counts to evidence language, so the UI
 * claims exactly as much as the data supports.
 */

export type ModelReadTier = "high" | "moderate" | "low";

/** Coarse tier for an LLM-asserted 0-100 confidence. Null when absent. */
export function modelReadTier(confidence: number | null | undefined): ModelReadTier | null {
  if (confidence == null || !Number.isFinite(confidence)) return null;
  if (confidence >= 75) return "high";
  if (confidence >= 55) return "moderate";
  return "low";
}

export const MODEL_READ_LABEL: Record<ModelReadTier, string> = {
  high: "Model read: high",
  moderate: "Model read: moderate",
  low: "Model read: low",
};

export const MODEL_READ_TITLE =
  "The model's own estimate of this call, in coarse tiers — it is not a calibrated probability. Corroborate via the source articles.";

/** Corroboration language for an N-outlet story/event. */
export function corroborationLabel(sourceCount: number): string {
  if (sourceCount <= 1) return "single source";
  return `${sourceCount} sources`;
}

/** True when a claim rests on one outlet and should carry the warning tint. */
export function isUncorroborated(sourceCount: number): boolean {
  return sourceCount <= 1;
}
