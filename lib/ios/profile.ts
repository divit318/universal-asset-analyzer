/**
 * IOS Profile Builder — derives InvestmentProfile from a portfolio report.
 *
 * Pure function, no network I/O, no side effects.
 *
 * There is ONE portfolio engine: `UniversalPortfolioReport` (lib/portfolio/report.ts).
 * The legacy equity-only `PortfolioReport` and its `fromLegacyReport` adapter are
 * gone — server and client now build this profile from the same report, so a "fit"
 * badge in the Wire is scored against exactly the portfolio the Portfolio page shows.
 *
 * buildInvestmentProfile still consumes a small normalized `IOSReportInput` rather
 * than the report itself: that is what keeps this file independent of the report's
 * shape, and it is a projection, not a second engine.
 */

import type { PortfolioObjective, PortfolioConstraints } from "./types";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type {
  InvestmentProfile,
  BehavioralSignals,
  SectorWeight,
  StyleWeights,
  MarketCapWeights,
} from "./types";
import { EMPTY_PROFILE, DEFAULT_BEHAVIORAL } from "./types";

/* -------------------------------------------------------------------------- */
/* Normalized input — the only shape buildInvestmentProfile understands       */
/* -------------------------------------------------------------------------- */

export interface IOSReportInput {
  totalValue: number;
  positionCount: number;
  holdingSymbols: string[];
  sectorWeights: SectorWeight[];
  styleWeights: StyleWeights;
  marketCapWeights: MarketCapWeights;
  hhi: number;
  healthScore: number;
  annualizedVolatility: number | null;
  beta: number | null;
}

/* -------------------------------------------------------------------------- */
/* Known S&P 500 sectors (for gap detection)                                  */
/* -------------------------------------------------------------------------- */

// Yahoo Finance's sector taxonomy — must match the names on both the portfolio's
// sectorAllocation and each asset's `sector`, since every sector string in the
// app originates from Yahoo. Using GICS names here (e.g. "Financials",
// "Materials") silently broke missing/underweight/overweight detection because
// they never matched Yahoo's "Financial Services" / "Basic Materials".
const ALL_SECTORS = [
  "Technology",
  "Healthcare",
  "Financial Services",
  "Consumer Cyclical",
  "Consumer Defensive",
  "Industrials",
  "Communication Services",
  "Energy",
  "Basic Materials",
  "Real Estate",
  "Utilities",
];

/* -------------------------------------------------------------------------- */
/* Adapter: UniversalPortfolioReport → IOSReportInput                         */
/* -------------------------------------------------------------------------- */

/**
 * Bucket by market cap using the real per-holding value the universal engine
 * already captures (equity/etf/reit/crypto adapters expose `metrics.marketCap`).
 * A holding with no known market cap (bonds, commodities, manual assets) is
 * excluded from the bucketing rather than guessed into "large" — unlike the
 * legacy adapter above, we now actually HAVE the field, so there's no reason to
 * fall back to the old conservative default for classes that report it.
 */
function marketCapWeightsFromHoldings(
  holdings: UniversalPortfolioReport["holdings"],
  totalValue: number,
): MarketCapWeights {
  if (totalValue <= 0) return { large: 0, mid: 0, small: 0 };

  let large = 0, mid = 0, small = 0;
  for (const h of holdings) {
    const cap = h.metrics.marketCap;
    if (cap == null) continue;
    const v = h.valuation.valueBase;
    if (cap >= 10e9) large += v;
    else if (cap >= 2e9) mid += v;
    else small += v;
  }
  return {
    large: Math.round((large / totalValue) * 100),
    mid: Math.round((mid / totalValue) * 100),
    small: Math.round((small / totalValue) * 100),
  };
}

/**
 * Style tilts from the universal engine's per-holding metrics.
 *
 * The universal engine does not compute equity-style tilts (growth/value/momentum/
 * quality/income scored -100..+100 by sector) — it computes macro FACTOR exposure
 * instead (rates/inflation/credit/…), a different and non-comparable concept. Rather
 * than force one into the other, this derives an honest value-weighted read from the
 * metrics actually available on equity-like holdings, and — following the same
 * "abstain, don't fabricate" rule as the rest of the universal engine — falls back
 * to neutral 50 for any tilt with no evidence, which scoreStyle() in fit-scorer.ts
 * already treats correctly as "no meaningful tilt, no adjustment".
 */
function styleWeightsFromHoldings(holdings: UniversalPortfolioReport["holdings"]): StyleWeights {
  const weighted = (
    pick: (h: UniversalPortfolioReport["holdings"][number]) => number | null,
    worst: number,
    best: number,
  ): number => {
    let num = 0, den = 0;
    for (const h of holdings) {
      const v = pick(h);
      if (v == null) continue;
      const t = (v - worst) / (best - worst);
      const score = Math.max(0, Math.min(100, t * 100));
      num += score * h.valuation.valueBase;
      den += h.valuation.valueBase;
    }
    return den > 0 ? Math.round(num / den) : 50;
  };

  return {
    growth: weighted((h) => h.metrics.revenueGrowth ?? null, -0.10, 0.30),
    // Lower P/E = more value-tilted; worst/best inverted accordingly.
    value: weighted((h) => h.metrics.peRatio ?? null, 45, 8),
    // Not computed by any adapter today — the universal model has no per-holding
    // momentum metric. Neutral, honestly, rather than guessed.
    momentum: 50,
    quality: weighted((h) => h.metrics.returnOnEquity ?? null, 0, 0.30),
    income: weighted((h) => {
      const y = h.metrics.dividendYield ?? h.metrics.yield ?? null;
      if (y == null) return null;
      return y > 1 ? y : y * 100;
    }, 0, 5),
  };
}

export function fromUniversalReport(report: UniversalPortfolioReport): IOSReportInput {
  const sectorWeights: SectorWeight[] = report.allocation.bySector.slices.map((s) => ({
    sector: s.label,
    weight: Math.round(s.weight * 10) / 10,
  }));

  return {
    totalValue: report.totalValue,
    positionCount: report.holdingCount,
    // Manually-valued holdings (real estate, private markets, …) have no ticker —
    // excluded here since "holdingSymbols" drives symbol-keyed lookups
    // (isInPortfolio checks, etc.) that only make sense for tradable assets.
    holdingSymbols: report.holdings.filter((h) => h.symbol).map((h) => h.symbol as string),
    sectorWeights,
    styleWeights: styleWeightsFromHoldings(report.holdings),
    marketCapWeights: marketCapWeightsFromHoldings(report.holdings, report.totalValue),
    // Position-level, which is what projectHHI() and the Pipeline's
    // "position-level concentration moves X → Y" copy both assume.
    hhi: report.risk.positionHhi,
    healthScore: report.health.total,
    annualizedVolatility: report.risk.annualizedVolatility,
    beta: report.risk.beta,
  };
}

/* -------------------------------------------------------------------------- */
/* Sector gap analysis                                                         */
/* -------------------------------------------------------------------------- */

function computeSectorGaps(
  sectorWeights: SectorWeight[],
  maxSectorPct: number,
): { missing: string[]; underweight: string[]; overweight: string[] } {
  const weightMap = new Map(sectorWeights.map((s) => [s.sector, s.weight]));

  const missing: string[] = [];
  const underweight: string[] = [];
  const overweight: string[] = [];

  for (const sector of ALL_SECTORS) {
    const w = weightMap.get(sector) ?? 0;
    if (w === 0) {
      missing.push(sector);
    } else if (w < 5) {
      underweight.push(sector);
    } else if (w > maxSectorPct) {
      overweight.push(sector);
    }
  }
  return { missing, underweight, overweight };
}

/* -------------------------------------------------------------------------- */
/* buildInvestmentProfile                                                      */
/* -------------------------------------------------------------------------- */

export function buildInvestmentProfile(
  input: IOSReportInput | null,
  objective: PortfolioObjective,
  constraints: PortfolioConstraints,
  behavioral: BehavioralSignals = DEFAULT_BEHAVIORAL,
): InvestmentProfile {
  if (!input || input.positionCount === 0) {
    return {
      ...EMPTY_PROFILE,
      objective,
      constraints,
      behavioral,
      builtAt: Date.now(),
    };
  }

  const { missing, underweight, overweight } = computeSectorGaps(
    input.sectorWeights,
    constraints.maxSectorPct,
  );

  return {
    objective,
    constraints,
    totalValue: input.totalValue,
    positionCount: input.positionCount,
    holdingSymbols: input.holdingSymbols,
    sectorWeights: input.sectorWeights,
    missingSectors: missing,
    underweightSectors: underweight,
    overweightSectors: overweight,
    styleWeights: input.styleWeights,
    marketCapWeights: input.marketCapWeights,
    hhi: input.hhi,
    healthScore: input.healthScore,
    annualizedVolatility: input.annualizedVolatility,
    beta: input.beta,
    behavioral,
    builtAt: Date.now(),
    hasPortfolio: true,
  };
}
