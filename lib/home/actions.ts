/**
 * Module 3 — Top Recommended Actions.
 *
 * The brief asks each action to carry a decision score, priority, confidence,
 * expected impact, reason, and expected portfolio improvement. The portfolio
 * engine's `DecisionCard` (lib/portfolio/engines/decision.ts) already carries
 * every one of those, measured by simulating the trade through the real engines
 * rather than estimated. So this module is a *mapping*, not a ranking: it reads
 * `decisionScore` and `decisionPriority` as given and does not re-sort on some
 * homepage-specific notion of importance.
 *
 * When there is no portfolio, there are no decisions to make — but there are
 * still things to act on (a triggered watchlist alert, an unread risk
 * notification). Those come from Mission Control's `ActionQueueItem` shape,
 * which carries severity rather than a score. The two are unified here behind
 * one `RecommendedAction` contract, with `source` telling the UI which kind it
 * is holding, so the card can render a decision score when it has one and
 * honestly omit it when it does not — rather than fabricating a score for an
 * alert that was never scored.
 *
 * Pure — no I/O. Unit-tested in tests/home-actions.test.ts.
 */

import { buildActionQueue } from "../mission-control";
import type { UniversalPortfolioReport } from "../portfolio/report";
import type { Notification, WatchlistAlert } from "../types";
import type { RecommendedAction, RecommendedActions } from "./contracts";

const MAX_ACTIONS = 5;

/** decisionScore → the severity vocabulary the rest of the homepage speaks. */
function severityFromScore(score: number): RecommendedAction["severity"] {
  if (score >= 70) return "high";
  if (score >= 55) return "medium";
  return "low";
}

export function buildRecommendedActions(
  report: UniversalPortfolioReport | null,
  watchlistAlerts: WatchlistAlert[],
  notifications: Notification[],
): RecommendedActions {
  const decisions = report?.decisions ?? [];
  const hasPortfolio = (report?.holdingCount ?? 0) > 0;

  if (decisions.length > 0) {
    // Before → after is stated on the engine's exact (unrounded) health total —
    // differencing the rounded display total quantizes small deltas to zero,
    // the exact bug HealthDimension.scoreExact exists to prevent. Both ends
    // render at the SAME 0.1 precision so before + delta = after on screen
    // (audit NI-09: "68 → 71.1 (+3.3)" was internally off by 0.2).
    const healthExact = report?.health?.totalExact ?? report?.health?.total ?? 0;
    const healthBefore = Math.round(healthExact * 10) / 10;

    const actions: RecommendedAction[] = [...decisions]
      // The engine already assigned decisionPriority (1 = "if you make one
      // change, make this one"). Respect it.
      .sort((a, b) => a.decisionPriority - b.decisionPriority)
      .slice(0, MAX_ACTIONS)
      .map((d) => ({
        id: d.recommendation.id,
        symbol: d.recommendation.symbol,
        action: d.recommendation.action,
        title: d.recommendation.title,
        reason: d.recommendation.rationale,
        decisionScore: d.decisionScore,
        priority: d.decisionPriority,
        // The engine states confidence as 0-100; the contract is 0-1.
        confidence: d.confidence / 100,
        expectedImpact: d.expectedReturnImpact,
        expectedImprovement: d.expectedBenefit,
        severity: severityFromScore(d.decisionScore),
        href: d.recommendation.symbol
          ? `/research?symbol=${encodeURIComponent(d.recommendation.symbol)}`
          : "/portfolio?tab=decisions",
        source: "decision",
        // Carry the engine's full memo through — the dashboard's decision
        // spotlight renders it verbatim; flattening it here is what previously
        // reduced an IC memo to a one-line "reason".
        why: d.why,
        impact: {
          healthBefore,
          // Differenced from the ROUNDED before, so the three displayed
          // numbers are arithmetically consistent at display precision.
          healthAfter: Math.round((healthBefore + d.recommendation.impact.healthDelta) * 10) / 10,
          healthDelta: d.recommendation.impact.healthDelta,
          riskDeltaPp: d.recommendation.impact.riskDelta,
          incomeDeltaAnnual: d.recommendation.impact.incomeDelta,
          diversificationDelta: d.recommendation.impact.diversificationDelta,
        },
        alternativesEvaluated: d.alternativesEvaluated,
      }));

    return { status: "ok", actions, fromDecisionEngine: true, hasPortfolio };
  }

  // Either there is no portfolio, or there is one and the decision engine found
  // no trade worth making. Both land here, and `hasPortfolio` is what lets the
  // UI tell them apart — they are opposite messages to give a user.
  //
  // Fall back to the alert/notification queue. Those are real and actionable;
  // they are simply not *scored*, and we say so by leaving decisionScore null
  // rather than inventing a number for them.
  const queue = buildActionQueue(null, watchlistAlerts, notifications);

  const actions: RecommendedAction[] = queue.items.slice(0, MAX_ACTIONS).map((item, i) => ({
    id: item.id,
    symbol: item.symbol ?? null,
    action: "REVIEW",
    title: item.title,
    reason: item.description,
    decisionScore: null,
    priority: i + 1,
    confidence: null,
    expectedImpact: null,
    expectedImprovement: null,
    severity: item.severity,
    href: item.href,
    source: "queue",
    observedAt: item.observedAt ?? null,
    // Queue items were flagged, never argued for or simulated — saying so
    // honestly (nulls) beats fabricating a memo for them.
    why: null,
    impact: null,
    alternativesEvaluated: null,
  }));

  return {
    status: actions.length > 0 ? "ok" : "empty",
    actions,
    fromDecisionEngine: false,
    hasPortfolio,
  };
}
