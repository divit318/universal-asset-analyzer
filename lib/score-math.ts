/**
 * Score normalization primitive — the single clamp-lerp both scoring engines
 * share.
 *
 * `lib/composite.ts` (batch screen scorer) and `lib/scoring.ts` (single-name
 * decision engine) each previously carried their own copy of this mapping.
 * They are the same math; keeping one implementation means a metric is placed
 * on the 0→max scale identically no matter which engine scores it.
 *
 * Pure, zero-dependency, client-safe.
 */

/**
 * Map `value` from `worst`→0 to `best`→`max`, clamped to [0, max]. `best` may be
 * less than `worst` (lower-is-better metrics like P/E or debt). Assumes a
 * present value — callers that may pass null should use {@link norm}.
 */
export function lerp(value: number, worst: number, best: number, max: number): number {
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(1, t)) * max;
}

/**
 * Nullable 0–100 variant: returns null for absent/NaN input so a dimension can
 * distinguish "scored 0" from "no data". Used by the batch dimensional scorer.
 */
export function norm(value: number | null | undefined, worst: number, best: number): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return lerp(value, worst, best, 100);
}
