/**
 * The equity universe.
 *
 * This provider does almost nothing, and that is the point. The existing
 * lib/dataset.ts pipeline — 1,000 names by market cap, 12h SQLite-backed
 * fundamentals cache, a 5-minute live price layer merged on top, composite
 * scores recomputed from the merge — already works, is tuned, and is what
 * every current screener user is relying on. Rewriting it to fit a new
 * abstraction would have risked regressing the one asset class the app is
 * actually used for, in exchange for nothing.
 *
 * So the redesign wraps it instead: dataset.ts is untouched, and this file is
 * the ~40 lines that project its StockMetrics output into the normalized
 * ScreenerCandidate shape. Equity screening therefore behaves exactly as it did
 * before, by construction rather than by testing.
 */

import { equityDataset } from "../../dataset";
import type { DatasetStatus, StockMetrics } from "../../types";
import type { ScreenerCandidate, UniverseStatus } from "../types";
import type { UniverseProvider } from "../universe-cache";

/** PEG is the one metric the registry declares that dataset.ts doesn't already produce. */
function pegRatio(m: StockMetrics): number | null {
  // A PEG built on negative or near-zero growth is arithmetically fine and
  // financially meaningless (a shrinking company doesn't get "cheap" by
  // shrinking faster), so it's null rather than a misleading number.
  if (m.forwardPE == null || m.forwardPE <= 0) return null;
  if (m.epsGrowthYoY == null || m.epsGrowthYoY <= 1) return null;
  return m.forwardPE / m.epsGrowthYoY;
}

export function toCandidate(m: StockMetrics): ScreenerCandidate {
  return {
    symbol: m.symbol,
    name: m.name,
    assetClass: "equity",
    price: m.price,
    changePercent: null, // the equity dataset carries 1-year return, not intraday change
    metrics: {
      marketCap: m.marketCap,
      forwardPE: m.forwardPE,
      pegRatio: pegRatio(m),
      evToEbitda: m.evToEbitda,
      fcfYield: m.fcfYield,
      revenueGrowthYoY: m.revenueGrowthYoY,
      revenueCagr3y: m.revenueCagr3y,
      epsGrowthYoY: m.epsGrowthYoY,
      epsCagr3y: m.epsCagr3y,
      roic: m.roic,
      roe: m.roe,
      grossMargin: m.grossMargin,
      operatingMargin: m.operatingMargin,
      debtToEquity: m.debtToEquity,
      netDebtToEbitda: m.netDebtToEbitda,
      currentRatio: m.currentRatio,
      fcfMargin: m.fcfMargin,
      fcfGrowthYoY: m.fcfGrowthYoY,
      dividendYield: m.dividendYield,
      buybackYield: m.buybackYield,
      oneYearReturn: m.oneYearReturn,
      distanceFrom52WkHigh: m.distanceFrom52WkHigh,
      institutionalOwnership: m.institutionalOwnership,
      earningsSurprisePct: m.earningsSurprisePct,
      /*
       * Total shareholder yield: dividends plus net buybacks.
       *
       * Two companies returning the same cash rank very differently on dividend
       * yield alone depending on which instrument they chose, and the choice is
       * mostly tax and signalling preference rather than generosity. Adding them
       * is the standard fix and both components are already here.
       */
      shareholderYield:
        m.dividendYield != null || m.buybackYield != null
          ? (m.dividendYield ?? 0) + (m.buybackYield ?? 0)
          : null,
      /*
       * Quality-adjusted valuation: earnings yield × ROIC, i.e. how much
       * compounding you get per unit of price. A cheap low-return business and an
       * expensive high-return one can look equally attractive on either metric
       * alone; this is the product that separates them, and it is the closest
       * available stand-in for the "cheap *and* good" screen everyone actually
       * wants but expresses as two unrelated filters.
       */
      qualityPerPrice:
        m.forwardPE != null && m.forwardPE > 0 && m.roic != null ? (100 / m.forwardPE) * (m.roic / 100) : null,
      overallScore: m.scores.overall,
      valueScore: m.scores.value,
      growthScore: m.scores.growth,
      qualityScore: m.scores.quality,
      financialHealthScore: m.scores.financialHealth,
    },
    attributes: {
      sector: m.sector,
      industry: m.industry,
    },
  };
}

/** dataset.ts's DatasetStatus is already shaped like UniverseStatus; this is the cast, made explicit. */
export function toStatus(s: DatasetStatus): UniverseStatus {
  return {
    stage: s.stage,
    total: s.total,
    ready: s.ready,
    builtAt: s.builtAt,
    error: s.error ?? undefined,
  };
}

export const equityUniverse: UniverseProvider = {
  assetClass: "equity",

  async load() {
    const { status, metrics } = await equityDataset.getData();
    // Real Estate names are deliberately NOT filtered out, even though they
    // also form the REIT universe. A REIT *is* an equity, the equity screener
    // has always included them, and its sector dropdown still offers "Real
    // Estate" — dropping them here to avoid overlap would silently break that
    // filter. The REIT class is a specialized lens on the same names (FFO,
    // payout coverage, property type), not a partition of the universe.
    return { status: toStatus(status), candidates: metrics.map(toCandidate) };
  },

  refresh() {
    return toStatus(equityDataset.refresh());
  },

  peekStatus() {
    return toStatus(equityDataset.getStatus());
  },
};
