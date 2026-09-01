/**
 * Unified action matrix — THE single decision layer of the recommendation
 * hierarchy.
 *
 * ── Where this sits ──────────────────────────────────────────────────────────
 *
 *   Research Score (lib/scoring.ts / asset-class scorers — standalone quality)
 *        ↓
 *   Portfolio Context Engine (lib/ios/fit-scorer.ts dimensions)
 *        ↓
 *   Portfolio Fit Score (research + portfolio effects, fit-scorer.ts)
 *        ↓
 *   THIS MODULE — one action from BOTH scores
 *        ↓
 *   Recommended allocation (fit-scorer sizing × this module's sizeFactor)
 *        ↓
 *   Final AI recommendation (lib/ai/report-sections.ts narrates this action)
 *
 * The matrix exists so no surface can ever derive its own contradictory call:
 * the fit panel, the position action card (lib/position-action.ts), and the AI
 * verdict prompt all consume the UnifiedAction computed here, carried on
 * PortfolioFitAnalysis.
 *
 * ── The rules it encodes ─────────────────────────────────────────────────────
 *
 *   • Poor research is a veto. A SELL-band asset is avoided (or exited)
 *     regardless of how well it would diversify the book.
 *   • Hard constraints are a veto with a name. A gate (excluded symbol, sector
 *     cap breach, …) always carries its capReason into the action's rationale.
 *   • Excellent research is never silently buried: poor fit shrinks the
 *     position to a starter (or holds an existing one) rather than "avoid",
 *     unless a hard constraint applies.
 *   • Average research never earns more than a starter, however good the fit —
 *     diversification benefit cannot manufacture conviction.
 *
 * Research bands reuse the canonical tier edges from lib/recommendation.ts;
 * fit bands reuse FIT_TIER_EDGES (also exported for the fit scorer). No
 * thresholds are defined here that exist anywhere else.
 *
 * Pure, deterministic, client-safe — no I/O, no AI.
 */

import { scoreToRecommendation, RECOMMENDATION_LABEL } from "../recommendation";
import type { FitTier, UnifiedAction, UnifiedActionKind } from "./types";

/** Lower inclusive edges of the fit tiers — the one place they are defined. */
export const FIT_TIER_EDGES = { excellent: 80, good: 62, neutral: 45, poor: 30 } as const;

/** Map a 0-100 fit score to its tier. Shared with the fit scorer. */
export function fitTier(score: number): FitTier {
  if (score >= FIT_TIER_EDGES.excellent) return "excellent";
  if (score >= FIT_TIER_EDGES.good) return "good";
  if (score >= FIT_TIER_EDGES.neutral) return "neutral";
  if (score >= FIT_TIER_EDGES.poor) return "poor";
  return "avoid";
}

const FIT_METER_TONE: Record<FitTier, { text: string; bar: string }> = {
  excellent: { text: "text-positive", bar: "bg-positive" },
  good: { text: "text-positive", bar: "bg-positive" },
  neutral: { text: "text-warning", bar: "bg-warning" },
  poor: { text: "text-negative", bar: "bg-negative" },
  avoid: { text: "text-negative", bar: "bg-negative" },
};

/** Meter colors for a 0-100 FIT score, derived from the fit tiers — the fit
 *  counterpart of lib/recommendation.ts's scoreMeterTone. Fit is NOT a
 *  directional call (see lib/score-kinds.ts), so its meters must color at the
 *  fit tier edges, not at the Buy/Hold band edges — but they must all use the
 *  SAME fit edges, not a per-component table. */
export function fitMeterTone(score: number): { text: string; bar: string } {
  return FIT_METER_TONE[fitTier(score)];
}

export interface UnifiedActionInput {
  /** Standalone Research Score (0-100), null when no scorer covered the asset. */
  researchScore: number | null;
  /** Portfolio Fit Score (0-100) — already inherits the research score. */
  fitScore: number;
  isInPortfolio: boolean;
  /** The hard gate that clamped the fit score, if any (names the constraint). */
  capReason: string | null;
}

const act = (kind: UnifiedActionKind, sizeFactor: number, reason: string): UnifiedAction => ({
  kind,
  sizeFactor,
  reason,
});

function researchLabel(r: number): string {
  return RECOMMENDATION_LABEL[scoreToRecommendation(r)];
}

/**
 * Derive the single portfolio action from both canonical scores.
 *
 * Every branch's reason cites the actual numbers, so any apparent divergence
 * between the two scores arrives with its quantitative explanation attached.
 */
export function deriveUnifiedAction(input: UnifiedActionInput): UnifiedAction {
  const { researchScore: r, fitScore: f, isInPortfolio: held, capReason } = input;
  const tier = fitTier(f);

  // ── Hard constraints and the avoid band veto everything ──────────────────
  if (capReason || tier === "avoid") {
    const why = capReason ?? `portfolio fit ${f}/100 is in the avoid band`;
    return held
      ? act("exit", 0, `Exit: ${why}${r != null ? ` (research ${r}/100)` : ""}.`)
      : act("avoid", 0, `Do not add: ${why}${r != null ? ` (research ${r}/100)` : ""}.`);
  }

  // ── No research score: fit is the only evidence (legacy degradation) ─────
  if (r == null) {
    if (tier === "excellent" || tier === "good") {
      return act(held ? "add" : "initiate", tier === "excellent" ? 1 : 0.85,
        `Portfolio fit ${f}/100 (${tier}); no research score is available, so sizing rests on fit alone.`);
    }
    if (tier === "neutral") {
      return held
        ? act("hold", 1, `Neutral fit (${f}/100) and no research score — keep the position, don't add.`)
        : act("starter", 0.5, `Neutral fit (${f}/100) and no research score — a small starter at most.`);
    }
    return held
      ? act("hold", 0, `Poor fit (${f}/100) and no research score — hold, do not add.`)
      : act("wait", 0, `Poor fit (${f}/100) and no research score — wait for better evidence.`);
  }

  const rec = scoreToRecommendation(r);

  // ── Poor research is a veto, whatever the diversification math says ──────
  if (rec === "SELL" || rec === "STRONG_SELL") {
    return held
      ? act("exit", 0, `Research score ${r}/100 (${researchLabel(r)}) — a weak asset is not rescued by portfolio math.`)
      : act("avoid", 0, `Research score ${r}/100 (${researchLabel(r)}) — diversification benefit cannot justify a weak asset.`);
  }

  // ── STRONG_BUY research ───────────────────────────────────────────────────
  if (rec === "STRONG_BUY") {
    if (f >= FIT_TIER_EDGES.good) {
      return act(held ? "add" : "initiate", 1,
        `Research ${r}/100 (${researchLabel(r)}) and portfolio fit ${f}/100 both support a full-size position.`);
    }
    if (f >= FIT_TIER_EDGES.neutral) {
      return act(held ? "add" : "initiate", 0.75,
        `Excellent research (${r}/100) with moderate portfolio fit (${f}/100) — sized below full conviction.`);
    }
    return held
      ? act("hold", 1, `Excellent research (${r}/100) but poor portfolio fit (${f}/100) — keep the position, don't add to it.`)
      : act("starter", 0.5, `Excellent research (${r}/100) but poor portfolio fit (${f}/100) — a reduced starter position only.`);
  }

  // ── BUY research ──────────────────────────────────────────────────────────
  if (rec === "BUY") {
    if (f >= FIT_TIER_EDGES.good) {
      return act(held ? "add" : "initiate", 0.85,
        `Research ${r}/100 (Buy) with good portfolio fit (${f}/100).`);
    }
    if (f >= FIT_TIER_EDGES.neutral) {
      return held
        ? act("hold", 1, `Buy-grade research (${r}/100) but only neutral fit (${f}/100) — the current position is enough.`)
        : act("starter", 0.6, `Buy-grade research (${r}/100) with neutral fit (${f}/100) — start small.`);
    }
    return held
      ? act("hold", 1, `Buy-grade research (${r}/100) but poor portfolio fit (${f}/100) — hold without adding.`)
      : act("wait", 0, `Buy-grade research (${r}/100), but this portfolio doesn't support it right now (fit ${f}/100).`);
  }

  // ── HOLD-band research: diversification alone never buys conviction ──────
  if (f >= FIT_TIER_EDGES.excellent) {
    return held
      ? act("hold", 1, `Average research (${r}/100) — the excellent fit (${f}/100) justifies keeping, not adding.`)
      : act("starter", 0.5, `Average research (${r}/100) but excellent portfolio fit (${f}/100) — a starter position at most.`);
  }
  return held
    ? act("hold", 1, `Hold-grade research (${r}/100) with fit ${f}/100 — no change recommended.`)
    : act("wait", 0, `Hold-grade research (${r}/100) — no allocation recommended at fit ${f}/100.`);
}
