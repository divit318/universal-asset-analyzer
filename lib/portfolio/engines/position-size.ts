/**
 * Position Sizing Engine — the Watchlist "how much should I buy?" answer.
 *
 * This is engines/cash.ts's tranche/water-filling method (see that file's header
 * for the full argument), applied to a single instrument instead of the whole
 * candidate universe: at each small tranche of the search budget, buying more of
 * the target symbol competes against simply holding cash, scored by the exact same
 * `distanceImprovement * 100 + healthDelta` formula cash.ts uses. The moment cash
 * wins a tranche (or a hard cap blocks the next one), sizing stops — which is what
 * makes the stopping point a measured diminishing-returns point rather than an
 * arbitrary round number.
 *
 * Deliberately NOT folded into cash.ts: that engine answers "what should I do with
 * $X of new cash, across everything" (a Portfolio-page question). This answers
 * "should I buy THIS, and how much" for a single symbol a user is looking at on the
 * Watchlist — a different question with a different, much smaller search space,
 * and one that must work even when the amount under consideration exceeds the
 * user's actual cash on hand (funding may come from selling something else; see
 * app/api/portfolio/buy/recommendation/route.ts for the funding-shortfall logic).
 *
 * Every number here is produced by simulating the trade through the real engines
 * (simulate.ts) — never asserted. A symbol whose best tranche never beats cash
 * gets action: "HOLD" and an honest reason, exactly like recommend.ts is allowed to
 * conclude a portfolio needs no changes.
 */

import { simulate, estimateImpact, type PortfolioEvaluation, type ImpactEstimate, type PortfolioChange } from "./simulate";
import { assessConfidence } from "./confidence";
import { normalizeHoldings } from "../model/holding";
import { OBJECTIVES, normalize, DEFAULT_CONSTRAINTS, type Objective, type Constraints } from "./optimize";
import { classDistance, type MarginalBenefitPoint } from "./cash";
import { PORTFOLIO_CLASS_LABEL } from "../model/types";
import type { Holding, MarketContext, PortfolioAssetClass, RawHolding } from "../model/types";

export const DEFAULT_SIZING_TRANCHES = 24;

/**
 * How much better than cash a tranche must score before it is worth buying.
 * A noise floor, not a hurdle rate: both sides of the comparison are the same
 * tranche simulated two ways, so anything above measurement noise is a real
 * preference. Set too high, the engine declines assets it has itself measured
 * as better than holding cash.
 */
const NEGLIGIBLE_ADVANTAGE = 0.01;

/**
 * Weight on strategic asset-class alignment relative to the holistic health
 * delta. Kept above 1 on purpose: filling a genuine class gap (a bond-light
 * book buying duration) is exactly the recommendation a position-sizer should
 * make confidently, and health alone moves too slowly per tranche to express
 * that. Health still decides between candidates whose class alignment is a
 * wash — which, before totalExact existed, it could never do.
 */
const DISTANCE_WEIGHT = 2;

/** Current weight of one asset class, in percent of the whole portfolio. */
function weightOfClass(e: PortfolioEvaluation, cls: PortfolioAssetClass): number {
  return e.allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
}

export type { MarginalBenefitPoint };

export interface SizeScenario {
  amount: number;
  shares: number | null;
  healthDelta: number;
  /** True for the winning, recommended amount. */
  isRecommended: boolean;
  /** True when this scenario's per-dollar marginal benefit has fallen well below the recommended amount's — i.e. it costs more to achieve little extra. */
  diminishingReturns: boolean;
}

export type PositionSizingAction = "BUY" | "HOLD";

export interface PositionSizingPlan {
  symbol: string;
  name: string;
  assetClass: PortfolioAssetClass;
  price: number | null;
  objective: Objective;
  action: PositionSizingAction;
  /** Why action is HOLD rather than BUY — null when action is BUY. */
  holdReason: string | null;

  recommendedAmount: number;
  recommendedShares: number | null;
  /** The resulting weight of this position in the portfolio AFTER the recommended buy. */
  recommendedAllocationPct: number;

  /** 0-100. Blends the asset's own scoring confidence with the measured effect size — never asserted independent of both. */
  confidence: number;

  /** Measured impact of the FULL recommended purchase (before -> after). */
  impact: ImpactEstimate;
  before: PortfolioEvaluation;
  /** The exact state the tranche loop measured at the recommended amount — not reconstructed. */
  after: PortfolioEvaluation;

  /** Cumulative measured health improvement at each tranche boundary, 0 -> recommendedAmount. */
  marginalBenefit: MarginalBenefitPoint[];
  /** A handful of round-number checkpoints either side of the recommendation, each independently simulated. */
  scenarios: SizeScenario[];

  /** Up to 3 grounded reasons the recommended amount is what it is (sector gap filled, concentration reduced, etc). */
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Template holding construction                                              */
/* -------------------------------------------------------------------------- */

/**
 * The holding the tranche loop repeatedly buys more of. If the symbol is already
 * held, this IS that existing holding (simulate.ts's applyChange resizes an
 * existing id in place); otherwise a minimal synthetic RawHolding is normalized
 * through the real class adapter so it is valued and scored exactly like any other
 * holding — never a fabricated number bypassing the adapters.
 */
function templateHoldingFor(
  target: { symbol: string; name: string; assetClass: PortfolioAssetClass },
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
): Holding | null {
  const sym = target.symbol.toUpperCase();
  const existing = evaluation.holdings.find((h) => h.symbol?.toUpperCase() === sym);
  if (existing) return existing;

  const quote = ctx.quotes.get(sym);
  const price = quote?.price ?? null;
  const raw: RawHolding = {
    id: `watchlist:${sym}`,
    assetClass: target.assetClass,
    symbol: sym,
    name: target.name,
    currency: quote?.currency ?? "USD",
    quantity: 1,
    unit: target.assetClass === "commodity" ? "units" : "shares",
    costBasis: price != null && price > 0 ? price : 1,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    meta: { watchlistBuy: true },
  };
  const { holdings } = normalizeHoldings([raw], ctx);
  return holdings[0] ?? null;
}

/** A synthetic base-currency cash holding — the tranche loop's "do nothing" competitor. */
function cashTemplateHolding(ctx: MarketContext): Holding | null {
  const raw: RawHolding = {
    id: `sizing-cash:${ctx.baseCurrency.toUpperCase()}`,
    assetClass: "cash",
    symbol: null,
    name: `${ctx.baseCurrency.toUpperCase()} Cash`,
    currency: ctx.baseCurrency.toUpperCase(),
    quantity: 1,
    unit: "currency",
    costBasis: 1,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    meta: { candidate: true },
  };
  const { holdings } = normalizeHoldings([raw], ctx);
  return holdings[0] ?? null;
}

/**
 * A resulting holding/asset-class/sector/geography weight would cross a hard cap
 * BECAUSE OF THIS TRADE. The holding's own weight (maxHoldingPct) is checked as an
 * absolute cap — it can only grow via this exact trade, so there's no ambiguity.
 * Class/sector/geography are checked as a BEFORE→AFTER transition instead: a
 * portfolio that is already, say, 100% US-domiciled from an unrelated existing
 * holding must not have every subsequent trade blocked forever just for sharing
 * that attribute — only a trade that itself pushes a previously-under-cap group
 * over the line is a real constraint violation.
 */
function violatesConstraints(
  before: PortfolioEvaluation,
  after: PortfolioEvaluation,
  target: { symbol: string; assetClass: PortfolioAssetClass },
  templateId: string,
  constraints: Constraints,
): boolean {
  const weightOf = (e: PortfolioEvaluation, view: "byAssetClass" | "bySector" | "byGeography", key: string) =>
    e.allocation[view].slices.find((s) => s.key === key)?.weight ?? 0;

  const newlyOverCap = (view: "byAssetClass" | "bySector" | "byGeography", key: string, cap: number) => {
    const beforeWeight = weightOf(before, view, key);
    const afterWeight = weightOf(after, view, key);
    return beforeWeight <= cap + 1e-9 && afterWeight > cap + 1e-9;
  };

  if (newlyOverCap("byAssetClass", target.assetClass, constraints.maxAssetClassPct)) return true;

  const holding = after.holdings.find((h) => h.symbol?.toUpperCase() === target.symbol.toUpperCase() || h.id === templateId);
  if (!holding) return false;
  if (holding.weight > constraints.maxHoldingPct + 1e-9) return true;

  const sector = holding.attributes.sector;
  if (sector && newlyOverCap("bySector", sector, constraints.maxSectorPct)) return true;

  const geography = holding.attributes.geography;
  if (geography && newlyOverCap("byGeography", geography, constraints.maxCountryPct)) return true;

  return false;
}

/**
 * The same Confidence every other recommendation in the app reports — see
 * engines/confidence.ts.
 *
 * This used to mirror recommend.ts's old blended formula ("base + effect size +
 * data-quality adjustment"). Both have been replaced by one definition, because a
 * percentage that means "well-evidenced" on the Decisions tab and "well-evidenced
 * AND high-impact" on the buy modal is not a scale a user can carry between the
 * two screens. Effect size is reported separately, as it always was, in `impact`.
 */
function confidenceFor(impact: ImpactEstimate, holding: Holding | null, evaluation: PortfolioEvaluation): number {
  return assessConfidence(evaluation, holding, { riskMeasured: impact.riskDelta != null }).score;
}

function reasonsFor(before: PortfolioEvaluation, after: PortfolioEvaluation, target: { assetClass: PortfolioAssetClass }): string[] {
  const reasons: string[] = [];

  const sectorBefore = before.allocation.bySector.slices;
  const sectorAfter = after.allocation.bySector.slices;
  const sectorKeys = new Set([...sectorBefore.map((s) => s.key), ...sectorAfter.map((s) => s.key)]);
  for (const key of sectorKeys) {
    const b = sectorBefore.find((s) => s.key === key)?.weight ?? 0;
    const a = sectorAfter.find((s) => s.key === key)?.weight ?? 0;
    if (a - b > 1.5) reasons.push(`Adds ${key} exposure (${b.toFixed(1)}% → ${a.toFixed(1)}%).`);
  }

  const hhiDelta = after.allocation.byAssetClass.hhi - before.allocation.byAssetClass.hhi;
  if (hhiDelta < -25) reasons.push("Improves overall diversification (lower asset-class HHI).");

  const classBefore = before.allocation.byAssetClass.slices.find((s) => s.key === target.assetClass)?.weight ?? 0;
  if (classBefore < 5) reasons.push(`Opens or grows a small ${target.assetClass} allocation.`);

  const cashBefore = before.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;
  const cashAfter = after.allocation.byAssetClass.slices.find((s) => s.key === "cash")?.weight ?? 0;
  if (cashBefore - cashAfter > 1) reasons.push(`Puts idle cash to work (${cashBefore.toFixed(1)}% → ${cashAfter.toFixed(1)}%).`);

  if (Math.abs(after.health.total - before.health.total) >= 0.1) {
    reasons.push(`Projected portfolio health ${after.health.total >= before.health.total ? "improves" : "declines"} from ${before.health.total.toFixed(1)} to ${after.health.total.toFixed(1)}.`);
  }

  return reasons.slice(0, 4);
}

/* -------------------------------------------------------------------------- */

/**
 * Size a purchase of `target` against `evaluation`, deterministically. Identical
 * inputs always produce an identical plan, and the search budget (maxHoldingPct
 * minus any existing weight in this symbol) is a portfolio-construction question,
 * independent of how much cash the user currently has on hand — funding is
 * resolved separately by the caller.
 */
export function computePositionSizing(
  evaluation: PortfolioEvaluation,
  target: { symbol: string; name: string; assetClass: PortfolioAssetClass },
  objective: Objective,
  ctx: MarketContext,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  tranches: number = DEFAULT_SIZING_TRANCHES,
): PositionSizingPlan {
  const sym = target.symbol.toUpperCase();
  const price = ctx.quotes.get(sym)?.price ?? null;

  const holdAt = (action: PositionSizingAction, reason: string | null, after: PortfolioEvaluation = evaluation): PositionSizingPlan => ({
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action,
    holdReason: reason,
    recommendedAmount: 0,
    recommendedShares: null,
    recommendedAllocationPct: after.holdings.find((h) => h.symbol?.toUpperCase() === sym)?.weight ?? 0,
    confidence: 30,
    impact: { healthDelta: 0, riskDelta: null, diversificationDelta: 0, incomeDelta: 0, inflationDelta: null, liquidityDelta: 0 },
    before: evaluation,
    after,
    marginalBenefit: [{ cumulativeAmount: 0, healthDelta: 0 }],
    scenarios: [],
    reasons: [],
  });

  if (evaluation.totalValue <= 0 || evaluation.holdings.length === 0) {
    return holdAt("HOLD", "Build your portfolio first — sizing is measured against your actual holdings, cash and objective, and there is nothing to measure against yet.");
  }

  const template = templateHoldingFor(target, evaluation, ctx);
  const cashTemplate = cashTemplateHolding(ctx);
  if (!template || !cashTemplate || price == null || price <= 0) {
    return holdAt("HOLD", "No live price is available for this symbol right now.");
  }

  const existingWeight = evaluation.holdings.find((h) => h.id === template.id)?.weight ?? 0;
  const maxAmount = Math.max(0, ((constraints.maxHoldingPct - existingWeight) / 100) * evaluation.totalValue);
  if (maxAmount <= 0) {
    return holdAt("HOLD", `Already at your ${constraints.maxHoldingPct}% single-holding limit — adding more would breach the concentration cap.`);
  }

  const rawTarget = objective === "target_allocation" && customTarget ? customTarget : OBJECTIVES[objective].target;
  const desired = normalize(rawTarget);

  const trancheSize = maxAmount / tranches;
  let current = evaluation;
  let cumulative = 0;
  let totalHealth = 0;
  const marginalBenefit: MarginalBenefitPoint[] = [{ cumulativeAmount: 0, healthDelta: 0 }];
  // Which brake ended the loop — turned into the user-facing holdReason when it
  // stopped before buying anything at all. "It declined" is not an answer; the
  // binding reason is.
  let stoppedBy: "class_target" | "not_better_than_cash" | "constraint" | null = null;

  for (let t = 0; t < tranches; t++) {
    const buyChange: PortfolioChange = { kind: "buy", holding: template, amount: trancheSize };
    const { after: buyAfter, impact: buyImpact } = simulate(current, [buyChange], ctx);
    const buyBlocked = violatesConstraints(current, buyAfter, target, template.id, constraints);
    const buyDistanceImprovement = classDistance(current, desired) - classDistance(buyAfter, desired);
    // healthDelta aggregates diversification/concentration/duration/income
    // (health.ts's own dimensions); distanceImprovement measures alignment with
    // the objective's strategic asset-class target. Both are real, and both are
    // measured on the SAME tranche on both sides of the comparison below, which
    // is what makes them comparable at all.
    const buyScore = buyImpact.healthDelta + buyDistanceImprovement * DISTANCE_WEIGHT;

    const cashChange: PortfolioChange = { kind: "buy", holding: cashTemplate, amount: trancheSize };
    const { after: cashAfter, impact: cashImpact } = simulate(current, [cashChange], ctx);
    const cashDistanceImprovement = classDistance(current, desired) - classDistance(cashAfter, desired);
    const cashScore = cashImpact.healthDelta + cashDistanceImprovement * DISTANCE_WEIGHT;

    // Brake 1 — the strategic target is a ceiling, not a suggestion.
    //
    // Without this, health alone will size almost anything up to the
    // concentration cap: every health dimension that rewards diversification
    // keeps paying out as you add a new, uncorrelated asset to a concentrated
    // book, tranche after tranche. That logic recommended 13% of the portfolio
    // in bitcoin under Maximize Sharpe — an objective whose target holds no
    // crypto at all — purely because bitcoin decorrelates. An objective that
    // says "no crypto" must not be talked out of it by the diversification
    // dimensions, so a tranche that pushes the asset's class further past its
    // target ends the loop. Classes with no target at all (target 0) are
    // therefore never sized into, which is the correct reading of the
    // objective, and Manual Allocation remains available to overrule it.
    // Keyed on the TEMPLATE's class, not the caller's `target.assetClass`. For a
    // symbol already held, the template IS the existing holding, and its stored
    // class is what simulate() actually moves — which can differ from the class
    // detected from the live quote (Realty Income is `reit` in the book but
    // types as an equity from Yahoo). Reading the caller's class there measured
    // a class the buy does not move, so the brake silently never fired.
    const sizedClass = template.assetClass;
    const classAfter = weightOfClass(buyAfter, sizedClass);
    const classNow = weightOfClass(current, sizedClass);
    const classTarget = desired.get(sizedClass) ?? 0;
    if (classAfter > classTarget && classAfter > classNow) { stoppedBy = "class_target"; break; }

    // Brake 2 — does putting this money into the asset beat leaving it in cash?
    //
    // This deliberately replaces an earlier absolute gate (buyScore < 0.5). That
    // gate compared a per-tranche quantity against a fixed constant, but a
    // tranche is ~1/24th of the room to a concentration cap — on a large book it
    // moves any score by hundredths of a point, so the gate could only ever be
    // cleared by a large asset-class-gap term. The effect was that health was
    // decorative and the engine declined almost everything, including assets it
    // had itself measured as better than cash. The margin below is a noise
    // floor on a difference of two same-scale quantities, so it does not
    // inherit that scale dependence.
    if (buyBlocked || buyScore - cashScore <= NEGLIGIBLE_ADVANTAGE) {
      stoppedBy = buyBlocked ? "constraint" : "not_better_than_cash";
      break;
    }

    current = buyAfter;
    cumulative += trancheSize;
    totalHealth += buyImpact.healthDelta;
    marginalBenefit.push({ cumulativeAmount: Math.round(cumulative), healthDelta: Math.round(totalHealth * 10) / 10 });
  }

  const recommendedAmount = Math.round(cumulative);
  const recommendedHolding = current.holdings.find((h) => h.symbol?.toUpperCase() === sym) ?? null;

  if (recommendedAmount <= 0) {
    // Same class the brake keyed on, so the reason names the class actually measured.
    const sizedClass = template.assetClass;
    const classLabel = PORTFOLIO_CLASS_LABEL[sizedClass] ?? sizedClass;
    const classTarget = desired.get(sizedClass) ?? 0;
    const classNow = weightOfClass(evaluation, sizedClass);
    const objectiveLabel = OBJECTIVES[objective].label;

    const reason =
      stoppedBy === "class_target"
        ? classTarget <= 0
          ? `The ${objectiveLabel} objective allocates nothing to ${classLabel}, so there is no room to size this position against it. Use Manual Allocation to buy anyway, or switch objectives.`
          : `${classLabel} is already at ${classNow.toFixed(1)}% of your portfolio, at or above the ${classTarget.toFixed(1)}% the ${objectiveLabel} objective targets. Adding more would move you further from that target.`
        : stoppedBy === "constraint"
          ? `Buying even a small amount would breach one of your portfolio constraints (concentration, asset-class or liquidity limits).`
          : `At every size up to your single-holding limit, this purchase measured no better for the portfolio than leaving the money in cash under the ${objectiveLabel} objective.`;

    return holdAt("HOLD", reason, evaluation);
  }

  // The tranche loop's per-step healthDelta sum telescopes to exactly this same
  // before/after diff, so this is the single source of truth for the plan's impact
  // — no separate accumulation to keep in sync.
  const impact: ImpactEstimate = estimateImpact(evaluation, current);

  /* ---- Alternative size scenarios (Section 4) — each independently simulated ---- */

  const checkpointMultiples = [0.3, 0.7, 1, 1.5];
  const seen = new Set<number>();
  const scenarios: SizeScenario[] = [];
  const perDollarAtRecommended = recommendedAmount > 0 ? impact.healthDelta / recommendedAmount : 0;

  for (const mult of checkpointMultiples) {
    const amount = Math.round(recommendedAmount * mult);
    if (amount <= 0 || seen.has(amount)) continue;
    seen.add(amount);

    const { impact: scenarioImpact } = simulate(evaluation, [{ kind: "buy", holding: template, amount }], ctx);
    const healthDelta = Math.round(scenarioImpact.healthDelta * 10) / 10;
    const perDollar = amount > 0 ? healthDelta / amount : 0;

    scenarios.push({
      amount,
      shares: price > 0 ? Math.round((amount / price) * 1000) / 1000 : null,
      healthDelta,
      isRecommended: mult === 1,
      diminishingReturns: mult > 1 && perDollarAtRecommended > 0 && perDollar < perDollarAtRecommended * 0.4,
    });
  }
  scenarios.sort((a, b) => a.amount - b.amount);

  return {
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "BUY",
    holdReason: null,
    recommendedAmount,
    recommendedShares: price > 0 ? Math.round((recommendedAmount / price) * 1000) / 1000 : null,
    recommendedAllocationPct: Math.round((recommendedHolding?.weight ?? 0) * 10) / 10,
    confidence: confidenceFor(impact, recommendedHolding, evaluation),
    impact,
    before: evaluation,
    after: current,
    marginalBenefit,
    scenarios,
    reasons: reasonsFor(evaluation, current, target),
  };
}

/**
 * The Add-to-Portfolio modal's "Live Preview" — sizes a purchase at a SPECIFIC
 * user-chosen amount (dollar/shares/%portfolio/%cash all resolve to a dollar
 * amount client-side) instead of searching for the optimal one. Reuses every
 * building block computePositionSizing() uses (template holdings, simulate,
 * estimateImpact, confidenceFor, reasonsFor) so a custom amount is scored on
 * the exact same measured basis as the recommended one — never a separate,
 * lighter-weight estimate. Deliberately does not re-run violatesConstraints as
 * a hard block: the user is knowingly overriding the recommendation, and
 * buildTransactionWarnings() already surfaces the same constraint breach as a
 * non-blocking advisory, matching how every other override in this app works.
 */
export function computePositionSizingAtAmount(
  evaluation: PortfolioEvaluation,
  target: { symbol: string; name: string; assetClass: PortfolioAssetClass },
  amount: number,
  objective: Objective,
  ctx: MarketContext,
): PositionSizingPlan {
  const sym = target.symbol.toUpperCase();
  const price = ctx.quotes.get(sym)?.price ?? null;

  const holdAt = (reason: string): PositionSizingPlan => ({
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "HOLD",
    holdReason: reason,
    recommendedAmount: 0,
    recommendedShares: null,
    recommendedAllocationPct: evaluation.holdings.find((h) => h.symbol?.toUpperCase() === sym)?.weight ?? 0,
    confidence: 30,
    impact: { healthDelta: 0, riskDelta: null, diversificationDelta: 0, incomeDelta: 0, inflationDelta: null, liquidityDelta: 0 },
    before: evaluation,
    after: evaluation,
    marginalBenefit: [{ cumulativeAmount: 0, healthDelta: 0 }],
    scenarios: [],
    reasons: [],
  });

  if (!Number.isFinite(amount) || amount <= 0) return holdAt("Enter an amount greater than zero.");
  if (evaluation.totalValue <= 0 || evaluation.holdings.length === 0) {
    return holdAt("Build your portfolio first — sizing is measured against your actual holdings, cash and objective, and there is nothing to measure against yet.");
  }

  const template = templateHoldingFor(target, evaluation, ctx);
  if (!template || price == null || price <= 0) return holdAt("No live price is available for this symbol right now.");

  const { after, impact } = simulate(evaluation, [{ kind: "buy", holding: template, amount }], ctx);
  const recommendedHolding = after.holdings.find((h) => h.symbol?.toUpperCase() === sym) ?? null;

  return {
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "BUY",
    holdReason: null,
    recommendedAmount: Math.round(amount),
    recommendedShares: price > 0 ? Math.round((amount / price) * 1000) / 1000 : null,
    recommendedAllocationPct: Math.round((recommendedHolding?.weight ?? 0) * 10) / 10,
    confidence: confidenceFor(impact, recommendedHolding, evaluation),
    impact,
    before: evaluation,
    after,
    marginalBenefit: [{ cumulativeAmount: 0, healthDelta: 0 }, { cumulativeAmount: Math.round(amount), healthDelta: Math.round(impact.healthDelta * 10) / 10 }],
    scenarios: [],
    reasons: reasonsFor(evaluation, after, target),
  };
}
