/**
 * Position Sizing narration — turns position-size.ts's measured output into
 * English, exactly the way cash-explain.ts narrates cash.ts and decision.ts
 * narrates recommend.ts. EVERY SENTENCE HERE IS DERIVED FROM A NUMBER
 * computePositionSizing() ALREADY MEASURED — no new heuristics, no new
 * simulations, and no LLM call: this app's institutional-research philosophy is
 * "measured, not asserted", and templated prose over real numbers is what keeps
 * that true for the one piece of copy a user reads before clicking Buy.
 */

import { OBJECTIVES, type Constraints } from "./optimize";
import { LIQUIDITY_LABEL } from "../model/types";
import type { WhyExplanation } from "./decision";
import type { PositionSizingPlan } from "./position-size";

const money = (n: number) => Math.abs(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Section 7 — the concise, institutional "AI Explanation" paragraph. */
export function buildAiExplanation(plan: PositionSizingPlan): string {
  if (plan.action === "HOLD") return plan.holdReason ?? "No measurable improvement was found at any size tested.";

  const objectiveLabel = OBJECTIVES[plan.objective].label;
  const parts: string[] = [];

  const topReason = plan.reasons[0];
  parts.push(
    topReason
      ? `${topReason} The optimizer recommends a ${plan.recommendedAllocationPct.toFixed(1)}% allocation (${money(plan.recommendedAmount)}) under the ${objectiveLabel} objective.`
      : `The optimizer recommends a ${plan.recommendedAllocationPct.toFixed(1)}% allocation (${money(plan.recommendedAmount)}) under the ${objectiveLabel} objective.`,
  );

  const beyond = plan.scenarios.find((s) => s.diminishingReturns);
  if (beyond) {
    parts.push(`Sizing beyond this — e.g. ${money(beyond.amount)} — measurably provides only marginal additional benefit while increasing concentration.`);
  } else {
    parts.push("Larger sizes were tested and did not measure a proportionally larger benefit.");
  }

  return parts.join(" ");
}

/** Section 3 — the structured Why, in decision.ts's exact WhyExplanation shape so the UI can reuse whatever component already renders one. */
export function buildPositionSizingWhy(plan: PositionSizingPlan): WhyExplanation {
  const objectiveLabel = OBJECTIVES[plan.objective].label;

  if (plan.action === "HOLD") {
    const reason = plan.holdReason ?? "No measurable improvement was found.";
    return {
      why: reason,
      whyNow: "Not applicable — this is not a recommended buy right now.",
      whyThisAmount: "$0 — no size measurably improved the portfolio more than holding cash.",
      whyNotAlternative: "Every size up to your single-holding limit was simulated; none beat cash under the current objective.",
      whyNotNothing: reason,
    };
  }

  const topReason = plan.reasons[0] ?? `Measured under the ${objectiveLabel} objective.`;

  return {
    why: topReason,
    whyNow: Math.abs(plan.impact.healthDelta) > 2
      ? "The measured improvement is large enough that this is a real, quantified gap in the portfolio today, not a marginal one."
      : "The measured effect is real but modest — this is a worthwhile addition, not an urgent one.",
    whyThisAmount: `Sized at ${plan.recommendedAllocationPct.toFixed(1)}% of the portfolio (${money(plan.recommendedAmount)}) — simulated in tranches up to your single-holding limit, this is the point at which buying more of ${plan.symbol} stops measurably beating the alternative of holding the cash under the ${objectiveLabel} objective.`,
    whyNotAlternative: "The alternative measured at every tested size was holding the money as cash — this amount is the point where that stops being the better answer.",
    whyNotNothing: `Simulating "buy nothing" is the baseline every number above is measured against: 0 health points, 0 allocation change. Leaving this unbought means forgoing the measured ${plan.impact.healthDelta >= 0 ? "+" : ""}${plan.impact.healthDelta.toFixed(1)}-point health improvement above.`,
  };
}

/**
 * Advisory warnings for the amount actually about to be bought — `amount` and
 * `allocationPct` are the user's final (possibly customized) size, not
 * necessarily `plan.recommendedAmount`. Never blocks submission: every string
 * here is informational, derived from numbers the engines already computed
 * (before/after evaluations, the target's liquidity, the constraint set) —
 * no new heuristics, matching the discipline of the rest of this file.
 */
export function buildTransactionWarnings(
  plan: PositionSizingPlan,
  allocationPct: number,
  constraints: Constraints,
): string[] {
  const warnings: string[] = [];

  if (allocationPct > constraints.maxHoldingPct) {
    warnings.push(
      `This sizes ${plan.symbol} at ${allocationPct.toFixed(1)}% of the portfolio, above the ${constraints.maxHoldingPct}% single-holding guideline — a concentrated bet on one asset.`,
    );
  }

  const targetHolding = plan.after.holdings.find((h) => h.symbol === plan.symbol);
  if (targetHolding && (targetHolding.liquidity === "illiquid" || targetHolding.liquidity === "t2")) {
    warnings.push(
      `${LIQUIDITY_LABEL[targetHolding.liquidity]} liquidity — this position cannot be sold quickly if you need the cash.`,
    );
  }

  const currencyKey = targetHolding?.currency.toUpperCase();
  if (currencyKey) {
    const beforeWeight = plan.before.allocation.byCurrency.slices.find((s) => s.key === currencyKey)?.weight ?? 0;
    const afterWeight = plan.after.allocation.byCurrency.slices.find((s) => s.key === currencyKey)?.weight ?? 0;
    const isBaseCurrency = plan.before.allocation.byCurrency.slices[0]?.key === currencyKey && beforeWeight > 50;
    if (!isBaseCurrency && afterWeight - beforeWeight > 5) {
      warnings.push(
        `Increases ${currencyKey} currency exposure from ${beforeWeight.toFixed(1)}% to ${afterWeight.toFixed(1)}% of the portfolio.`,
      );
    }
  }

  return warnings;
}

/** One-line summary of the recommended scenario, for a compact header. */
export function buildSummary(plan: PositionSizingPlan): string {
  if (plan.action === "HOLD") return plan.holdReason ?? "No recommendation.";
  return `${money(plan.recommendedAmount)} (${plan.recommendedAllocationPct.toFixed(1)}%) into ${plan.symbol}. Projected health improvement: ${plan.impact.healthDelta >= 0 ? "+" : ""}${plan.impact.healthDelta.toFixed(1)} points.`;
}
