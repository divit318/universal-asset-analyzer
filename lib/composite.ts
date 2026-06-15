import type { CompositeScores, StockMetrics } from "./types";

/**
 * Proprietary composite scores (0-100). Each raw metric is normalized to a
 * 0-100 sub-score against an absolute, investing-sensible scale (so a score is
 * comparable over time, not just within one screen), then averaged within its
 * dimension. The Overall score is a weighted blend of the dimensions.
 *
 * Pure and deterministic — fully unit-testable without any network data.
 */

/** Map `value` from `worst`→0 to `best`→100, clamped. `best` may be < `worst`. */
function norm(value: number | null, worst: number, best: number): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const t = (value - worst) / (best - worst);
  return Math.max(0, Math.min(1, t)) * 100;
}

/** Average the present sub-scores; null if fewer than `min` are available. */
function blend(parts: (number | null)[], min = 1): number | null {
  const present = parts.filter((p): p is number => p != null);
  if (present.length < min) return null;
  return Math.round(present.reduce((s, p) => s + p, 0) / present.length);
}

/** The metric fields the scores read (everything on StockMetrics bar the scores). */
export type ScorableMetrics = Omit<StockMetrics, "scores">;

export function valueScore(m: ScorableMetrics): number | null {
  return blend([
    norm(m.forwardPE, 40, 8), // cheaper P/E → higher
    norm(m.evToEbitda, 22, 5), // cheaper EV/EBITDA → higher
    norm(m.fcfYield, 0, 8), // richer FCF yield → higher
  ]);
}

export function growthScore(m: ScorableMetrics): number | null {
  return blend([
    norm(m.revenueGrowthYoY, 0, 25),
    norm(m.revenueCagr3y, 0, 20),
    norm(m.epsGrowthYoY, 0, 30),
    norm(m.epsCagr3y, 0, 25),
  ]);
}

export function qualityScore(m: ScorableMetrics): number | null {
  return blend([
    norm(m.roic, 5, 25),
    norm(m.roe, 5, 30),
    norm(m.grossMargin, 20, 70),
    norm(m.operatingMargin, 5, 30),
    norm(m.fcfMargin, 2, 25),
  ]);
}

export function financialHealthScore(m: ScorableMetrics): number | null {
  return blend([
    norm(m.debtToEquity, 2, 0.1), // less leverage → higher
    norm(m.netDebtToEbitda, 4, 0), // less net debt → higher (net cash clamps to 100)
    norm(m.currentRatio, 0.8, 2.5), // more liquidity → higher
  ]);
}

export function momentumScore(m: ScorableMetrics): number | null {
  return blend([
    norm(m.oneYearReturn, -25, 40),
    norm(m.distanceFrom52WkHigh, -50, -2), // nearer the high → higher
  ]);
}

const WEIGHTS: [keyof CompositeScores, number][] = [
  ["quality", 0.28],
  ["value", 0.24],
  ["growth", 0.24],
  ["financialHealth", 0.18],
  ["momentum", 0.06],
];

export function computeScores(m: ScorableMetrics): CompositeScores {
  const value = valueScore(m);
  const growth = growthScore(m);
  const quality = qualityScore(m);
  const financialHealth = financialHealthScore(m);
  const momentum = momentumScore(m);
  const dims: CompositeScores = { value, growth, quality, financialHealth, momentum, overall: null };

  // Overall: weighted blend of whichever dimensions are available (weights
  // renormalize so a missing dimension doesn't drag the score toward zero).
  const present = WEIGHTS.filter(([k]) => dims[k] != null);
  const wSum = present.reduce((s, [, w]) => s + w, 0);
  dims.overall = wSum
    ? Math.round(present.reduce((s, [k, w]) => s + (dims[k] as number) * w, 0) / wSum)
    : null;

  return dims;
}
