/**
 * IOS Profile Builder — derives InvestmentProfile from the existing PortfolioReport.
 *
 * Pure function, no network I/O, no side effects. The IOS context calls this
 * whenever the portfolio report or user preferences change.
 */

import type { PortfolioReport, PortfolioObjective, PortfolioConstraints, FactorTilt } from "@/lib/portfolio-analytics";
import type {
  InvestmentProfile,
  BehavioralSignals,
  SectorWeight,
  StyleWeights,
  MarketCapWeights,
} from "./types";
import { EMPTY_PROFILE, DEFAULT_BEHAVIORAL } from "./types";

/* -------------------------------------------------------------------------- */
/* Known S&P 500 sectors (for gap detection)                                  */
/* -------------------------------------------------------------------------- */

const ALL_SECTORS = [
  "Technology",
  "Healthcare",
  "Financials",
  "Consumer Discretionary",
  "Consumer Staples",
  "Industrials",
  "Communication Services",
  "Energy",
  "Materials",
  "Real Estate",
  "Utilities",
];

/* -------------------------------------------------------------------------- */
/* Style weight extraction from FactorExposure                                */
/* -------------------------------------------------------------------------- */

function extractStyleWeights(tilts: FactorTilt[]): StyleWeights {
  const find = (name: string): number => {
    const t = tilts.find((f) => f.factor.toLowerCase().includes(name.toLowerCase()));
    if (!t) return 50;
    // score is -100 to +100; convert to 0-100 where 50 = neutral
    return Math.round(Math.min(100, Math.max(0, 50 + t.score / 2)));
  };
  return {
    growth: find("growth"),
    value: find("value"),
    momentum: find("momentum"),
    quality: find("quality"),
    income: find("income") || find("dividend"),
  };
}

/* -------------------------------------------------------------------------- */
/* Market cap breakdown from positions                                         */
/* -------------------------------------------------------------------------- */

function extractMarketCapWeights(
  positions: PortfolioReport["positions"],
  totalValue: number,
): MarketCapWeights {
  if (totalValue === 0) return { large: 0, mid: 0, small: 0 };

  let large = 0;
  for (const p of positions) {
    large += p.value; // conservative: treat all as large until EnrichedPosition gains marketCap field
  }
  return {
    large: totalValue > 0 ? Math.round((large / totalValue) * 100) : 0,
    mid: 0,
    small: 0,
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
  report: PortfolioReport | null,
  objective: PortfolioObjective,
  constraints: PortfolioConstraints,
  behavioral: BehavioralSignals = DEFAULT_BEHAVIORAL,
): InvestmentProfile {
  if (!report || report.positionCount === 0) {
    return {
      ...EMPTY_PROFILE,
      objective,
      constraints,
      behavioral,
      builtAt: Date.now(),
    };
  }

  const totalValue = report.totalValue;
  const holdingSymbols = report.positions.map((p) => p.symbol);

  // Sector weights from the report's sectorAllocation
  const sectorWeights: SectorWeight[] = report.sectorAllocation.map((s) => ({
    sector: s.sector,
    weight: Math.round(s.weight * 10) / 10,
  }));

  const { missing, underweight, overweight } = computeSectorGaps(
    sectorWeights,
    constraints.maxSectorPct,
  );

  const styleWeights = extractStyleWeights(report.factors?.tilts ?? []);
  const marketCapWeights = extractMarketCapWeights(report.positions, totalValue);

  return {
    objective,
    constraints,
    totalValue,
    positionCount: report.positionCount,
    holdingSymbols,
    sectorWeights,
    missingSectors: missing,
    underweightSectors: underweight,
    overweightSectors: overweight,
    styleWeights,
    marketCapWeights,
    hhi: report.risk.hhi,
    healthScore: report.health.total,
    annualizedVolatility: report.risk.annualizedVolatility,
    beta: report.risk.beta,
    behavioral,
    builtAt: Date.now(),
    hasPortfolio: true,
  };
}
