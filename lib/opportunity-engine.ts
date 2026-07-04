/**
 * Shared Opportunity Intelligence engine.
 *
 * Single source of truth for turning a stock's existing scores (composite
 * factor scores from `lib/composite.ts`, or the bucketed `ScoreResult` from
 * `lib/scoring.ts`) into an investable opportunity profile: category tags,
 * conviction, confidence, expected volatility, suggested holding period, and
 * a bull/bear/catalyst/risk narrative.
 *
 * Deterministic and pure — no network calls, no AI. When a richer AI-generated
 * `InvestmentThesis` is available (Scanner's high-conviction pipeline), it is
 * threaded through and takes precedence over the heuristic narrative so we
 * never show a worse answer when a better one already exists.
 *
 * Used by both Scanner (`lib/scanner/opportunity-scorer.ts`) and Compare
 * (`app/api/compare/route.ts`) — do not duplicate this classification logic
 * in either module.
 */

import type { InvestmentThesis, RiskItem } from "./types";
import type { FitTier } from "./ios/types";

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type OpportunityCategory =
  | "high_conviction"
  | "portfolio_improver"
  | "value"
  | "growth"
  | "quality_compounder"
  | "momentum_leader"
  | "emerging_theme"
  | "sector_rotation"
  | "defensive"
  | "dividend";

export const CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  high_conviction: "High Conviction",
  portfolio_improver: "Portfolio Improver",
  value: "Value Opportunity",
  growth: "Growth Opportunity",
  quality_compounder: "Quality Compounder",
  momentum_leader: "Momentum Leader",
  emerging_theme: "Emerging Theme",
  sector_rotation: "Sector Rotation Beneficiary",
  defensive: "Defensive Opportunity",
  dividend: "Dividend Opportunity",
};

export type Conviction = "High" | "Medium" | "Low";
export type VolatilityTier = "Low" | "Medium" | "High";

export interface OpportunityDimensions {
  value: number | null;
  growth: number | null;
  quality: number | null;
  financialHealth: number | null;
  momentum: number | null;
}

export interface OpportunityEngineInput {
  symbol: string;
  /** 0-100 anchor score — CompositeScores.overall or ScoreResult.composite. */
  score: number;
  dimensions: OpportunityDimensions;
  /** 0-100 confidence in the score, if the source engine computed one. */
  confidence?: number | null;
  dividendYieldPct?: number | null;
  /** % return over ~3 months, if available (used for volatility + momentum tagging). */
  momentum3mReturn?: number | null;
  momentumTrend?: "up" | "down" | "flat" | null;
  /** Strength (0-100) of a sector-level catalyst driving this idea, if applicable. */
  sectorSignalStrength?: number | null;
  /** True when this idea originated from a detected emerging theme / macro event. */
  isThematic?: boolean;
  /** Existing, already-computed portfolio fit — never recompute this here. */
  portfolioFit?: { fitScore: number; fitTier: FitTier } | null;
  /** Already-computed risk items (e.g. from `assessRisks`), if available. */
  riskItems?: RiskItem[];
  /** AI-generated thesis, if one already exists — takes precedence over heuristics. */
  thesis?: InvestmentThesis | null;
}

export interface OpportunityProfile {
  opportunityScore: number;
  conviction: Conviction;
  confidence: number;
  categories: OpportunityCategory[];
  primaryCategory: OpportunityCategory;
  categoryLabel: string;
  explanation: string;
  bullCase: string[];
  bearCase: string[];
  keyCatalysts: string[];
  keyRisks: string[];
  suggestedHoldingPeriod: string;
  expectedVolatility: VolatilityTier;
}

/* -------------------------------------------------------------------------- */
/* Category classification                                                     */
/* -------------------------------------------------------------------------- */

const STRONG = 65;
const VERY_STRONG = 72;

function deriveCategories(input: OpportunityEngineInput): OpportunityCategory[] {
  const { dimensions: d, score } = input;
  const cats: OpportunityCategory[] = [];

  if (score >= 70) cats.push("high_conviction");
  if (input.portfolioFit && (input.portfolioFit.fitTier === "excellent" || input.portfolioFit.fitTier === "good")) {
    cats.push("portfolio_improver");
  }
  if (d.value != null && d.value >= STRONG) cats.push("value");
  if (d.growth != null && d.growth >= STRONG) cats.push("growth");
  if (d.quality != null && d.quality >= VERY_STRONG && (d.financialHealth == null || d.financialHealth >= STRONG)) {
    cats.push("quality_compounder");
  }
  const momentumHot =
    (d.momentum != null && d.momentum >= VERY_STRONG) ||
    (input.momentum3mReturn != null && input.momentum3mReturn >= 15 && input.momentumTrend === "up");
  if (momentumHot) cats.push("momentum_leader");

  if (input.isThematic) cats.push("emerging_theme");
  if (input.sectorSignalStrength != null && input.sectorSignalStrength >= 45) cats.push("sector_rotation");

  const lowVol = d.financialHealth != null && d.financialHealth >= STRONG && !momentumHot;
  if (lowVol && (d.momentum == null || d.momentum < 55)) cats.push("defensive");

  if (input.dividendYieldPct != null && input.dividendYieldPct >= 2.5) cats.push("dividend");

  if (cats.length === 0) {
    // Fall back to whichever dimension is strongest so every opportunity lands somewhere.
    const candidates: [OpportunityCategory, number | null][] = [
      ["value", d.value],
      ["growth", d.growth],
      ["quality_compounder", d.quality],
      ["momentum_leader", d.momentum],
    ];
    const ranked = candidates
      .filter((x): x is [OpportunityCategory, number] => x[1] != null)
      .sort((a, b) => b[1] - a[1]);
    cats.push(ranked[0]?.[0] ?? "value");
  }

  return cats;
}

/** Priority order used to pick the single "primary" category for badges/headlines. */
const CATEGORY_PRIORITY: OpportunityCategory[] = [
  "high_conviction",
  "emerging_theme",
  "sector_rotation",
  "quality_compounder",
  "momentum_leader",
  "growth",
  "value",
  "portfolio_improver",
  "dividend",
  "defensive",
];

function pickPrimary(categories: OpportunityCategory[]): OpportunityCategory {
  for (const c of CATEGORY_PRIORITY) {
    if (categories.includes(c)) return c;
  }
  return categories[0];
}

/* -------------------------------------------------------------------------- */
/* Conviction / confidence / volatility / horizon                              */
/* -------------------------------------------------------------------------- */

function deriveConviction(score: number, confidence: number): Conviction {
  if (score >= 70 && confidence >= 55) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function deriveVolatility(input: OpportunityEngineInput): VolatilityTier {
  const { dimensions: d, momentum3mReturn } = input;
  if (momentum3mReturn != null && Math.abs(momentum3mReturn) >= 20) return "High";
  if (d.financialHealth != null && d.financialHealth < 40) return "High";
  if (
    d.financialHealth != null &&
    d.financialHealth >= 65 &&
    (momentum3mReturn == null || Math.abs(momentum3mReturn) < 10)
  ) {
    return "Low";
  }
  return "Medium";
}

const HORIZON_BY_CATEGORY: Record<OpportunityCategory, string> = {
  high_conviction: "Months – Quarters",
  emerging_theme: "Weeks – Months",
  sector_rotation: "Weeks – Months",
  momentum_leader: "Days – Weeks",
  growth: "Months – Quarters",
  value: "Quarters – Years",
  quality_compounder: "Quarters – Years",
  portfolio_improver: "Quarters – Years",
  dividend: "Quarters – Years",
  defensive: "Quarters – Years",
};

/* -------------------------------------------------------------------------- */
/* Narrative (deterministic fallback; AI thesis wins when present)             */
/* -------------------------------------------------------------------------- */

function buildBullCase(input: OpportunityEngineInput): string[] {
  const { dimensions: d } = input;
  const labeled: [string, number | null][] = [
    ["Valuation", d.value],
    ["Growth", d.growth],
    ["Quality", d.quality],
    ["Financial health", d.financialHealth],
    ["Momentum", d.momentum],
  ];
  const points = labeled
    .filter((x): x is [string, number] => x[1] != null && x[1] >= STRONG)
    .sort((a, b) => b[1] - a[1])
    .map(([label, v]) => `${label} ${v}/100`);

  if (input.portfolioFit && input.portfolioFit.fitScore >= 65) {
    points.push(`Strong portfolio fit (${input.portfolioFit.fitScore}/100)`);
  }
  if (input.dividendYieldPct != null && input.dividendYieldPct >= 2.5) {
    points.push(`Dividend yield ${input.dividendYieldPct.toFixed(1)}%`);
  }
  return points.slice(0, 4);
}

function buildBearCase(input: OpportunityEngineInput): string[] {
  const { dimensions: d, riskItems } = input;
  if (riskItems && riskItems.length > 0) {
    return riskItems
      .filter((r) => r.level !== "low")
      .map((r) => `${r.category}: ${r.reason}`)
      .slice(0, 4);
  }
  const vals: [string, number | null][] = [
    ["Valuation", d.value],
    ["Growth", d.growth],
    ["Quality", d.quality],
    ["Financial health", d.financialHealth],
    ["Momentum", d.momentum],
  ];
  return vals
    .filter(([, v]) => v != null && v < 45)
    .map(([label, v]) => `${label} is weak (${v}/100)`)
    .slice(0, 3);
}

function buildExplanation(
  input: OpportunityEngineInput,
  categories: OpportunityCategory[],
  primary: OpportunityCategory,
): string {
  const label = CATEGORY_LABELS[primary];
  const parts = [`${input.symbol} surfaces as a ${label.toLowerCase()} — composite score ${input.score}/100.`];
  if (categories.length > 1) {
    const rest = categories.filter((c) => c !== primary).map((c) => CATEGORY_LABELS[c]);
    parts.push(`Also qualifies as: ${rest.join(", ")}.`);
  }
  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Main entry point                                                            */
/* -------------------------------------------------------------------------- */

export function buildOpportunityProfile(input: OpportunityEngineInput): OpportunityProfile {
  const categories = deriveCategories(input);
  const primaryCategory = pickPrimary(categories);
  const confidence = input.thesis?.confidence ?? input.confidence ?? 55;
  const conviction = deriveConviction(input.score, confidence);
  const expectedVolatility = deriveVolatility(input);

  const suggestedHoldingPeriod = input.thesis
    ? horizonLabel(input.thesis.timeHorizon)
    : HORIZON_BY_CATEGORY[primaryCategory];

  const bullCase = input.thesis?.bullCase?.length ? input.thesis.bullCase : buildBullCase(input);
  const bearCase = input.thesis?.bearCase?.length ? input.thesis.bearCase : buildBearCase(input);
  const keyCatalysts = input.thesis?.keyCatalysts?.length ? input.thesis.keyCatalysts : [];
  const keyRisks = input.thesis?.keyRisks?.length
    ? input.thesis.keyRisks
    : (input.riskItems ?? []).filter((r) => r.level !== "low").map((r) => r.reason);

  const explanation = input.thesis?.summary || buildExplanation(input, categories, primaryCategory);

  return {
    opportunityScore: input.score,
    conviction,
    confidence,
    categories,
    primaryCategory,
    categoryLabel: CATEGORY_LABELS[primaryCategory],
    explanation,
    bullCase,
    bearCase,
    keyCatalysts,
    keyRisks,
    suggestedHoldingPeriod,
    expectedVolatility,
  };
}

function horizonLabel(h: InvestmentThesis["timeHorizon"]): string {
  switch (h) {
    case "days": return "Days";
    case "weeks": return "Days – Weeks";
    case "months": return "Weeks – Months";
    case "quarters": return "Months – Quarters";
    case "years": return "Quarters – Years";
    default: return "Months – Quarters";
  }
}

/** Group a list of profiles (paired with their owning item) by category, for tabbed UIs. */
export function groupByCategory<T>(
  items: T[],
  getProfile: (item: T) => Pick<OpportunityProfile, "categories">,
): Map<OpportunityCategory, T[]> {
  const map = new Map<OpportunityCategory, T[]>();
  for (const item of items) {
    for (const cat of getProfile(item).categories) {
      const list = map.get(cat) ?? [];
      list.push(item);
      map.set(cat, list);
    }
  }
  return map;
}
