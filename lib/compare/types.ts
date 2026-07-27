import type { AssetClassId } from "../assets/types";
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
