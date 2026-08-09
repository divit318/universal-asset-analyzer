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
import { RECOMMENDATION_LABEL } from "../../recommendation";
import { LIQUIDITY_LABEL } from "../model/types";
import type { WhyExplanation } from "./decision";
import type { PositionSizingPlan } from "./position-size";

const money = (n: number) => Math.abs(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The card headline tier — how emphatic the recommendation deserves to be presented. */
export type AllocationHeadline =
  | { kind: "strong_buy"; title: string }
  | { kind: "buy"; title: string }
  | { kind: "starter"; title: string }
  | { kind: "wait"; title: string };

/**
 * Headline for the Recommended Allocation card, derived from the plan's own
 * conviction and size — "Strong Buy Allocation" for a full-conviction position,
 * "Starter Position" for a toe-hold, "Wait" for a reasoned HOLD.
 */
export function buildHeadline(plan: PositionSizingPlan): AllocationHeadline {
  if (plan.action !== "BUY" || plan.recommendedAmount <= 0) {
    return { kind: "wait", title: plan.holdKind === "research_negative" ? "Research argues against adding" : "The optimizer recommends waiting" };
  }
  const conviction = plan.conviction?.conviction ?? null;
  // "Strong Buy" is only claimed when the Research page's own badge says so —
  // the two surfaces must never disagree on the verdict's name.
  if (plan.signal?.recommendation === "STRONG_BUY" && conviction != null && conviction >= 0.55 && plan.recommendedAllocationPct >= 2.5) {
    return { kind: "strong_buy", title: "Strong Buy allocation" };
  }
  if (plan.recommendedAllocationPct < 1.5 || (conviction != null && conviction < 0.35)) {
    return { kind: "starter", title: "Starter position" };
  }
  return { kind: "buy", title: "Recommended allocation" };
}

/** Section 7 — the concise, institutional "AI Explanation" paragraph. */
export function buildAiExplanation(plan: PositionSizingPlan): string {
  if (plan.action === "HOLD") return plan.holdReason ?? "No measurable improvement was found at any size tested.";

  const objectiveLabel = OBJECTIVES[plan.objective].label;
  const parts: string[] = [];

  // Lead with the research case when one drove the sizing — the modal sits
  // beside the Research page and must read as the same analysis. Gated on
  // `conviction` (not just the signal): a signal that exists but was not
  // applied (non-equity classes) must not be narrated as if it sized the trade.
  if (plan.conviction != null && plan.signal?.compositeScore != null) {
    const s = plan.signal;
    const label = s.recommendation ? RECOMMENDATION_LABEL[s.recommendation] : null;
    const bits = [`research composite ${Math.round(s.compositeScore!)}/100${label ? ` (${label})` : ""}`];
    if (s.upsidePct != null) bits.push(`${s.upsidePct >= 0 ? "+" : ""}${s.upsidePct.toFixed(0)}% ${s.upsidePct >= 0 ? "upside" : "downside"} vs ${s.upsideBasis === "valuation_case" ? "your valuation case" : "analyst consensus"}`);
    if (plan.correlationWithHoldings != null) bits.push(`${Math.abs(plan.correlationWithHoldings) <= 0.4 ? "low" : Math.abs(plan.correlationWithHoldings) >= 0.8 ? "high" : "moderate"} correlation (r=${plan.correlationWithHoldings.toFixed(2)}) with existing holdings`);
    parts.push(`Sized on ${bits.join(", ")}.`);
  }

  // First reason NOT already narrated by the research lead above — never the
  // same sentence twice in one paragraph.
  const drivers = new Set(plan.conviction?.drivers ?? []);
  const topReason = plan.reasons.find((r) => !drivers.has(r));
  parts.push(
    topReason
      ? `${topReason} The optimizer recommends a ${plan.recommendedAllocationPct.toFixed(1)}% allocation (${money(plan.recommendedAmount)}) under the ${objectiveLabel} objective.`
      : `The optimizer recommends a ${plan.recommendedAllocationPct.toFixed(1)}% allocation (${money(plan.recommendedAmount)}) under the ${objectiveLabel} objective.`,
  );

  if (plan.expectedReturn) {
    parts.push(`Estimated portfolio expected-return impact: ${plan.expectedReturn.portfolioDeltaPct >= 0 ? "+" : ""}${plan.expectedReturn.portfolioDeltaPct.toFixed(2)} pp/yr (${plan.expectedReturn.basis})`);
  }

  const beyond = plan.scenarios.find((s) => s.diminishingReturns);
  if (beyond) {
    parts.push(`Sizing beyond this — e.g. ${money(beyond.amount)} — measurably provides only marginal additional benefit while increasing concentration.`);
  } else if (plan.effectiveTargetWeightPct != null) {
    parts.push(`Sizing stops at ${plan.effectiveTargetWeightPct.toFixed(1)}% of the portfolio — the position weight this research case supports after portfolio-context adjustments.`);
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
    const researchBacked = plan.holdKind === "research_negative" || plan.holdKind === "research_weak";
    return {
      why: reason,
      whyNow: "Not applicable — this is not a recommended buy right now.",
      whyThisAmount: researchBacked
        ? "$0 — the research case itself does not support opening or growing this position."
        : plan.holdKind === "at_conviction_size"
          ? "$0 — the position is already at the size the research case supports."
          : "$0 — no size measurably improved the portfolio more than holding cash.",
      whyNotAlternative: researchBacked
        ? "Sizing was never reached: the research verdict is checked before portfolio simulation, and it failed there."
        : "Every size up to your single-holding limit was simulated; none beat cash under the current objective.",
      whyNotNothing: [reason, ...plan.reasons.slice(0, 2)].join(" "),
    };
  }

  const topReason = plan.reasons[0] ?? `Measured under the ${objectiveLabel} objective.`;

  return {
    why: topReason,
    whyNow: Math.abs(plan.impact.healthDelta) > 2
      ? "The measured improvement is large enough that this is a real, quantified gap in the portfolio today, not a marginal one."
      : "The measured effect is real but modest — this is a worthwhile addition, not an urgent one.",
    whyThisAmount: plan.effectiveTargetWeightPct != null
      ? `Sized at ${plan.recommendedAllocationPct.toFixed(1)}% of the portfolio (${money(plan.recommendedAmount)}) — the research case supports up to ${plan.effectiveTargetWeightPct.toFixed(1)}% after portfolio-context adjustments (class weight, sector pressure, correlation), and every tranche up to that point was simulated and measured better than holding cash.`
      : `Sized at ${plan.recommendedAllocationPct.toFixed(1)}% of the portfolio (${money(plan.recommendedAmount)}) — simulated in tranches up to your single-holding limit, this is the point at which buying more of ${plan.symbol} stops measurably beating the alternative of holding the cash under the ${objectiveLabel} objective.`,
    whyNotAlternative: "The alternative measured at every tested size was holding the money as cash — this amount is the point where that stops being the better answer.",
    whyNotNothing: `Simulating "buy nothing" is the baseline every number above is measured against: 0 health points, 0 allocation change. Leaving this unbought means forgoing the measured ${plan.impact.healthDelta >= 0 ? "+" : ""}${plan.impact.healthDelta.toFixed(1)}-point health improvement above${plan.expectedReturn ? ` and an estimated ${plan.expectedReturn.portfolioDeltaPct >= 0 ? "+" : ""}${plan.expectedReturn.portfolioDeltaPct.toFixed(2)} pp/yr of expected return` : ""}.`,
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
  const extras = [
    `Projected health improvement: ${plan.impact.healthDelta >= 0 ? "+" : ""}${plan.impact.healthDelta.toFixed(1)} points.`,
    plan.expectedReturn ? `Estimated expected return: ${plan.expectedReturn.portfolioDeltaPct >= 0 ? "+" : ""}${plan.expectedReturn.portfolioDeltaPct.toFixed(2)} pp/yr.` : null,
  ].filter(Boolean);
  return `${money(plan.recommendedAmount)} (${plan.recommendedAllocationPct.toFixed(1)}%) into ${plan.symbol}. ${extras.join(" ")}`;
}
