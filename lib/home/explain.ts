/**
 * Explainability — one contract for "how was this number produced?".
 *
 * Every major score the dashboard renders (alignment score, attention score,
 * sentiment gauge, decision score) can be decomposed on click. This module
 * builds those decompositions as pure projections of data the engines already
 * shipped in the digest — it never recomputes a score, and where a factor's
 * arithmetic is multiplicative rather than additive, the method line says so
 * instead of forcing a fake sum.
 *
 * Client-safe: pure functions over contract types. The popover that renders a
 * `ScoreExplanation` lives in app/_home/_atmosphere/explain-popover.tsx.
 *
 * Unit-tested in tests/home-explain.test.ts.
 */

import { SCORE_EXPONENTS, priorityBucket } from "./attention";
import { DEFAULT_FIT_WEIGHT } from "../ios/fit-scorer";
import type {
  AttentionItem,
  OpportunitySnapshotItem,
  PortfolioPulse,
  RecommendedAction,
  SentimentGauge,
} from "./contracts";

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

export interface ExplanationFactor {
  label: string;
  /** The factor's value as the user should read it: "72/100", "×0.86", "+3.1 pts". */
  display: string;
  /** Bar fill for visual comparison, 0-1. */
  bar: number;
  /** 1 = pushes the score up, -1 = drags it down, 0 = neutral/context. */
  direction: 1 | 0 | -1;
  detail?: string | null;
  /** Faded row — abstained/uncovered, shown because absence is information. */
  muted?: boolean;
}

export interface ScoreExplanation {
  title: string;
  /** The headline value being explained, e.g. "B · 78/100". */
  value: string;
  /** One sentence stating the actual formula/method — never "our algorithm". */
  method: string;
  confidence: { label: string; detail: string } | null;
  factors: ExplanationFactor[];
  caveats: string[];
}

/* ------------------------------------------------------------------ */
/* Builders                                                            */
/* ------------------------------------------------------------------ */

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The Attention Queue's geometric score. The three inputs and the exponents
 * are shown as they are — a multiplicative model is presented as multipliers,
 * not as a fake additive breakdown.
 */
export function explainAttentionScore(item: AttentionItem): ScoreExplanation {
  const term = (label: string, value: number, exp: number, detail: string): ExplanationFactor => {
    const multiplier = Math.pow(Math.max(0, Math.min(1, value)), exp);
    return {
      label,
      display: `${pct(value)} → ×${multiplier.toFixed(2)}`,
      bar: multiplier,
      direction: multiplier >= 0.9 ? 1 : multiplier >= 0.6 ? 0 : -1,
      detail,
    };
  };

  return {
    title: "Attention priority",
    value: `${priorityBucket(item.score).label} · ${Math.round(item.score)}/100`,
    method: `score = 100 × impact^${SCORE_EXPONENTS.impact} × urgency^${SCORE_EXPONENTS.urgency} × confidence^${SCORE_EXPONENTS.confidence} — geometric, so a near-zero in any input sinks the item. The queue shows the band; single-point differences are not meaningful.`,
    confidence: null,
    factors: [
      term("Impact", item.impact, SCORE_EXPONENTS.impact, "How much of the portfolio this touches — held names carry their book weight."),
      term("Urgency", item.urgency, SCORE_EXPONENTS.urgency, item.occursAt ? "Ramps to maximum inside 24h of the catalyst." : "Undated items sit at a flat default urgency."),
      term("Confidence", item.confidence, SCORE_EXPONENTS.confidence, "The source's own confidence when it quantifies one; a per-kind default otherwise."),
    ],
    caveats: [],
  };
}

/**
 * The Radar's fit-blended idea score. The two components ship with the digest
 * item (rankByFit's own inputs), so the decomposition genuinely reproduces the
 * number on screen. Returns null for digests cached before the components were
 * carried — a value with no explanation renders as-is, never a dead affordance.
 */
export function explainOpportunityScore(item: OpportunitySnapshotItem): ScoreExplanation | null {
  if (item.absoluteScore == null || item.fitScore == null) return null;
  const qw = 1 - DEFAULT_FIT_WEIGHT;
  return {
    title: "Fit score",
    value: `${Math.round(item.combinedScore)}/100`,
    method: `fit score = ${qw.toFixed(1)} × scanner quality + ${DEFAULT_FIT_WEIGHT.toFixed(1)} × portfolio fit, each 0–100 — how good the idea is, weighted by how well it suits this book.`,
    confidence: null,
    factors: [
      {
        label: "Scanner quality",
        display: `${Math.round(item.absoluteScore)} × ${qw.toFixed(1)}`,
        bar: item.absoluteScore / 100,
        direction: item.absoluteScore >= 60 ? 1 : item.absoluteScore >= 40 ? 0 : -1,
        detail: "The idea's standalone composite from the scanner — unchanged by your portfolio.",
      },
      {
        label: "Portfolio fit",
        display: `${Math.round(item.fitScore)} × ${DEFAULT_FIT_WEIGHT.toFixed(1)}`,
        bar: item.fitScore / 100,
        direction: item.fitScore >= 60 ? 1 : item.fitScore >= 40 ? 0 : -1,
        detail: "Sector, correlation, objective, style, geography, and sizing effects on this book.",
      },
    ],
    caveats: [
      "A different scale from the Attention queue's priority score, which ranks how urgently an item needs a decision.",
    ],
  };
}

/**
 * The portfolio alignment score, decomposed into the engine's own themes.
 * `weightShare × score` are exactly the terms `computeAlignment` summed, so
 * these rows genuinely add to the number on screen. Weights are the INVESTOR'S
 * stated priorities, not UAA's — that is the whole point of the score.
 */
export function explainAlignment(pulse: PortfolioPulse): ScoreExplanation | null {
  if (pulse.alignmentScore == null || pulse.alignmentFactors.length === 0) return null;

  const factors: ExplanationFactor[] = pulse.alignmentFactors.map((f) => {
    if (f.score == null || f.weightShare == null) {
      return {
        label: f.label,
        display: f.unratedReason === "opted_out" ? "not a priority" : "insufficient data",
        bar: 0,
        direction: 0 as const,
        detail:
          f.unratedReason === "opted_out"
            ? "You've said this doesn't matter to you — it is reported as a fact and carries no weight in the score."
            : "Cannot be measured honestly on this book's data, so it is excluded from the score by name rather than guessed.",
        muted: true,
      };
    }
    return {
      label: f.label,
      display: `${Math.round(f.score)} · ${pct(f.weightShare)} of score`,
      bar: f.score / 100,
      direction: (f.score >= (pulse.alignmentScore ?? 0) ? 1 : -1) as 1 | -1,
      detail:
        `${f.contributionPts != null ? `Contributes ${f.contributionPts} of the total, weighted by your stated priority. ` : ""}` +
        (f.evidencePct < 100 ? `The underlying facts cover ${f.evidencePct}% of portfolio value.` : ""),
      muted: !f.covered,
    };
  });

  const caveats: string[] = [];
  if (!pulse.alignmentConfirmed) {
    caveats.push("Scored against assumed default priorities — set your own policy on the Portfolio page to make this score yours.");
  }
  if (pulse.alignmentEvidencePct != null && pulse.alignmentEvidencePct < 90) {
    caveats.push(`The facts behind the scored themes cover ${Math.round(pulse.alignmentEvidencePct)}% of portfolio value — stated as disclosure, never blended into the arithmetic.`);
  }

  return {
    title: "Portfolio alignment",
    value: `${pulse.alignmentScore}/100${pulse.alignmentLabel ? ` · ${pulse.alignmentLabel}` : ""}`,
    method: "Weighted average of the theme scores below, weighted by YOUR stated priorities (renormalized over the themes that could be measured). Themes you opted out of are facts, not judgments. Contributions are shown at 0.1-pt precision and sum to the total.",
    confidence:
      pulse.alignmentEvidencePct != null
        ? {
            label: `${Math.round(pulse.alignmentEvidencePct)}% evidence`,
            detail: "Priority-weighted share of portfolio value the scored themes could actually see.",
          }
        : null,
    factors,
    caveats,
  };
}

/** The in-house sentiment gauge — its components ship with it precisely for this. */
export function explainSentiment(gauge: SentimentGauge): ScoreExplanation {
  return {
    title: "Sentiment gauge",
    value: `${gauge.label} · ${Math.round(gauge.score)}/100`,
    method: "Weighted blend of the components below; components with no data are dropped and the remaining weights renormalized — never defaulted to neutral.",
    confidence: {
      label: `${gauge.confidence} confidence`,
      detail: "Driven by how many of the components had data for this build.",
    },
    factors: gauge.components.map((c) => ({
      label: c.name,
      display: c.value != null ? `${Math.round(c.value)} → ${c.contribution >= 0 ? "+" : ""}${c.contribution.toFixed(1)}` : "no data",
      bar: c.value != null ? Math.max(0, Math.min(1, c.value / 100)) : 0,
      direction: c.value == null ? 0 : c.contribution >= 0 ? 1 : -1,
      muted: c.value == null,
    })),
    caveats: [
      "This is UAA's own gauge computed from inputs the platform already fetches — it is NOT CNN's Fear & Greed Index.",
    ],
  };
}

/**
 * A decision's score and its measured portfolio impact. Everything here was
 * produced by simulating the trade through the real engines; the caveat about
 * price returns is the engine's own honesty, carried through.
 */
export function explainDecision(action: RecommendedAction): ScoreExplanation | null {
  if (action.decisionScore == null || action.impact == null) return null;
  const im = action.impact;

  const factors: ExplanationFactor[] = [];
  if (im.alignmentDelta != null) {
    factors.push({
      label: "Alignment impact",
      display: `${im.alignmentDelta >= 0 ? "+" : ""}${im.alignmentDelta.toFixed(1)} pts`,
      bar: Math.min(1, Math.abs(im.alignmentDelta) / 10),
      direction: im.alignmentDelta > 0 ? 1 : im.alignmentDelta < 0 ? -1 : 0,
      detail:
        im.alignmentBefore != null && im.alignmentAfter != null
          ? `Portfolio alignment ${im.alignmentBefore} → ${im.alignmentAfter} if executed, against your stated policy.`
          : "Measured change in how closely the book matches your stated policy.",
    });
  }

  if (im.riskDeltaPp != null) {
    factors.push({
      label: "Risk",
      display: `${im.riskDeltaPp >= 0 ? "+" : "−"}${Math.abs(im.riskDeltaPp).toFixed(1)}pp vol`,
      bar: Math.min(1, Math.abs(im.riskDeltaPp) / 5),
      direction: im.riskDeltaPp < 0 ? 1 : im.riskDeltaPp > 0 ? -1 : 0,
      detail: "Change in annualized portfolio volatility, measured by re-running the risk engine on the simulated book.",
    });
  }

  if (Math.abs(im.incomeDeltaAnnual) >= 1) {
    factors.push({
      label: "Income",
      display: `${im.incomeDeltaAnnual >= 0 ? "+" : "−"}$${Math.abs(Math.round(im.incomeDeltaAnnual)).toLocaleString()}/yr`,
      bar: Math.min(1, Math.abs(im.incomeDeltaAnnual) / 1000),
      direction: im.incomeDeltaAnnual > 0 ? 1 : -1,
      detail: "Measured dividends/coupons/rent only.",
    });
  }

  if (Math.abs(im.diversificationDelta) >= 1) {
    factors.push({
      label: "Diversification",
      display: `${im.diversificationDelta < 0 ? "improves" : "worsens"}`,
      bar: Math.min(1, Math.abs(im.diversificationDelta) / 500),
      direction: im.diversificationDelta < 0 ? 1 : -1,
      detail: "Change in allocation concentration (HHI) on the simulated book.",
    });
  }

  return {
    title: "Decision score",
    value: `${action.decisionScore}/100`,
    method: "Measured alignment impact × the engine's confidence, rescaled to 0-100 with 50 = \"doing nothing\". Every delta below comes from simulating the trade, not estimating it.",
    confidence:
      action.confidence != null
        ? {
            label: `${Math.round(action.confidence * 100)}% confidence`,
            detail: "The engine's confidence in the measured impact, driven by data coverage on the holdings involved.",
          }
        : null,
    factors,
    caveats: [
      `${action.alternativesEvaluated ?? 0} alternative allocations were actually simulated before this pick.`,
      "No forward price-return is forecast anywhere in this app — the case rests on measured alignment, risk, income, and diversification effects.",
    ],
  };
}
