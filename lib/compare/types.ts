import type { AssetClassId } from "../assets/types";
import { formatCurrency } from "../format";
import type { FundHolding } from "../types";
import type { CurvePoint } from "../screener/universes/commodity";
import type { CompositeScoreResult } from "./composite-scores";
import type { PeerBenchmark } from "./benchmarks";
import type { ClassRiskFlag } from "./risk-flags";
import type { DataSourceId } from "../provenance";

/** How recent each data source behind a comparison is — shared by equity and class Compare. */
export interface EntryFreshness {
  price: { asOf: number; source: DataSourceId };
  fundamentals: { asOf: number; source: DataSourceId };
  /** null when no statements loaded at all. */
  statements: { asOf: string; source: DataSourceId; fiscalYear: number } | null;
}

/**
 * One compared instrument for every asset class except equity (which keeps
 * its own, already-shipped `CompareEntry` in app/api/compare/route.ts
 * untouched). Built directly from the Screener's `ScreenerCandidate` — same
 * numbers a user would see on the Screener for this symbol, by construction.
 */
export interface ClassCompareEntry {
  symbol: string;
  name: string;
  error?: string;
  assetClass: AssetClassId;
  price: number | null;
  changePercent: number | null;
  metrics: Record<string, number | null>;
  attributes: Record<string, string | null>;
  topHoldings?: FundHolding[] | null;
  scores: CompositeScoreResult;
  /** Commodity only — the raw futures curve for the signature chart. */
  curvePoints?: CurvePoint[];
  /** Peer-group benchmark per metric key, present only where a reliable peer group + enough peer data exists. */
  benchmarks?: Record<string, PeerBenchmark>;
  /** Deterministic risk flags from the class's own registry (lib/assets/*.ts `warnings`). */
  riskFlags?: ClassRiskFlag[];
  /** When the Screener universe backing this entry was last built — the freshness signal for every metric above. */
  universeAsOf?: string | null;
}

/**
 * THE price rendering for a class-compare entry — shared by the compare card
 * and the Excel export so they cannot disagree.
 *
 * Non-equity class universes are USD-denominated by construction (US-listed
 * ETF/REIT/bond universes, "-USD" crypto pairs, USD-quoted futures — see
 * lib/screener/universes/), so the dollar is a property of the data. The one
 * exception is forex, whose "price" is an exchange RATE quoted in the pair's
 * counter currency: labelling a USDJPY rate "$147.32" would claim yen are
 * dollars, so rates render bare at FX precision.
 */
export function classPriceDisplay(assetClass: AssetClassId, price: number): string {
  return assetClass === "forex" ? price.toFixed(4) : formatCurrency(price, "USD");
}
