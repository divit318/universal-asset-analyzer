/**
 * Capital Allocation narration — turns cash.ts's measured output into English.
 *
 * Mirrors decision.ts's relationship to recommend.ts exactly: EVERY SENTENCE HERE
 * IS DERIVED FROM A NUMBER computeCashAllocation() ALREADY MEASURED. This file adds
 * no new heuristics and runs no new simulations — it only narrates. Where cash.ts
 * has no honest basis for a claim (a forward price-return forecast, a valuation
 * judgment), this file says so explicitly rather than inventing one, exactly like
 * decision.ts's returnImpactFor()/taxImpactFor() do for rebalance recommendations.
 */

import { OBJECTIVES, type Objective } from "./optimize";
import type { WhyExplanation } from "./decision";
import type {
  CashAllocationItem,
  CashAllocationPlan,
  RejectedOpportunity,
  RejectionReason,
  HeldCashReason,
} from "./cash";

const money = (n: number) => Math.abs(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * The Step-5-style impact line: "increases diversification by X, improves
 * projected alignment by +Y points and lowers expected volatility by Zpp." Every
 * clause is conditional on the underlying delta actually being measurable and
 * material — an item that only moved alignment, say, gets a shorter sentence rather
 * than padded boilerplate.
 */
export function describeItemImpact(item: CashAllocationItem): string {
  const parts: string[] = [];

  if (Math.abs(item.alignmentDelta) >= 0.1) {
    parts.push(`improves projected alignment by ${item.alignmentDelta > 0 ? "+" : ""}${item.alignmentDelta.toFixed(1)} points`);
  }
  if (item.riskDelta != null && Math.abs(item.riskDelta) >= 0.1) {
    parts.push(`${item.riskDelta < 0 ? "lowers" : "raises"} expected volatility by ${Math.abs(item.riskDelta).toFixed(1)}pp`);
  }
  if (Math.abs(item.diversificationDelta) >= 1) {
    parts.push(`${item.diversificationDelta < 0 ? "increases" : "reduces"} diversification (HHI ${item.diversificationDelta > 0 ? "+" : ""}${item.diversificationDelta})`);
  }
  if (Math.abs(item.incomeDelta) >= 1) {
    parts.push(`adds ${money(item.incomeDelta)}/yr in income`);
  }
  if (Math.abs(item.objectiveAlignmentDelta) >= 0.1) {
    parts.push(`moves ${item.objectiveAlignmentDelta.toFixed(1)}pp closer to the target mix`);
  }

  if (parts.length === 0) return "Measured effect is small on every dimension tracked, but it was still the best-scoring use of this tranche.";

  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This allocation ${joined}.`;
}

const REJECTION_LABEL: Record<RejectionReason, string> = {
  constraint_capped: "rejected by optimizer constraints",
  already_at_target: "already at or above target allocation",
  high_correlation: "correlation too high with an existing holding",
  negligible_improvement: "expected improvement negligible",
  inferior_alternative: "inferior measured score vs. the selected alternative",
};

export function rejectionLabel(reason: RejectionReason): string {
  return REJECTION_LABEL[reason];
}

export function rejectedOpportunitySentence(r: RejectedOpportunity, objective: Objective): string {
  const subject = r.symbol ? `${r.symbol} (${r.subject})` : r.subject;
  switch (r.reason) {
    case "constraint_capped":
      return `${subject} was not selected: adding more would push a holding, asset-class, sector or geography weight past its configured limit.`;
    case "already_at_target":
      return `${subject} was not selected: its asset class is already at or above the ${OBJECTIVES[objective].label} objective's target — buying more would move the portfolio further FROM the target, not closer.`;
    case "high_correlation":
      return `${subject} was not selected: its measured return correlation with an existing large holding is high enough that it would add exposure the portfolio already has, not new diversification.`;
    case "negligible_improvement":
      return `${subject} was not selected: even at its best tranche, the measured improvement rounded to essentially zero on every tracked dimension.`;
    case "inferior_alternative":
      return r.bestScoreSeen != null
        ? `${subject} was considered (best measured score ${r.bestScoreSeen}) but another candidate addressing the same gap scored higher every time they competed.`
        : `${subject} was considered but another candidate addressing the same gap scored higher every time they competed.`;
  }
}

export function heldCashSentence(plan: CashAllocationPlan): string {
  if (plan.heldAsCash <= 0) return "";
  const amount = money(plan.heldAsCash);
  switch (plan.heldAsCashReason) {
    case "cash_optimal":
      return `${amount} is held as cash because, in the tranches where it won, cash itself measurably outscored every real alternative under the ${OBJECTIVES[plan.objective].label} objective — this is not a failure to find something to buy, it is the optimizer's actual answer.`;
    case "below_threshold":
      return `${amount} is held as cash because the next-best alternative's measured improvement was below the threshold worth acting on — real, but not worth the added concentration or complexity.`;
    case "no_opportunity":
      return `${amount} is held as cash because no remaining candidate was eligible to compete for it (every other option had already hit a constraint or exhausted its opportunity).`;
  }
}

/**
 * Plan-level WhyExplanation, in decision.ts's exact shape, so the UI can reuse
 * whatever component already renders a WhyExplanation for rebalance recommendations.
 */
export function buildCashWhyExplanation(plan: CashAllocationPlan): WhyExplanation {
  const objectiveLabel = OBJECTIVES[plan.objective].label;
  const deployed = plan.cashAmount - plan.heldAsCash;

  const top = plan.items[0] ?? null;
  const why = top
    ? `Under the ${objectiveLabel} objective, ${top.symbol ?? top.name} measured the largest combined portfolio-alignment and objective-alignment improvement of every candidate simulated across ${plan.items.length + plan.rejectedOpportunities.length} option${plan.items.length + plan.rejectedOpportunities.length === 1 ? "" : "s"}.`
    : `Under the ${objectiveLabel} objective, no candidate measurably improved the portfolio more than holding the cash.`;

  const whyNow = plan.totalAlignmentDelta > 2
    ? "The measured gap this cash closes is large enough that the portfolio is carrying a real, quantified weakness today, not a marginal one."
    : "The measured effect is real but modest — this is a worthwhile deployment, not an urgent one.";

  const whyThisAmount = plan.marginalBenefit.length > 1
    ? `Simulated in ${plan.marginalBenefit.length - 1} tranches so the plan reflects diminishing returns as it fills: the marginal alignment benefit per dollar shrinks as each tranche is placed, which is exactly why ${deployed > 0 ? "not every dollar went to a single position" : "the optimal answer here is to hold cash"}.`
    : "Sized as a single measured tranche.";

  const whyNotAlternative = plan.rejectedOpportunities.length > 0
    ? `${plan.rejectedOpportunities.length} other candidate${plan.rejectedOpportunities.length === 1 ? "" : "s"} were simulated and not selected — see each item's alternatives and the rejected-opportunities list for the measured reason.`
    : "Every eligible candidate that was simulated is represented in the plan above.";

  const whyNotNothing = plan.heldAsCash >= plan.cashAmount
    ? "Simulating full deployment against every candidate is exactly how the optimizer concluded cash was the better answer — this is not the absence of an answer, it is the answer."
    : `Doing nothing with this cash means forgoing the measured ${plan.totalAlignmentDelta >= 0 ? "+" : ""}${plan.totalAlignmentDelta.toFixed(1)}-point portfolio-alignment improvement above, indefinitely.`;

  return { why, whyNow, whyThisAmount, whyNotAlternative, whyNotNothing };
}

export type { HeldCashReason };
