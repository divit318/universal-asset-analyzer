/**
 * Investment Operating System (IOS) — core type definitions.
 *
 * The IOS is the intelligence layer that personalizes every recommendation,
 * comparison, scan result, and research page against the user's actual portfolio,
 * objectives, and constraints. It answers "Is this right for THIS user?" instead
 * of "Is this a good stock?"
 */

import type { CompositeScores, ScoreResult } from "@/lib/types";
import type { AlignmentThemeId, InvestorGoal, PriorityLevel } from "@/lib/portfolio/alignment/policy";
import type { AlignmentStatus, AlignmentMismatch } from "@/lib/portfolio/alignment/engine";

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

/* -------------------------------------------------------------------------- */
/* Policy context — the investor's priorities × the book's measured health    */
/* -------------------------------------------------------------------------- */

/**
 * One alignment theme, projected for the fit scorer: the user's own stated
 * priority for it, the canonical health verdict (status/score computed by
 * lib/portfolio/alignment/engine.ts — never recomputed here), and the theme's
 * real-unit measurements for honest phrasing. `mismatch` carries the engine's
 * own compact stated/actual/holdings strings when the theme is breached.
 */
export interface PolicyThemeSnapshot {
  id: AlignmentThemeId;
  label: string;
  priority: PriorityLevel;
  score: number | null;
  status: AlignmentStatus | null;
  metrics: Record<string, number> | null;
  mismatch: Pick<AlignmentMismatch, "stated" | "actual" | "holdings"> | null;
}

/**
 * The projection of the investor's policy + the alignment report that rides on
 * the InvestmentProfile — what lets Portfolio Fit reason across "what you told
 * us you care about" × "what the book currently does" without a second health
 * engine. Null when the report predates this field or the book is empty.
 */
export interface PolicyFitContext {
  /** False = assumed defaults. Personalized claims require a policy the user actually set. */
  confirmed: boolean;
  goal: InvestorGoal;
  themes: PolicyThemeSnapshot[];
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
  /** Portfolio-alignment score vs the investor's policy, 0-100. Null = unscored. */
  alignmentScore: number | null;
  /**
   * The investor's policy priorities × the alignment engine's per-theme health
   * verdicts — the canonical Portfolio Health system, projected (never
   * recomputed) so the fit scorer can reason with it. Null when unavailable.
   */
  policyContext: PolicyFitContext | null;
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
  alignmentScore: null,
  policyContext: null,
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
  /**
   * THE canonical standalone Research Score (0-100) for this asset — the same
   * composite the hero badge and Conviction tab render (asset-class-aware:
   * equity/fund/crypto/commodity/forex scorer, or the screener.in snapshot for
   * Indian stocks). When provided it overrides the derivation from
   * scoreResult/compositeScores, so the fit score provably inherits the exact
   * number the rest of the page shows.
   */
  researchScore?: number | null;
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

/* -------------------------------------------------------------------------- */
/* Unified action — ONE decision derived from BOTH canonical scores           */
/* -------------------------------------------------------------------------- */

/**
 * The single portfolio decision vocabulary. Derived in
 * lib/ios/unified-action.ts from the Research Score AND the Portfolio Fit
 * Score together, and carried on every PortfolioFitAnalysis — so the fit
 * panel, the position action card, and the AI verdict all read the same call.
 */
export type UnifiedActionKind =
  | "initiate" // no position → open one at the suggested weight
  | "add"      // held → buy up toward the suggested weight
  | "starter"  // open a deliberately reduced position (conviction or fit is partial)
  | "hold"     // held → keep, do not add
  | "wait"     // not held → research supports it, the portfolio doesn't (yet)
  | "trim"     // held → reduce toward target
  | "exit"     // held → close the position
  | "avoid";   // not held → do not open a position

export interface UnifiedAction {
  kind: UnifiedActionKind;
  /**
   * 0–1 multiplier applied to the base allocation — how much of a full-conviction
   * position the two scores jointly support. 0 for wait/avoid/exit.
   */
  sizeFactor: number;
  /** One sentence citing BOTH scores (and the constraint, when one gated). */
  reason: string;
}

/**
 * One step of the research → fit derivation, so the UI can show exactly how
 * the standalone Research Score became this portfolio's Fit Score (the
 * "reasoning should feel continuous" requirement).
 */
export interface FitBridgeStep {
  label: string;
  /** The 0-100 value at this step, when one applies. */
  value: number | null;
  detail: string;
}

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

  /**
   * Portfolio Fit = Research Quality + Portfolio Effects. 0-100.
   *
   * INHERITS the Research Score: when one is available, this is a configurable
   * blend of the standalone Research Score and the pure portfolio-effects
   * composite, bounded so diversification can never rescue a weak asset and
   * portfolio friction can never bury an exceptional one without a named hard
   * constraint (see lib/ios/fit-scorer.ts guardrails).
   */
  fitScore: number;
  fitTier: FitTier;

  /** The standalone Research Score this fit inherited (null when unavailable). */
  researchScore: number | null;
  /**
   * The portfolio-context composite (sector, correlation, objective, style,
   * geography, sizing), INCLUDING the bounded policy × health adjustment,
   * BEFORE research quality is blended in — "what does adding this do to the
   * book, given what its owner said matters", independent of how good the
   * asset is. The bridge shows the pre-adjustment blend and the shift
   * separately.
   */
  portfolioEffectsScore: number | null;

  /** The single decision derived from BOTH scores — shared by the fit panel,
   *  the position action card, and the AI verdict prompt. */
  action: UnifiedAction;

  /** The research → fit derivation, step by step, for explainability. */
  bridge: FitBridgeStep[];

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

  /**
   * THE one personalized line — "you told us X, the book currently does Y,
   * this asset does Z, therefore W" — built from the investor's CONFIRMED
   * policy priorities × the alignment engine's health verdicts × this asset's
   * actual characteristics (lib/ios/policy-fit.ts). Null whenever any link in
   * that chain is missing: no confirmed policy, no relevant health signal, or
   * no honest connection to this asset. Never a generic compliment.
   */
  policyInsight: string | null;
  /**
   * The bounded, signed shift the policy × health context applied to the
   * portfolio-effects composite (±POLICY_FIT_MAX_ADJUSTMENT). 0 when nothing
   * fired. Disclosed on the bridge — never a separately displayed score.
   */
  policyAdjustment: number;

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
  /** One-liner explaining the fit rank. Unique within a ranked batch. */
  fitSummary: string;
  /**
   * The next distinct fit driver after `fitSummary`, when the fit analysis
   * produced more than one evidenced reason. Lets two surfaces render the same
   * symbol without repeating the same sentence. Null when only one reason exists.
   */
  fitDetail?: string | null;
}

/* -------------------------------------------------------------------------- */
/* The user's stated objective and constraints                                 */
/* -------------------------------------------------------------------------- */

/*
 * These live HERE, with the IOS, because they are the IOS's own vocabulary: the
 * objective the user picks for personalising ideas ("maximize growth", "reduce
 * risk", "AI optimized"), and the guard-rails the fit scorer respects. They used
 * to live in lib/portfolio-analytics.ts alongside a second, now-deleted portfolio
 * report builder, which made that module look like a portfolio engine that half
 * the app depended on. It is not one any more — see its header.
 *
 * Deliberately NOT the same enum as lib/portfolio/engines/optimize.ts's
 * `Objective`. That one names a REBALANCING objective the optimizer solves for
 * ("maximize_sharpe", "target_allocation"); this one names how the user wants
 * IDEAS ranked. Two different questions, and collapsing them would change what
 * the Wire and Research pages mean by "fit".
 */

export type PortfolioObjective =
  | "maximize_growth"
  | "reduce_risk"
  | "improve_diversification"
  | "increase_income"
  | "beat_benchmark"
  | "preserve_capital"
  | "ai_optimized";

export interface ObjectiveConfig {
  label: string;
  description: string;
  icon: string;
  color: string;
  activeColor: string;
}

export const OBJECTIVE_CONFIG: Record<PortfolioObjective, ObjectiveConfig> = {
  maximize_growth:         { label: "Maximize Growth",    description: "Focus on high-growth, high-momentum stocks",              icon: "↗", color: "border-border text-muted hover:border-positive/40 hover:text-positive",         activeColor: "border-positive/50 bg-positive/10 text-positive" },
  reduce_risk:             { label: "Reduce Risk",        description: "Prioritize defensive, low-volatility positions",          icon: "◉", color: "border-border text-muted hover:border-chart-2/40 hover:text-chart-2",          activeColor: "border-chart-2/50 bg-chart-2/10 text-chart-2" },
  improve_diversification: { label: "Diversify",         description: "Fill sector and factor gaps in the portfolio",            icon: "⊞", color: "border-border text-muted hover:border-accent/40 hover:text-accent",              activeColor: "border-accent/50 bg-accent/10 text-accent" },
  increase_income:         { label: "Increase Income",   description: "Prioritize high-dividend and income-generating assets",   icon: "$", color: "border-border text-muted hover:border-amber-400/40 hover:text-amber-400 light:hover:text-amber-700",        activeColor: "border-amber-400/50 bg-amber-400/10 text-amber-400 light:text-amber-700" },
  beat_benchmark:          { label: "Beat Benchmark",    description: "Maximize alpha relative to the market benchmark",        icon: "⚡", color: "border-border text-muted hover:border-warning/40 hover:text-warning",      activeColor: "border-warning/50 bg-warning/10 text-warning" },
  preserve_capital:        { label: "Preserve Capital",  description: "Minimize drawdown risk, protect principal",              icon: "◈", color: "border-border text-muted hover:border-muted/60 hover:text-foreground",            activeColor: "border-border bg-surface-2 text-foreground" },
  ai_optimized:            { label: "AI Optimized",      description: "AI selects the optimal objective based on your profile", icon: "✦", color: "border-border text-muted hover:border-accent/50 hover:text-accent",              activeColor: "border-accent bg-accent/15 text-accent font-semibold" },
};

export interface PortfolioConstraints {
  maxPositionPct: number;      // max % allocation per single stock (default: 25)
  maxSectorPct: number;        // max % allocation per sector (default: 40)
  minCashPct: number;          // minimum cash reserve % (default: 2)
  excludedSymbols: string[];   // never-sell / avoid-buy list
  requireDividend: boolean;    // only recommend dividend payers (default: false)
  marketCapFilter: "any" | "large" | "mid" | "small";  // default: "any"
}

export const DEFAULT_CONSTRAINTS: PortfolioConstraints = {
  maxPositionPct: 25,
  maxSectorPct: 40,
  minCashPct: 2,
  excludedSymbols: [],
  requireDividend: false,
  marketCapFilter: "any",
};

/* -------------------------------------------------------------------------- */
/* A NEW position the user does not hold yet                                  */
/* -------------------------------------------------------------------------- */

/*
 * Lives here for the same reason the objective and constraints above do: it is
 * the shape of an IDEA ranked against the portfolio, which is the IOS's job.
 * It previously sat in lib/portfolio-analytics.ts next to the deleted report
 * builder (see the note above), which is why it arrived here rather than being
 * restored there.
 *
 * Distinct from `PortfolioFitAnalysis`, which scores an asset the user has
 * ALREADY named. This is the output of asking "what should I look at that I
 * don't own", so it carries the sourcing provenance — `fromWatchlist` and
 * `autoQualified` — that a fit score has no reason to.
 */
export interface NewPositionRecommendation {
  symbol: string;
  name: string;
  currentPrice: number | null;
  marketCap: string | null;
  sector: string;
  reason: string;
  weaknessAddressed: string;
  expectedImpact: {
    diversification: "improves" | "neutral" | "reduces";
    risk: "reduces" | "neutral" | "increases";
    growthPotential: "high" | "medium" | "low";
    incomePotential: "high" | "medium" | "low";
  };
  suggestedAllocationPct: number;
  suggestedDollarAmount: number;
  confidenceScore: number;
  breakdown: {
    portfolioFitScore: number;
    fundamentalScore: number;
    technicalScore: number;
    valuationScore: number;
    momentumScore: number;
  };
  supportingFactors: string[];
  fromWatchlist: boolean;
  /** Watchlist Intelligence auto-promotion: crossed the "new opportunity" threshold before the AI was even asked. */
  autoQualified: boolean;
}
