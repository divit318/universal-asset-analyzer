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

import type { Recommendation } from "./types";

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

/** Convenience: label for a raw 0–100 score. */
export function scoreLabel(score: number): string {
  return RECOMMENDATION_LABEL[scoreToRecommendation(score)];
}

/** Convenience: badge tone for a raw 0–100 score. */
export function scoreTone(score: number): string {
  return RECOMMENDATION_TONE[scoreToRecommendation(score)];
}
