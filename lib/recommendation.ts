/**
 * Canonical recommendation bands — the single source of truth for turning a
 * 0–100 score into a 5-tier call, its label, and its color.
 *
 * UAA runs two purpose-built scorers: `lib/composite.ts` scores a large universe
 * in batch for the Screener; `lib/scoring.ts` is the multi-signal decision engine
 * for a single name. They read different data and produce different numbers by
 * design — but a given *score* must be interpreted identically everywhere it
 * appears, or the same 72 reads as "Buy" on one page and an ambiguous amber on
 * another. Previously the research engine used bands at 78/60/42/25 while the
 * Screener badge used 75/55/40, and ~10 UI files each hardcoded their own
 * label/color map. This module is the one place those bands, labels, and tones
 * live.
 *
 * Pure, zero-dependency, client-safe.
 */

import type { OpportunityVerdict, Recommendation } from "./types";

/**
 * Version of the canonical interpretation layer (bands, grade/verdict
 * vocabularies, tones). Bump when TIER_EDGES or any derived vocabulary
 * mapping changes, so artifacts that outlive the UI (Excel/PDF exports)
 * can state which methodology produced them.
 */
export const SCORING_METHODOLOGY_VERSION = "2026-08.1";

/** Lower inclusive edges of the HOLD, BUY, and STRONG_BUY tiers (and the
 *  SELL/STRONG_SELL split). Exported so confidence logic can measure how far a
 *  score sits from the nearest tier boundary. */
export const TIER_EDGES = [25, 42, 60, 78] as const;

/** Map a blended 0–100 score to its 5-tier recommendation. The single band
 *  function every scorer and UI must route through. */
export function scoreToRecommendation(score: number): Recommendation {
  if (score >= 78) return "STRONG_BUY";
  if (score >= 60) return "BUY";
  if (score >= 42) return "HOLD";
  if (score >= 25) return "SELL";
  return "STRONG_SELL";
}

/** Human-facing label. */
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  STRONG_BUY: "Strong Buy",
  BUY: "Buy",
  HOLD: "Hold",
  SELL: "Sell",
  STRONG_SELL: "Strong Sell",
};

/** Badge tone (text + border + background) for a recommendation. */
export const RECOMMENDATION_TONE: Record<Recommendation, string> = {
  STRONG_BUY: "text-positive border-positive/50 bg-positive/15",
  BUY: "text-positive border-positive/35 bg-positive/10",
  HOLD: "text-warning border-warning/40 bg-warning/10",
  SELL: "text-negative border-negative/35 bg-negative/10",
  STRONG_SELL: "text-negative border-negative/50 bg-negative/15",
};

/** Ring/border-only color for a recommendation (e.g. score dials). */
export const RECOMMENDATION_RING: Record<Recommendation, string> = {
  STRONG_BUY: "border-positive",
  BUY: "border-positive/60",
  HOLD: "border-warning/70",
  SELL: "border-negative/60",
  STRONG_SELL: "border-negative",
};

/** Progress-arc color for a recommendation, as a `text-*` class — the drawn
 *  score-ring counterpart of RECOMMENDATION_RING (whose arc uses currentColor,
 *  so it needs a text color rather than a border color). */
export const RECOMMENDATION_ARC: Record<Recommendation, string> = {
  STRONG_BUY: "text-positive",
  BUY: "text-positive/80",
  HOLD: "text-warning",
  SELL: "text-negative/80",
  STRONG_SELL: "text-negative",
};

/** Directional read of a raw 0–100 score, aligned to the same bands: BUY
 *  tiers are bullish, SELL tiers are bearish, HOLD is neutral. The single
 *  mapping the AI verdict and every badge share — they cannot disagree. */
export function scoreDirection(score: number): "bullish" | "bearish" | "neutral" {
  const rec = scoreToRecommendation(score);
  if (rec === "BUY" || rec === "STRONG_BUY") return "bullish";
  if (rec === "SELL" || rec === "STRONG_SELL") return "bearish";
  return "neutral";
}

/** Convenience: label for a raw 0–100 score. */
export function scoreLabel(score: number): string {
  return RECOMMENDATION_LABEL[scoreToRecommendation(score)];
}

/** Convenience: badge tone for a raw 0–100 score. */
export function scoreTone(score: number): string {
  return RECOMMENDATION_TONE[scoreToRecommendation(score)];
}

/* -------------------------------------------------------------------------- */
/* Derived vocabularies — same 5 tiers, domain-appropriate words               */
/* -------------------------------------------------------------------------- */

/**
 * Non-directional quality-grade words for a 0–100 dimension score (a bucket,
 * a pillar, a sub-score). Same tier edges as the recommendation bands, so a
 * dimension graded "Good" and a composite badged "Buy" can never disagree
 * about what the same number means. Use where a Buy/Sell label would assert
 * a directional call the score does not make.
 */
export const SCORE_GRADE_LABEL: Record<Recommendation, string> = {
  STRONG_BUY: "Excellent",
  BUY: "Good",
  HOLD: "Fair",
  SELL: "Weak",
  STRONG_SELL: "Poor",
};

/** Grade word for a raw 0–100 score. */
export function scoreGrade(score: number): string {
  return SCORE_GRADE_LABEL[scoreToRecommendation(score)];
}

/**
 * Opportunity-attractiveness vocabulary (Scanner opportunities, Thematic
 * themes). Previously the Scanner banded at 75/60/45 and Thematic at
 * 80/65/50/35 — the same word ("exceptional") over two different meanings.
 * Both now derive from the one canonical band table.
 */
export const OPPORTUNITY_VERDICT: Record<Recommendation, OpportunityVerdict> = {
  STRONG_BUY: "exceptional",
  BUY: "strong",
  HOLD: "moderate",
  SELL: "weak",
  STRONG_SELL: "avoid",
};

/** Worst → best, for verdict-capping logic (e.g. Thematic's capital-cycle cap). */
export const OPPORTUNITY_VERDICT_ORDER: OpportunityVerdict[] = [
  "avoid",
  "weak",
  "moderate",
  "strong",
  "exceptional",
];

/** Opportunity verdict for a raw 0–100 score. */
export function scoreToOpportunityVerdict(score: number): OpportunityVerdict {
  return OPPORTUNITY_VERDICT[scoreToRecommendation(score)];
}

/* -------------------------------------------------------------------------- */
/* Three-step visual grammar for 0–100 meters                                 */
/* -------------------------------------------------------------------------- */

/** Coarse 3-step read of a 0–100 score, aligned to the BUY (60) and HOLD (42)
 *  edges: BUY tiers are "high", HOLD is "mid", SELL tiers are "low". The one
 *  reduction every 3-color meter must use, so a bar that turns green at 60 on
 *  one page cannot turn green at 55 or 75 on another. */
export function scoreStep(score: number): "high" | "mid" | "low" {
  const rec = scoreToRecommendation(score);
  if (rec === "STRONG_BUY" || rec === "BUY") return "high";
  if (rec === "HOLD") return "mid";
  return "low";
}

const METER_TONE: Record<ReturnType<typeof scoreStep>, { text: string; bar: string; arc: string }> = {
  high: { text: "text-positive", bar: "bg-positive", arc: "text-positive" },
  mid: { text: "text-warning", bar: "bg-warning", arc: "text-warning" },
  low: { text: "text-negative", bar: "bg-negative", arc: "text-negative" },
};

/** Text / bar-fill / arc classes for a 0–100 meter, from the canonical steps. */
export function scoreMeterTone(score: number): { text: string; bar: string; arc: string } {
  return METER_TONE[scoreStep(score)];
}

/* -------------------------------------------------------------------------- */
/* Excel (ARGB) palette for server-side exports                               */
/* -------------------------------------------------------------------------- */

const ARGB_BY_STEP: Record<ReturnType<typeof scoreStep>, { fill: string; font: string }> = {
  high: { fill: "FFD1FAE5", font: "FF065F46" },
  mid: { fill: "FFFEF9C3", font: "FF92400E" },
  low: { fill: "FFFEE2E2", font: "FF991B1B" },
};

const ARGB_MISSING = { fill: "FFFFFFFF", font: "FF6B7280" };

/** Cell fill + font ARGB for a 0–100 score in an Excel export. Null-safe. */
export function scoreArgb(score: number | null | undefined): { fill: string; font: string } {
  return score == null || Number.isNaN(score) ? ARGB_MISSING : ARGB_BY_STEP[scoreStep(score)];
}

/** Cell fill + font ARGB for a recommendation tier in an Excel export. */
export const RECOMMENDATION_ARGB: Record<Recommendation, { fill: string; font: string }> = {
  STRONG_BUY: ARGB_BY_STEP.high,
  BUY: ARGB_BY_STEP.high,
  HOLD: ARGB_BY_STEP.mid,
  SELL: ARGB_BY_STEP.low,
  STRONG_SELL: ARGB_BY_STEP.low,
};
