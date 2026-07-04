import type { CompositeScores, StockMetrics } from "./types";
import { sectorGroup } from "./sector";
import type { SectorGroup } from "./sector";

/**
 * Proprietary composite scores (0-100). Each raw metric is normalized to a
 * 0-100 sub-score against an absolute, investing-sensible scale (so a score is
 * comparable over time, not just within one screen), then averaged within its
 * dimension. The Overall score is a weighted blend of the dimensions.
 *
 * Scoring thresholds are sector-aware: Financials, Utilities, and REITs have
 * structurally different economics and would be misevaluated by one-size-fits-all
 * thresholds calibrated for general/tech companies.
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

/* -------------------------------------------------------------------------- */
/* Sector-aware sub-scorers                                                    */
/* -------------------------------------------------------------------------- */

export function valueScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  if (sg === "utilities") {
    // Utilities trade at premium P/E due to stability; 18x is fairly valued, not expensive
    return blend([
      norm(m.forwardPE, 30, 12),
      norm(m.evToEbitda, 20, 8),
      norm(m.fcfYield, 0, 6),
    ]);
  }
  if (sg === "financials") {
    // P/E and EV/EBITDA aren't reliable for banks — rely on FCF yield and book value
    return blend([
      norm(m.forwardPE, 20, 8),
      norm(m.fcfYield, 0, 6),
    ]);
  }
  if (sg === "reits") {
    // REITs valued on income/yield; FCF yield and dividend yield matter most
    return blend([
      norm(m.forwardPE, 35, 12),
      norm(m.fcfYield, 0, 7),
      norm(m.dividendYield, 0, 6),
    ]);
  }
  // default — general/tech/consumer/industrials
  return blend([
    norm(m.forwardPE, 40, 8),
    norm(m.evToEbitda, 22, 5),
    norm(m.fcfYield, 0, 8),
  ]);
}

export function growthScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  if (sg === "utilities") {
    // Regulated utilities grow revenue at 2-5%; 8% is exceptional, not mediocre
    return blend([
      norm(m.revenueGrowthYoY, -2, 8),
      norm(m.revenueCagr3y, -1, 6),
      norm(m.epsGrowthYoY, -5, 10),
      norm(m.epsCagr3y, -2, 8),
    ]);
  }
  if (sg === "reits") {
    // REITs grow via acquisitions + rent increases; 10% revenue growth is strong
    return blend([
      norm(m.revenueGrowthYoY, -2, 12),
      norm(m.revenueCagr3y, -1, 9),
      norm(m.epsGrowthYoY, -5, 15),
      norm(m.epsCagr3y, -2, 10),
    ]);
  }
  if (sg === "financials") {
    // Bank revenue growth is modest; 10% is very strong for a well-run bank
    return blend([
      norm(m.revenueGrowthYoY, -2, 12),
      norm(m.revenueCagr3y, -1, 8),
      norm(m.epsGrowthYoY, -5, 15),
      norm(m.epsCagr3y, -2, 10),
    ]);
  }
  // default
  return blend([
    norm(m.revenueGrowthYoY, 0, 25),
    norm(m.revenueCagr3y, 0, 20),
    norm(m.epsGrowthYoY, 0, 30),
    norm(m.epsCagr3y, 0, 25),
  ]);
}

export function qualityScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  if (sg === "financials") {
    // Gross margin is not meaningful for banks; ROE is the key quality signal
    // Banks targeting 10-15% ROE; 18%+ is excellent
    return blend([
      norm(m.roe, 5, 18),
      norm(m.operatingMargin, 10, 40),
      norm(m.fcfMargin, 2, 20),
    ]);
  }
  if (sg === "utilities") {
    // Utilities have regulated, stable margins; 20% op margin is solid
    return blend([
      norm(m.roic, 3, 12),
      norm(m.roe, 5, 14),
      norm(m.operatingMargin, 8, 25),
      norm(m.fcfMargin, 2, 18),
    ]);
  }
  if (sg === "reits") {
    // REITs distribute most earnings; ROE and margins differ from industrials
    return blend([
      norm(m.roe, 3, 15),
      norm(m.operatingMargin, 10, 45),
      norm(m.fcfMargin, 5, 30),
    ]);
  }
  // default
  return blend([
    norm(m.roic, 5, 25),
    norm(m.roe, 5, 30),
    norm(m.grossMargin, 20, 70),
    norm(m.operatingMargin, 5, 30),
    norm(m.fcfMargin, 2, 25),
  ]);
}

export function financialHealthScore(m: ScorableMetrics): number | null {
  const sg = sectorGroup(m.sector);
  if (sg === "financials") {
    // Banks are inherently leveraged (deposits = debt); D/E of 8-12x is normal.
    // Use a wide range and only penalize extreme outliers.
    // Current ratio is not meaningful for banks; skip it.
    return blend([
      norm(m.debtToEquity, 20, 4),      // 4x = well-run bank, 20x = systemic risk
      norm(m.netDebtToEbitda, 15, 2),   // relative to earnings power
    ]);
  }
  if (sg === "utilities") {
    // Utilities carry debt to fund infrastructure; 3x D/E is standard
    return blend([
      norm(m.debtToEquity, 4, 0.5),
      norm(m.netDebtToEbitda, 8, 2),
      norm(m.currentRatio, 0.8, 1.8),
    ]);
  }
  if (sg === "reits") {
    // REITs are capital-intensive but regulated; 2-3x D/E is typical
    return blend([
      norm(m.debtToEquity, 4, 0.5),
      norm(m.netDebtToEbitda, 10, 3),
      norm(m.currentRatio, 0.8, 2),
    ]);
  }
  // default
  return blend([
    norm(m.debtToEquity, 2, 0.1),
    norm(m.netDebtToEbitda, 4, 0),
    norm(m.currentRatio, 0.8, 2.5),
  ]);
}

export function momentumScore(m: ScorableMetrics): number | null {
  // Momentum is sector-agnostic — price performance relative to history
  return blend([
    norm(m.oneYearReturn, -25, 40),
    norm(m.distanceFrom52WkHigh, -50, -2),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Composite                                                                   */
/* -------------------------------------------------------------------------- */

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
