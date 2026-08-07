/**
 * Asset Signal — the research report's verdict, shaped for the sizing engine.
 *
 * position-size.ts used to size purely on portfolio geometry (asset-class
 * distance + health deltas). That machinery cannot tell a Strong Buy at 30%
 * upside from a deteriorating value trap — both are "an equity", so both sized
 * identically (usually to $0 on any equity-overweight book). This module fixes
 * that by carrying the SAME numbers the Research page shows — composite score,
 * recommendation band, valuation upside, quality, risk flags, momentum,
 * scoring confidence — into the sizing decision, so the buy modal can never
 * contradict the research report it sits next to.
 *
 * Two layers, both pure (no I/O — the API route fetches, this file shapes):
 *
 *   1. deriveAssetSignal()  — FundamentalsData (lib/fundamentals-data.ts, the
 *      Research page's own data object) → a small, serializable AssetSignal.
 *      Single source of truth: every field is read from the research engines
 *      (lib/scoring.ts / lib/recommendation.ts), never recomputed here.
 *   2. assessConviction()   — AssetSignal → a 0..1 conviction and the position
 *      weight that conviction supports, with every adjustment named so the UI
 *      can show exactly why the number is what it is.
 */

import { RECOMMENDATION_LABEL, scoreToRecommendation } from "../../recommendation";
import type { FundamentalsData, Recommendation } from "../../types";

/** The research-report inputs the sizing engine consumes. Serializable — echoed back in the API response for explainability. */
export interface AssetSignal {
  symbol: string;
  /** lib/scoring.ts's blended decision score, 0-100 — the number the Research page headlines. */
  compositeScore: number | null;
  /** The Research page's verdict band, via lib/recommendation.ts — the shared single source of truth. */
  recommendation: Recommendation | null;
  /** 0-100. computeScore()'s own confidence in its inputs. */
  scoreConfidence: number | null;
  /** Best available upside vs the current price, in % — the user's own valuation case when one exists, else analyst consensus. */
  upsidePct: number | null;
  upsideBasis: "valuation_case" | "analyst_consensus" | null;
  /** Bucket scores as 0-100 percentages of max, when scored. */
  qualityPct: number | null;
  valuationPct: number | null;
  growthPct: number | null;
  financialHealthPct: number | null;
  momentumTrend: "up" | "down" | "flat" | null;
  /** Annual dividend yield in % (not a fraction). */
  dividendYieldPct: number | null;
  /** High-severity red flags from assessRisks() — each one dampens conviction. */
  highRisks: string[];
}

function bucketPct(data: FundamentalsData, name: string): number | null {
  const b = data.score.buckets.find((x) => x.name === name);
  return b && b.max > 0 ? Math.round((b.points / b.max) * 100) : null;
}

/**
 * Shape the Research page's own FundamentalsData into an AssetSignal.
 * `valuationCaseUpsidePct` is the user's own fair-value case (when one exists),
 * which outranks analyst consensus — their judgment beats the street's.
 * Returns null when there is no score at all (non-equity instruments, fetch
 * failure) — the sizing engine then falls back to its signal-free path.
 */
export function deriveAssetSignal(
  symbol: string,
  data: FundamentalsData | null,
  valuationCaseUpsidePct: number | null = null,
): AssetSignal | null {
  if (!data?.score) return null;
  const analystUpside = data.analyst?.upsidePercent ?? null;
  const useCase = valuationCaseUpsidePct != null && Number.isFinite(valuationCaseUpsidePct);
  const upsidePct = useCase ? valuationCaseUpsidePct : analystUpside;
  const dividendYield = data.snapshot?.dividendYield ?? null;

  return {
    symbol: symbol.toUpperCase(),
    compositeScore: data.score.composite,
    recommendation: data.score.recommendation ?? scoreToRecommendation(data.score.composite),
    scoreConfidence: data.score.confidence,
    upsidePct: upsidePct != null && Number.isFinite(upsidePct) ? Math.round(upsidePct * 10) / 10 : null,
    upsideBasis: upsidePct == null ? null : useCase ? "valuation_case" : "analyst_consensus",
    qualityPct: bucketPct(data, "Quality"),
    valuationPct: bucketPct(data, "Valuation"),
    growthPct: bucketPct(data, "Growth"),
    financialHealthPct: bucketPct(data, "Financial Health"),
    momentumTrend: data.momentum?.trend ?? null,
    dividendYieldPct: dividendYield != null ? Math.round(dividendYield * 1000) / 10 : null,
    highRisks: (data.risks ?? []).filter((r) => r.level === "high").map((r) => r.reason).slice(0, 4),
  };
}

/* -------------------------------------------------------------------------- */
/* Conviction — how large a position does this research case support?          */
/* -------------------------------------------------------------------------- */

/**
 * The largest weight conviction alone can support, in % of the portfolio,
 * before any portfolio-context damping. 6.5% ≈ a full active position in a
 * ~15-30 name book; the concentration cap (maxHoldingPct, default 20%) remains
 * a separate hard constraint and is deliberately NOT reachable on conviction
 * alone — sizing to the cap is a decision for Manual Allocation.
 */
const MAX_CONVICTION_WEIGHT_PCT = 6.5;
/** Weight of a minimum "starter" position — the smallest allocation worth recommending at all. */
const STARTER_WEIGHT_PCT = 1.0;
/** Conviction below this rounds to "don't add" — the measured edge is inside the noise. */
const MIN_ACTIONABLE_CONVICTION = 0.08;

export interface ConvictionAssessment {
  /** 0..1. 0 = no case for adding; 1 = the strongest case the research engines can express. */
  conviction: number;
  /** The position weight (as % of portfolio) this conviction supports, BEFORE portfolio-context damping. 0 when vetoed or negligible. */
  targetWeightPct: number;
  /** True when the research verdict itself argues against adding (SELL / STRONG_SELL). */
  vetoed: boolean;
  vetoReason: string | null;
  /** Named components, for the "why" — every adjustment that moved the number. */
  drivers: string[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Research verdict → conviction → supported position weight.
 *
 * The mapping is anchored on lib/recommendation.ts's own bands so the modal
 * can never disagree with the Research page's badge:
 *   composite 42 (bottom of HOLD) → conviction 0
 *   composite 85 (deep STRONG_BUY) → conviction 1 (before adjustments)
 * Valuation upside, red flags and momentum then shift it, and the whole thing
 * is scaled by the score's own confidence — a Strong Buy scored on thin data
 * sizes like a tentative Buy, not like a table-pounder.
 */
export function assessConviction(signal: AssetSignal): ConvictionAssessment {
  const drivers: string[] = [];
  const composite = signal.compositeScore;

  if (composite == null) {
    return { conviction: 0, targetWeightPct: 0, vetoed: false, vetoReason: null, drivers: ["No research score available."] };
  }

  const label = RECOMMENDATION_LABEL[signal.recommendation ?? scoreToRecommendation(composite)];
  drivers.push(`Research composite ${Math.round(composite)}/100 (${label}).`);

  if (signal.recommendation === "SELL" || signal.recommendation === "STRONG_SELL") {
    const downside = signal.upsidePct != null && signal.upsidePct < 0 ? ` with ${Math.abs(signal.upsidePct).toFixed(0)}% modeled downside` : "";
    return {
      conviction: 0,
      targetWeightPct: 0,
      vetoed: true,
      vetoReason: `The research verdict is ${label} (composite ${Math.round(composite)}/100)${downside} — the report itself argues against adding.`,
      drivers,
    };
  }

  // 42 = bottom of the HOLD band, 85 = deep in STRONG_BUY (lib/recommendation.ts TIER_EDGES).
  let raw = clamp((composite - 42) / 43, 0, 1);

  if (signal.upsidePct != null) {
    const adj = clamp(signal.upsidePct / 100, -0.35, 0.3);
    raw += adj;
    const basis = signal.upsideBasis === "valuation_case" ? "your valuation case" : "analyst consensus";
    if (signal.upsidePct >= 10) drivers.push(`${signal.upsidePct.toFixed(0)}% upside vs ${basis}.`);
    else if (signal.upsidePct <= -5) drivers.push(`${Math.abs(signal.upsidePct).toFixed(0)}% downside vs ${basis} — valuation limits the size.`);
  }

  // Saturate BEFORE the penalties, so a red flag always costs conviction — on
  // a score already at the ceiling it would otherwise vanish into the clamp.
  raw = clamp(raw, 0, 1);

  if (signal.highRisks.length > 0) {
    raw -= 0.07 * Math.min(signal.highRisks.length, 3);
    drivers.push(`${signal.highRisks.length} high-severity risk flag${signal.highRisks.length > 1 ? "s" : ""} (e.g. ${signal.highRisks[0]}).`);
  }

  if (signal.momentumTrend === "down") {
    raw -= 0.05;
    drivers.push("Price momentum is trending down.");
  }

  const conf = clamp((signal.scoreConfidence ?? 50) / 100, 0, 1);
  const conviction = clamp(raw, 0, 1) * (0.55 + 0.45 * conf);
  if (conf < 0.45) drivers.push(`Scaled down for low scoring confidence (${Math.round(conf * 100)}%).`);

  const targetWeightPct = conviction < MIN_ACTIONABLE_CONVICTION
    ? 0
    : Math.round((STARTER_WEIGHT_PCT + conviction * (MAX_CONVICTION_WEIGHT_PCT - STARTER_WEIGHT_PCT)) * 10) / 10;

  return { conviction: Math.round(conviction * 100) / 100, targetWeightPct, vetoed: false, vetoReason: null, drivers };
}
