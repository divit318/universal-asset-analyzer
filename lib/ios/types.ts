/**
 * Investment Operating System (IOS) — core type definitions.
 *
 * The IOS is the intelligence layer that personalizes every recommendation,
 * comparison, scan result, and research page against the user's actual portfolio,
 * objectives, and constraints. It answers "Is this right for THIS user?" instead
 * of "Is this a good stock?"
 */

import type { PortfolioObjective, PortfolioConstraints } from "@/lib/portfolio-analytics";
import type { CompositeScores, ScoreResult } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* Behavioral signals — tracked across sessions in localStorage               */
/* -------------------------------------------------------------------------- */

export interface BehavioralSignals {
  /** Last 20 symbols the user researched, most recent first. */
  recentlyResearched: string[];
  /** Symbols the user has explicitly dismissed / rejected. */
  rejectedSymbols: string[];
  /** Style preferences inferred from research behavior. */
  impliedStyles: Array<"growth" | "value" | "quality" | "dividend" | "momentum">;
}

export const DEFAULT_BEHAVIORAL: BehavioralSignals = {
  recentlyResearched: [],
  rejectedSymbols: [],
  impliedStyles: [],
};

/* -------------------------------------------------------------------------- */
/* Investment Profile — the complete user context the IOS maintains           */
/* -------------------------------------------------------------------------- */

export interface SectorWeight {
  sector: string;
  weight: number; // % of total portfolio
}

export interface StyleWeights {
  growth: number;     // 0-100 tilt
  value: number;
  momentum: number;
  quality: number;
  income: number;     // dividend / income focus
}

export interface MarketCapWeights {
  large: number; // >$10B, as % of portfolio
  mid: number;   // $2B–$10B
  small: number; // <$2B
}

export interface InvestmentProfile {
  // ── User-configured ─────────────────────────────────────────────────────
  objective: PortfolioObjective;
  constraints: PortfolioConstraints;

  // ── Derived from PortfolioReport ─────────────────────────────────────────
  totalValue: number;
  positionCount: number;
  holdingSymbols: string[];

  sectorWeights: SectorWeight[];
  /** Sectors with weight below 5% that the portfolio is meaningfully missing. */
  missingSectors: string[];
  /** Sectors where portfolio weight is 5–15% but below a healthy threshold. */
  underweightSectors: string[];
  /** Sectors where portfolio weight exceeds maxSectorPct. */
  overweightSectors: string[];

  styleWeights: StyleWeights;
  marketCapWeights: MarketCapWeights;

  /** Herfindahl-Hirschman Index from RiskAnalytics (0-10000; lower = diversified). */
  hhi: number;
  /** Overall portfolio health score 0-100. */
  healthScore: number;
  /** Annualized portfolio volatility % (null when insufficient history). */
  annualizedVolatility: number | null;
  /** Portfolio beta vs SPY. */
  beta: number | null;

  // ── Behavioral signals ───────────────────────────────────────────────────
  behavioral: BehavioralSignals;

  // ── Meta ─────────────────────────────────────────────────────────────────
  builtAt: number; // Date.now()
  /** False when the user has no positions — fit scores degrade gracefully. */
  hasPortfolio: boolean;
}

export const EMPTY_PROFILE: InvestmentProfile = {
  objective: "ai_optimized",
  constraints: {
    maxPositionPct: 25,
    maxSectorPct: 40,
    minCashPct: 2,
    excludedSymbols: [],
    requireDividend: false,
    marketCapFilter: "any",
  },
  totalValue: 0,
  positionCount: 0,
  holdingSymbols: [],
  sectorWeights: [],
  missingSectors: [],
  underweightSectors: [],
  overweightSectors: [],
  styleWeights: { growth: 50, value: 50, momentum: 50, quality: 50, income: 50 },
  marketCapWeights: { large: 0, mid: 0, small: 0 },
  hhi: 0,
  healthScore: 0,
  annualizedVolatility: null,
  beta: null,
  behavioral: DEFAULT_BEHAVIORAL,
  builtAt: 0,
  hasPortfolio: false,
};

/* -------------------------------------------------------------------------- */
/* Asset data required for fit scoring (module-agnostic)                      */
/* -------------------------------------------------------------------------- */

export interface FitAssetData {
  symbol: string;
  sector: string | null;
  /** Market cap in dollars; used for size category assignment. */
  marketCap: number | null;
  /** From scoring.ts — available on Research, Compare, Portfolio paths. */
  scoreResult?: ScoreResult | null;
  /** From composite.ts — available on Screener, Scanner paths. */
  compositeScores?: CompositeScores | null;
  /** Dividend yield in percent (e.g. 2.5 = 2.5%). */
  dividendYield?: number | null;
  /** Beta vs market. */
  beta?: number | null;
  /** Market region for geographic diversification. */
  geography?: "US" | "IN" | "JP" | "HK" | "AU" | "EU" | "CRYPTO" | null;
  isOnWatchlist?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Portfolio Fit Score — the IOS's primary output per asset                   */
/* -------------------------------------------------------------------------- */

export type FitTier = "excellent" | "good" | "neutral" | "poor" | "avoid";

export interface FitDimension {
  label: string;
  score: number;          // 0-100
  weight: number;         // 0-1 nominal contribution to overall fitScore
  message: string;        // short human-readable explanation
  impact: "positive" | "neutral" | "negative";
  /**
   * 0-1 data confidence for this dimension. 1 = fully-evidenced, 0 = no data
   * (dimension drops out of the composite via renormalization instead of
   * injecting a misleading constant). Absent = treat as 1 for back-compat.
   */
  confidence?: number;
}

export interface PortfolioFitAnalysis {
  symbol: string;

  /** Weighted composite of all dimensions. 0-100. */
  fitScore: number;
  fitTier: FitTier;

  /**
   * 0-100 overall data confidence — the share of scoring weight backed by real
   * evidence. A fitScore of 73 at 30% confidence is a very different claim than
   * 73 at 90%; the UI should surface this so users don't over-trust data-poor
   * scores. `capReason` names the hard gate that clamped the score, if any.
   */
  confidence: number;
  capReason: string | null;

  /** The five scoring dimensions with explanations. */
  dimensions: {
    sector: FitDimension;
    correlation: FitDimension;
    objective: FitDimension;
    style: FitDimension;
    geographic: FitDimension;
    sizing: FitDimension;
  };

  /** Up to 3 reasons why this asset fits the portfolio. */
  reasons: string[];
  /** Up to 3 trade-offs or risks it introduces. */
  tradeoffs: string[];

  /** Suggested % of total portfolio to allocate. */
  suggestedAllocationPct: number;
  /** Suggested $ amount, based on totalValue × suggestedAllocationPct. */
  suggestedAmount: number;

  /** Estimated HHI after adding this position at suggestedAllocationPct. */
  projectedHHI: number;
  concentrationWarning: boolean;

  isInPortfolio: boolean;
  isOnWatchlist: boolean;

  /** True when the user has no portfolio — fit is generic, not personalized. */
  isGeneric: boolean;
}

/* -------------------------------------------------------------------------- */
/* Contextual ranking — re-ranks lists by combining absolute + fit scores     */
/* -------------------------------------------------------------------------- */

export interface ContextualRanking {
  symbol: string;
  /** Original absolute quality score (0-100) — from scoring.ts or composite.ts. */
  absoluteScore: number;
  /** IOS portfolio fit score (0-100). */
  fitScore: number;
  fitTier: FitTier;
  /** Weighted combination: (1-fitWeight) × absolute + fitWeight × fit. */
  combinedScore: number;
  /** One-liner explaining the fit rank. */
  fitSummary: string;
}
