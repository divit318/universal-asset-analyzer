/**
 * Score normalization + factor/bucket-building primitives shared by every
 * per-name decision scorer (equity, fund, ...future asset classes).
 *
 * `lib/composite.ts` (batch screen scorer) and `lib/scoring.ts` (equity
 * single-name decision engine) each previously carried their own copy of the
 * clamp-lerp math; `mk()`/`bucket()` were later promoted here too from
 * lib/scoring.ts so lib/fund-scoring.ts (and any future per-asset-class
 * scorer) can build its ScoreBucket/ScoreFactor output the same way instead
 * of reimplementing it. Same math in one place means a metric lands on the
 * 0→max scale identically no matter which engine scores it.
 *
 * Pure, zero-dependency (types only), client-safe.
 */

import type { ScoreBucket, ScoreFactor } from "./types";

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

/* -------------------------------------------------------------------------- */
/* Factor/bucket builders                                                     */
/* -------------------------------------------------------------------------- */

export interface FactorResult {
  factor: ScoreFactor;
  hasData: boolean;
}

/**
 * Build one scored factor via `lerp`; missing data yields half credit and is
 * flagged via `hasData: false` / `detail: "n/a"` rather than zeroing out a
 * bucket just because one input is absent. Originally lib/scoring.ts-only;
 * promoted here so any per-name decision scorer (equity, fund, ...) can build
 * its ScoreBucket/ScoreFactor output the same way instead of reimplementing
 * this pattern per asset class.
 */
export function mk(
  label: string,
  value: number | null | undefined,
  worst: number,
  best: number,
  max: number,
  detail: (v: number) => string,
): FactorResult {
  if (value == null || Number.isNaN(value)) {
    return { factor: { label, points: Math.round(max * 0.5), max, detail: "n/a" }, hasData: false };
  }
  return {
    factor: { label, points: Math.round(lerp(value, worst, best, max)), max, detail: detail(value) },
    hasData: true,
  };
}

/** Sum a list of factors into one named ScoreBucket, tracking how many had real data. */
export function bucket(name: string, results: FactorResult[]): {
  bucket: ScoreBucket;
  dataCount: number;
  total: number;
} {
  const factors = results.map((r) => r.factor);
  const points = factors.reduce((s, f) => s + f.points, 0);
  const max = factors.reduce((s, f) => s + f.max, 0);
  return {
    bucket: { name, points, max, factors },
    dataCount: results.filter((r) => r.hasData).length,
    total: results.length,
  };
}
