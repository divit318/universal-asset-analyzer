/**
 * Decision Intelligence — turns a `Recommendation` into an investment-committee
 * memo: a Decision Score, a WHY (why this / why now / why this amount / why not
 * something else / why not nothing), an Opportunity Cost, and an honest count of
 * alternatives actually simulated.
 *
 * EVERY NUMBER HERE IS DERIVED FROM THE SAME `ImpactEstimate` THE DECISION CENTER
 * ALREADY SHOWS. This file adds no new heuristics and runs no new simulations — it
 * only ranks, normalizes and narrates what `recommend.ts` already measured. Where
 * the underlying engines have no honest basis for a number (a forward price-return
 * forecast, a tax rate), this file says so explicitly rather than inventing one.
 */

import type { Recommendation } from "./recommend";
import type { PortfolioEvaluation } from "./simulate";
import type { Holding } from "../model/types";

export type ImplementationDifficulty = "easy" | "moderate" | "hard";

export interface OpportunityCost {
  /** Alignment points foregone by NOT making this change — the same alignmentDelta, reframed as a cost. */
  alignmentPointsForegone: number;
  incomeForegoneAnnual: number;
  diversificationForegone: number;
  description: string;
}

export interface WhyExplanation {
  why: string;
  whyNow: string;
  whyThisAmount: string;
  whyNotAlternative: string;
  whyNotNothing: string;
}

export interface DecisionCard {
  recommendation: Recommendation;
  /** 0-100. Primary ranking metric. A rescaling of measured impact × confidence — not a new heuristic. */
  decisionScore: number;
  /** 1 = highest-ranked. "If you only make one change, this should be it." */
  decisionPriority: number;
  /**
   * The investor's own rule this decision serves, ready to render ("Driven by
   * your concentration cap — at most 20% in a single position"). Passed
   * through from the recommendation so the card and the Alignment panel quote
   * the same policy in the same words.
   */
  policyNote: string;
  /**
   * The honest tradeoff, when the trade moves themes in OPPOSITE directions:
   * "Improves Downside (+9.1) while giving up Structure (−1.8), on your
   * weights." Null when every material theme movement points the same way —
   * a manufactured tradeoff would be as dishonest as a hidden one.
   */
  themeTradeoff: string | null;
  expectedBenefit: string;
  /** pp change in annualized volatility. Negative = less risky. Null when risk coverage is insufficient to measure it. */
  expectedRiskReduction: number | null;
  expectedReturnImpact: string;
  implementationDifficulty: ImplementationDifficulty;
  executionTime: string;
  liquidityImpact: string;
  taxImpact: string;
  /**
   * 0-100, one meaning across every action type — see engines/confidence.ts.
   * Passed straight through from the recommendation; this file adds nothing to it.
   */
  confidence: number;
  /** Why the confidence is what it is, one deterministic sentence per factor. */
  confidenceBasis: string[];
  opportunityCost: OpportunityCost;
  why: WhyExplanation;
  /** alternatives.length + 1 (the implicit "do nothing" baseline every decision is measured against). */
  alternativesConsidered: number;
  alternativesEvaluated: number;
}

/**
 * Rescale the engine's existing priority signal (alignmentDelta × confidence) onto a
 * 0-100 scale, centered on 50 = "doing nothing" (alignmentDelta 0). The scale factor
 * is chosen so that a strong, confident recommendation (≈10 alignment points at ≈90%
 * confidence) lands in the high 70s/80s rather than pinning at 100 for every
 * real-world case — leaving room for genuinely exceptional ones to stand out.
 *
 * This composition only became honest once confidence stopped containing effect
 * size. While ADD's confidence included `|healthDelta| × 4`, this multiplication
 * squared the effect for buys and left it linear for trims and exits, so two cards
 * with identical measured impact could not be compared. Now it reads exactly as it
 * looks: expected impact, discounted by how well-evidenced that impact is. Monotone
 * in both terms, so for equal impact the better-evidenced card always ranks higher.
 */
function scoreOf(rec: Recommendation): number {
  const raw = (rec.impact.alignmentDelta ?? 0) * (rec.confidence / 100);
  return Math.round(Math.max(0, Math.min(100, 50 + raw * 3)));
}

function executionTimeFor(rec: Recommendation, holding: Holding | null): string {
  if (rec.action === "SELL" || rec.action === "REDUCE") {
    if (holding?.liquidity === "illiquid") return "Weeks to months — this is an illiquid holding.";
    if (holding?.liquidity === "t2") return "A few days to settle.";
    return "A single trade, minutes to execute.";
  }
  return "A single trade, minutes to execute.";
}

function liquidityImpactFor(rec: Recommendation): string {
  const d = rec.impact.liquidityDelta;
  if (Math.abs(d) < 0.1) return "No material change to portfolio liquidity.";
  return d > 0
    ? `Increases the illiquid share of the portfolio by ${d.toFixed(1)}pp.`
    : `Reduces the illiquid share of the portfolio by ${Math.abs(d).toFixed(1)}pp.`;
}

/**
 * Tax impact is stated as the taxable gain/loss the trade would realize — a fact
 * derivable from costBasis — never as a dollar tax owed, since no tax rate or
 * jurisdiction is modeled anywhere in this app. Inventing one would be exactly the
 * kind of fabricated precision this engine exists to avoid.
 */
function taxImpactFor(rec: Recommendation, holding: Holding | null): string {
  if (rec.action !== "SELL" && rec.action !== "REDUCE") {
    return "N/A — this trade opens or adds to a position; nothing is realized.";
  }
  if (!holding || holding.unrealizedPL == null || holding.valuation.valueBase <= 0) {
    return "Realized gain/loss cannot be computed — cost basis is unavailable for this holding.";
  }
  const soldFraction = Math.min(1, rec.amount / holding.valuation.valueBase);
  const realizedPL = holding.unrealizedPL * soldFraction;
  const verb = realizedPL >= 0 ? "gain" : "loss";
  return `Realizes roughly ${Math.abs(realizedPL).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })} of unrealized ${verb} on the portion sold. No tax rate is modeled — this is the taxable amount, not the tax owed.`;
}

/**
 * "Expected Return Impact" is deliberately scoped to what the engines actually
 * measure: the change in annual income (coupons, dividends, rent). This app has no
 * forward price-return forecast for any asset class, and inventing one here would
 * contradict the confidence-weighted-scoring discipline used everywhere else
 * (alignment, holding scores, risk). Where the trade's real effect is on
 * diversification or risk rather than income, this says so instead of forcing a
 * number that doesn't exist.
 */
function returnImpactFor(rec: Recommendation): string {
  const income = rec.impact.incomeDelta;
  if (Math.abs(income) >= 1) {
    return `${income > 0 ? "+" : "−"}$${Math.abs(income).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr in measured income. This app does not forecast price returns for any asset class, so no forward total-return number is stated — only what is actually measured.`;
  }
  return "No material income effect. This app does not forecast price returns, so the case for this change rests on risk, diversification or liquidity — not an expected-return number.";
}

/**
 * Name the conflict when one exists. Reads the per-theme deltas simulate.ts
 * already measured — no re-simulation, no heuristics. Materiality floor of
 * 0.75 theme-points keeps quote jitter from manufacturing "tradeoffs".
 */
const TRADEOFF_MATERIAL_PTS = 0.75;

function themeTradeoffFor(rec: Recommendation): string | null {
  const material = rec.impact.themeDeltas.filter((t) => Math.abs(t.delta) >= TRADEOFF_MATERIAL_PTS);
  const gains = material.filter((t) => t.delta > 0);
  const losses = material.filter((t) => t.delta < 0);
  if (gains.length === 0 || losses.length === 0) return null;

  const fmt = (list: typeof material) =>
    list
      .slice(0, 2)
      .map((t) => `${t.label} (${t.delta > 0 ? "+" : ""}${t.delta.toFixed(1)})`)
      .join(" and ");
  return `Improves ${fmt(gains)} while giving up ${fmt(losses)} — netted on your own priority weights, but the tension is real.`;
}

function benefitFor(rec: Recommendation): string {
  const parts: string[] = [];
  if (Math.abs(rec.impact.alignmentDelta ?? 0) >= 0.1) {
    parts.push(`${(rec.impact.alignmentDelta ?? 0) > 0 ? "+" : ""}${(rec.impact.alignmentDelta ?? 0).toFixed(1)} alignment points`);
  }
  if (rec.impact.riskDelta != null && Math.abs(rec.impact.riskDelta) >= 0.1) {
    parts.push(`${rec.impact.riskDelta < 0 ? "−" : "+"}${Math.abs(rec.impact.riskDelta).toFixed(1)}pp volatility`);
  }
  if (Math.abs(rec.impact.diversificationDelta) >= 1) {
    parts.push(`${rec.impact.diversificationDelta < 0 ? "better" : "worse"} diversified`);
  }
  return parts.length > 0 ? parts.join(", ") : "Measured effect is small on every dimension tracked.";
}

function opportunityCostFor(rec: Recommendation): OpportunityCost {
  return {
    alignmentPointsForegone: rec.impact.alignmentDelta ?? 0,
    incomeForegoneAnnual: rec.impact.incomeDelta,
    diversificationForegone: -rec.impact.diversificationDelta,
    description:
      `Leaving this as-is means the portfolio keeps forgoing ${benefitFor(rec)}. ` +
      `That gap doesn't close on its own — it persists until this change (or an equivalent one) is made.`,
  };
}

function whyFor(rec: Recommendation, holding: Holding | null): WhyExplanation {
  const bestAlt = rec.alternatives[0] ?? null;

  const whyNotAlternative = bestAlt
    ? `${rec.alternatives.length} other candidate${rec.alternatives.length === 1 ? "" : "s"} ` +
      `addressing the same gap ${rec.alternatives.length === 1 ? "was" : "were"} simulated — ` +
      `${rec.alternatives.map((a) => `${a.symbol} (${a.alignmentDelta >= 0 ? "+" : ""}${a.alignmentDelta.toFixed(1)})`).join(", ")}. ` +
      `${rec.symbol ?? rec.subject} measured the largest alignment-score improvement of the group.`
    : rec.action === "ADD"
      ? "This was the only real candidate simulated for this specific gap."
      : "This decision concerns one specific holding — the alternative is leaving it unchanged, not swapping in a different asset.";

  return {
    why: rec.rationale,
    whyNow: (rec.impact.alignmentDelta ?? 0) > 2
      ? "The measured gap between the book and your stated policy is large enough to be a real, quantified mismatch today, not a marginal one."
      : "The measured effect is real but modest — this is a worthwhile improvement against your stated policy, not an urgent one.",
    whyThisAmount: `Sized at $${rec.amount.toLocaleString()} (${holding ? `${((rec.amount / Math.max(holding.valuation.valueBase, 1)) * 100).toFixed(0)}% of this holding's value` : "a deliberately conservative slice of the portfolio, not a full restructuring"}) — large enough to move the measured numbers above, small enough to act on without restructuring the rest of the portfolio.`,
    whyNotAlternative,
    // Deliberately does NOT restate opportunityCost.description. The two answer
    // different questions — "was the alternative of inaction actually tested?"
    // versus "what does inaction cost?" — and this field used to end by
    // interpolating that description verbatim, so the Decision Center printed the
    // identical sentence in its Cost-of-waiting block and again three lines later
    // under Why not do nothing. A memo that repeats itself reads as padding and
    // makes the reader stop looking for new information in later sections.
    whyNotNothing:
      `"Do nothing" is not an omission here — it is the baseline every number above is measured against: 0 alignment points, $0 income change, no diversification change. ` +
      `A candidate whose simulated difference from that baseline is negligible or negative is discarded rather than shown, so this one appears at all only because its measured difference cleared that bar.`,
  };
}

/**
 * Build the full Decision Center from a recommendation set. One DecisionCard per
 * Recommendation, ranked by decisionScore (ties broken by the existing priority).
 */
export function buildDecisionCards(
  recommendations: Recommendation[],
  evaluation: PortfolioEvaluation,
): DecisionCard[] {
  const holdingsById = new Map(evaluation.holdings.map((h) => [h.id, h]));

  const scored = recommendations.map((rec) => {
    // Only sell/target actions reference an EXISTING holding by id. A "buy" change
    // carries a brand-new candidate holding that was never in this evaluation, so
    // there is no pre-trade position to look up "% of this holding" against — the
    // WHY narrative below treats that case as opening a new position, not sizing
    // against an existing one.
    const holding = rec.change.kind === "sell" || rec.change.kind === "target"
      ? holdingsById.get(rec.change.holdingId) ?? null
      : null;

    return { rec, holding, decisionScore: scoreOf(rec) };
  });

  return scored
    .sort((a, b) => b.decisionScore - a.decisionScore || b.rec.priority - a.rec.priority)
    .map(({ rec, holding }, i) => ({
      recommendation: rec,
      decisionScore: scoreOf(rec),
      decisionPriority: i + 1,
      policyNote: rec.policyBasis,
      themeTradeoff: themeTradeoffFor(rec),
      expectedBenefit: benefitFor(rec),
      expectedRiskReduction: rec.impact.riskDelta,
      expectedReturnImpact: returnImpactFor(rec),
      implementationDifficulty: difficultyFor(rec, holding),
      executionTime: executionTimeFor(rec, holding),
      liquidityImpact: liquidityImpactFor(rec),
      taxImpact: taxImpactFor(rec, holding),
      confidence: rec.confidence,
      confidenceBasis: rec.confidenceBasis,
      opportunityCost: opportunityCostFor(rec),
      why: whyFor(rec, holding),
      alternativesConsidered: rec.alternatives.length + 1,
      alternativesEvaluated: rec.alternativesEvaluated,
    }));
}

function difficultyFor(rec: Recommendation, holding: Holding | null): ImplementationDifficulty {
  if (rec.action === "SELL" || rec.action === "REDUCE") {
    if (holding?.liquidity === "illiquid") return "hard";
    if (holding?.liquidity === "t2") return "moderate";
    return "easy";
  }
  return rec.amount > 0.08 * (holding?.valuation.valueBase ?? Infinity) ? "moderate" : "easy";
}
