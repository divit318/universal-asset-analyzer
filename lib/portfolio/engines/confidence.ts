/**
 * ONE definition of Confidence, for every recommendation the Decisions module makes.
 *
 * ── The question it answers ───────────────────────────────────────────────────
 *
 *   "How much of the evidence behind THIS CARD'S NUMBERS was actually observed,
 *    rather than assumed?"
 *
 * 0-100. Nothing else. It is deliberately independent of:
 *
 *   • how LARGE the impact is          → the Impact chips already state that
 *   • how URGENT the gap is            → `why.whyNow` and the sizing state that
 *   • how BIG the position is          → the recommendation title states that
 *   • which ACTION it is               → an ADD and a SELL on the same portfolio,
 *                                        about equally-well-evidenced assets, must
 *                                        read the same number
 *   • whether the trade will WORK      → this app forecasts no returns, so a
 *                                        probability of success would be invented
 *
 * ── Why this is not a new invention ──────────────────────────────────────────
 *
 * This is the definition the rest of the app has always used. `HoldingScore.confidence`
 * is documented in model/types.ts as "how much of the class's scoring inputs were
 * actually available", every class adapter computes it that way, and health.ts,
 * allocation.ts and optimize.ts all confidence-WEIGHT their aggregates on that
 * reading ("a score of 70 at confidence 20 must never outrank a 65 at confidence 90").
 *
 * The recommendation layer was the one place that drifted. It had three different
 * meanings under one label:
 *
 *   ADD     `base(gap.severity) + min(|healthDelta|×4, 20) + (markQuality−0.5)×20`
 *           — urgency + effect size + evidence quality, blended into one number.
 *   REDUCE  `min(90, 60 + weight)` — a monotone function of POSITION SIZE. A 25%
 *           holding scored 85%, a 22% holding 82%, on no evidence about either.
 *   SELL    `holding.score.confidence` — the only one that was already canonical.
 *
 * So "85% confidence" meant "the gap is severe and the effect is large" on one
 * card and "this position is enormous" on the next. Those are not comparable, and
 * an investor ranking cards by that number was being misled.
 *
 * Worse, it double-counted: `decisionScore = healthDelta × confidence` while ADD's
 * confidence itself contained `|healthDelta| × 4`, so effect size entered the
 * ranking QUADRATICALLY for ADDs and LINEARLY for trims and exits. Two cards with
 * identical measured impact could not be ranked against each other honestly.
 *
 * ── The four factors ─────────────────────────────────────────────────────────
 *
 * Each is a share-of-inputs-observed in 0-100, and each is available for every
 * recommendation type, which is what makes the scores comparable:
 *
 *   1. SUBJECT EVIDENCE (35%) — the asset being acted on, via its own
 *      `HoldingScore.confidence`. Weighted heaviest because a recommendation is
 *      fundamentally a claim about one asset: if the class could not score it, the
 *      card does not know what buying or selling it does. A holding the class
 *      cannot score at all reads 0 here rather than a flattering default —
 *      "unknown must read as unknown" is the same rule that makes `score` nullable.
 *   2. HEALTH COVERAGE (30%) — `health.coveragePct`. The headline claim on every
 *      card is a health delta, so the share of the health score that was actually
 *      scoreable bounds how much that delta can be trusted.
 *   3. MARK QUALITY (20%) — the share of portfolio value priced by a live market
 *      (or held as cash) and not stale. Every delta is measured against this
 *      baseline. Uses the SAME predicate as `normalizeHoldings`' marketPricedPct,
 *      so this factor and the report's "Valuation basis" disclosure agree by
 *      construction rather than by coincidence.
 *   4. RISK OBSERVABILITY (15%) — `risk.coverage.observedPct`, included ONLY when
 *      the card actually states a volatility number. When `riskDelta` is null the
 *      card makes no volatility claim, so missing return history is not a reason
 *      to doubt the claims it does make; the factor drops out and the remaining
 *      weights renormalise. Lightest weight because it qualifies one line of the
 *      card rather than its headline.
 *
 * Deterministic: same portfolio and same subject always produce the same score,
 * with no clock, no randomness and no model in the path.
 */

import type { Holding } from "../model/types";
import type { PortfolioEvaluation } from "./simulate";

/**
 * A simulated delta on a real ledger always rests on SOME observed evidence, and
 * never on complete evidence — no forward-looking claim about a portfolio is ever
 * 100% grounded. The band is the same one the previous implementation used, so
 * every stored/displayed confidence stays in its historical range.
 */
export const CONFIDENCE_FLOOR = 20;
export const CONFIDENCE_CEILING = 95;

const WEIGHT_SUBJECT = 0.35;
const WEIGHT_HEALTH_COVERAGE = 0.30;
const WEIGHT_MARK_QUALITY = 0.20;
const WEIGHT_RISK_OBSERVABILITY = 0.15;

export interface ConfidenceFactor {
  label: string;
  /** 0-100. Share of this factor's inputs that were actually observed. */
  observedPct: number;
  /** Share of the blend this factor carried, 0-1, after renormalisation. */
  weight: number;
  /** Deterministic one-line statement of what was observed. Never AI-generated. */
  detail: string;
}

export interface ConfidenceAssessment {
  /** 0-100, clamped to [CONFIDENCE_FLOOR, CONFIDENCE_CEILING]. */
  score: number;
  factors: ConfidenceFactor[];
  /** One sentence per factor, in weight order — the card's "why this number". */
  basis: string[];
}

/**
 * Share of portfolio value that is priced by a live market (or is cash) and not
 * stale. Same predicate as normalizeHoldings' marketPricedPct — cash counts as
 * KNOWN, because face value is a certainty, not an estimate.
 */
function markQualityPct(evaluation: PortfolioEvaluation): number {
  if (evaluation.totalValue <= 0) return 0;
  const known = evaluation.holdings
    .filter((h) => (h.valuation.mode === "market" || h.valuation.mode === "cash") && !h.valuation.stale)
    .reduce((s, h) => s + h.valuation.valueBase, 0);
  return (known / evaluation.totalValue) * 100;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 0));

/**
 * Assess how well-evidenced a recommendation's numbers are.
 *
 * @param evaluation The PRE-trade portfolio — the baseline the impact was measured
 *   against, and therefore the evidence the card actually rests on.
 * @param subject The asset being acted on: an existing holding for a trim or an
 *   exit, the simulated candidate holding for a buy, or null for a portfolio-level
 *   recommendation with no single subject (the subject factor then drops out).
 * @param opts.riskMeasured Whether the card states a volatility number at all.
 */
export function assessConfidence(
  evaluation: PortfolioEvaluation,
  subject: Holding | null,
  opts: { riskMeasured: boolean },
): ConfidenceAssessment {
  const factors: ConfidenceFactor[] = [];

  if (subject) {
    const name = subject.symbol ?? subject.name;
    factors.push(
      subject.score
        ? {
            label: "Subject evidence",
            observedPct: clampPct(subject.score.confidence),
            weight: WEIGHT_SUBJECT,
            detail: `${subject.score.confidence}% of the scoring inputs for ${name} were available.`,
          }
        : {
            label: "Subject evidence",
            observedPct: 0,
            weight: WEIGHT_SUBJECT,
            detail: `${name} could not be scored by its asset class at all, so nothing is known about the asset itself.`,
          },
    );
  }

  const healthCoverage = clampPct(evaluation.health.coveragePct);
  factors.push({
    label: "Health coverage",
    observedPct: healthCoverage,
    weight: WEIGHT_HEALTH_COVERAGE,
    detail: `${Math.round(healthCoverage)}% of the health score — which this card's headline delta is measured on — was scoreable.`,
  });

  const markQuality = clampPct(markQualityPct(evaluation));
  factors.push({
    label: "Mark quality",
    observedPct: markQuality,
    weight: WEIGHT_MARK_QUALITY,
    detail: `${Math.round(markQuality)}% of portfolio value is priced by a live market or held as cash, not self-reported.`,
  });

  if (opts.riskMeasured) {
    const observed = clampPct(evaluation.risk.coverage.observedPct);
    factors.push({
      label: "Risk observability",
      observedPct: observed,
      weight: WEIGHT_RISK_OBSERVABILITY,
      detail: `${Math.round(observed)}% of value has a real return series behind the volatility figure.`,
    });
  }

  // Renormalise so a dropped factor redistributes its weight rather than
  // silently deflating the score toward zero.
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  for (const f of factors) f.weight = totalWeight > 0 ? f.weight / totalWeight : 0;

  const blended = factors.reduce((s, f) => s + f.observedPct * f.weight, 0);
  const score = Math.round(Math.max(CONFIDENCE_FLOOR, Math.min(CONFIDENCE_CEILING, blended)));

  return {
    score,
    factors,
    basis: [...factors]
      .sort((a, b) => b.weight - a.weight)
      .map((f) => f.detail),
  };
}
