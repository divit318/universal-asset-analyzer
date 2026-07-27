/**
 * Explainability — one contract for "how was this number produced?".
 *
 * Every major score the dashboard renders (health grade, attention score,
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

import { SCORE_EXPONENTS } from "./attention";
import type {
  AttentionItem,
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
    title: "Attention score",
    value: `${Math.round(item.score)}/100`,
    method: `score = 100 × impact^${SCORE_EXPONENTS.impact} × urgency^${SCORE_EXPONENTS.urgency} × confidence^${SCORE_EXPONENTS.confidence} — geometric, so a near-zero in any input sinks the item.`,
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
 * The portfolio health total, decomposed into the engine's own dimensions.
 * `weightShare × score` are exactly the terms `computeHealth` summed, so these
 * rows genuinely add to the number on screen.
 */
export function explainHealth(pulse: PortfolioPulse): ScoreExplanation | null {
  if (pulse.healthScore == null || pulse.healthFactors.length === 0) return null;

  const factors: ExplanationFactor[] = pulse.healthFactors.map((f) => {
    if (f.score == null || f.weightShare == null) {
      return {
        label: f.label,
        display: "abstained",
        bar: 0,
        direction: 0 as const,
        detail: "Not enough evidence to score this dimension for this portfolio — it carries no weight rather than a guessed value.",
        muted: true,
      };
    }
    return {
      label: f.label,
      display: `${Math.round(f.score)} · ${pct(f.weightShare)} wt`,
      bar: f.score / 100,
      direction: (f.score >= (pulse.healthScore ?? 0) ? 1 : -1) as 1 | -1,
      detail:
        `${f.contributionPts != null ? `Contributes ${f.contributionPts} of the total. ` : ""}` +
        (f.coveragePct < 100 ? `Scored on ${f.coveragePct}% of the book's evidence, so its weight is discounted accordingly.` : ""),
      muted: !f.covered,
    };
  });

  const caveats: string[] = [];
  if (pulse.healthCoveragePct != null && pulse.healthCoveragePct < 90) {
    caveats.push(`${100 - Math.round(pulse.healthCoveragePct)}% of the nominal scoring weight could not be evidenced for this portfolio.`);
  }

  return {
    title: "Portfolio health",
    value: `${pulse.healthGrade ?? "?"} · ${pulse.healthScore}/100`,
    method: "Weighted average of the dimension scores below; each weight is scaled by how much of the book that dimension could actually evidence, then renormalized.",
    confidence:
      pulse.healthCoveragePct != null
        ? {
            label: `${Math.round(pulse.healthCoveragePct)}% coverage`,
            detail: "Share of the scoring weight resting on measured evidence rather than abstentions.",
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

  const factors: ExplanationFactor[] = [
    {
      label: "Health impact",
      display: `${im.healthDelta >= 0 ? "+" : ""}${im.healthDelta.toFixed(1)} pts`,
      bar: Math.min(1, Math.abs(im.healthDelta) / 10),
      direction: im.healthDelta > 0 ? 1 : im.healthDelta < 0 ? -1 : 0,
      detail: `Portfolio health ${im.healthBefore} → ${im.healthAfter} if executed.`,
    },
  ];

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
    method: "Measured health impact × the engine's confidence, rescaled to 0-100 with 50 = \"doing nothing\". Every delta below comes from simulating the trade, not estimating it.",
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
      "No forward price-return is forecast anywhere in this app — the case rests on measured health, risk, income, and diversification effects.",
    ],
  };
}
