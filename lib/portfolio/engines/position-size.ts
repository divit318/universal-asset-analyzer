/**
 * Position Sizing Engine — the Watchlist "how much should I buy?" answer.
 *
 * This is engines/cash.ts's tranche/water-filling method (see that file's header
 * for the full argument), applied to a single instrument instead of the whole
 * candidate universe: at each small tranche of the search budget, buying more of
 * the target symbol competes against simply holding cash, scored by the exact same
 * `distanceImprovement * 100 + alignmentDelta` formula cash.ts uses. The moment cash
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
 * WITH a research signal (asset-signal.ts — the Research page's own composite
 * score, valuation upside, risk flags and confidence), the engine sizes on
 * CONVICTION, the way a portfolio manager actually does: the signal supports a
 * target position weight, portfolio context (class overweight, sector pressure,
 * correlation with existing holdings) scales it, and the tranche loop then
 * MEASURES its way toward that target through the real engines, with an alpha
 * term proportional to conviction competing against cash. Without a signal
 * (bond funds, gold, or a failed research fetch) the engine falls back to pure
 * portfolio geometry, where the strategic class target is a hard ceiling —
 * geometry alone has no basis to buy into an overweight class.
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
import { classDistance, highestCorrelationAgainstTopHoldings, type MarginalBenefitPoint } from "./cash";
import { assessConviction, type AssetSignal, type ConvictionAssessment } from "./asset-signal";
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
 * Weight on strategic asset-class alignment relative to the holistic
 * portfolio-alignment delta. Kept above 1 on purpose: filling a genuine class
 * gap (a bond-light book buying duration) is exactly the recommendation a
 * position-sizer should make confidently, and the alignment score alone moves
 * too slowly per tranche to express that. Alignment still decides between
 * candidates whose class alignment is a wash — which, before scoreExact
 * existed, it could never do.
 */
const DISTANCE_WEIGHT = 2;

/**
 * Weight on the research-conviction alpha term, per percentage point bought —
 * the same pp units classDistance moves in, so the three terms of a tranche's
 * score (portfolio alignment, class alignment, alpha) are commensurable. Calibrated so full
 * conviction (1.0) can outbid a moderately class-overweight book's distance
 * penalty, while a HOLD-band score (conviction ≲ 0.3) cannot — geometry still
 * wins when the research case is weak.
 */
const ALPHA_WEIGHT = 6;

/** Sizing to conviction stops this close (pp) to an existing position — closer is churn, not a trade. */
const MIN_WEIGHT_ROOM_PP = 0.25;

/**
 * Per-trade ceiling for the signal-free geometric path, in % of the portfolio.
 * Without it, a starved asset class (bonds at 7% against a 25% target) had the
 * ENTIRE gap recommended as one trade — 16%+ of the book into a single ticket,
 * which no PM would place at once. The class gap is real; closing it in one
 * order is not the recommendation to make. Conviction-sized buys have their
 * own, tighter ceiling (asset-signal.ts's MAX_CONVICTION_WEIGHT_PCT).
 */
const GEOMETRIC_MAX_SINGLE_BUY_PCT = 7.5;

/**
 * The research scoring engine (lib/scoring.ts) is a single-name fundamental
 * framework — P/E, ROE, revenue growth, analyst coverage. Applying its verdict
 * to a bond fund or a gold trust is a category error (they score as eternal
 * mediocre HOLDs and would veto legitimate class-gap buys), so conviction
 * sizing only engages for the classes the framework actually understands.
 */
const SIGNAL_CLASSES: ReadonlySet<PortfolioAssetClass> = new Set(["equity", "reit"]);

/** Assumed years for valuation upside to be realized when estimating an annual expected return. Conservative on purpose. */
const UPSIDE_REALIZATION_YEARS = 3;
/** Cash benchmark for the expected-return delta — what the money earns if NOT invested. */
const RISK_FREE_ANNUAL_PCT = 4;

/** Current weight of one asset class, in percent of the whole portfolio. */
function weightOfClass(e: PortfolioEvaluation, cls: PortfolioAssetClass): number {
  return e.allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
}

export type { MarginalBenefitPoint };

export interface SizeScenario {
  amount: number;
  shares: number | null;
  alignmentDelta: number;
  /** True for the winning, recommended amount. */
  isRecommended: boolean;
  /** True when this scenario's per-dollar marginal benefit has fallen well below the recommended amount's — i.e. it costs more to achieve little extra. */
  diminishingReturns: boolean;
}

export type PositionSizingAction = "BUY" | "HOLD";

/** Which specific situation produced a HOLD — lets the UI and tests distinguish "research says no" from "constraint says no". */
export type HoldKind =
  | "no_portfolio"
  | "no_price"
  | "at_cap"
  | "research_negative"
  | "research_weak"
  | "at_conviction_size"
  | "class_target"
  | "constraint"
  | "no_edge";

export type ConfidenceTier = "high" | "medium" | "low";

export function confidenceTierOf(score: number): ConfidenceTier {
  return score >= 70 ? "high" : score >= 45 ? "medium" : "low";
}

/** Estimated portfolio-level expected-return impact of the trade. An ESTIMATE (labeled by `basis`), never presented as measured. */
export interface ExpectedReturnEstimate {
  /** The asset's estimated annual return, % — valuation upside amortized over UPSIDE_REALIZATION_YEARS plus dividend yield. */
  assetAnnualPct: number;
  /** Change to the whole portfolio's expected annual return, in pp, vs leaving the money in cash. */
  portfolioDeltaPct: number;
  basis: string;
}

export interface PositionSizingPlan {
  symbol: string;
  name: string;
  assetClass: PortfolioAssetClass;
  price: number | null;
  objective: Objective;
  action: PositionSizingAction;
  /** Why action is HOLD rather than BUY — null when action is BUY. */
  holdReason: string | null;
  /** Machine-readable classification of holdReason — null when action is BUY. */
  holdKind: HoldKind | null;

  /** The research-report signal this plan was sized against — null when none was available (signal-free geometric path). */
  signal: AssetSignal | null;
  /** The conviction assessment derived from `signal` — how large a position the research case supports on its own. */
  conviction: ConvictionAssessment | null;
  /** Conviction target after portfolio-context damping (class overweight, sector pressure, correlation) — the weight actually sized toward. */
  effectiveTargetWeightPct: number | null;
  /** Highest |r| return correlation vs existing large holdings — null when history is insufficient (never assumed 0). */
  correlationWithHoldings: number | null;
  /** Estimated expected-return impact — null when no valuation upside exists to estimate from. */
  expectedReturn: ExpectedReturnEstimate | null;
  confidenceTier: ConfidenceTier;

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

  /** Cumulative measured alignment improvement at each tranche boundary, 0 -> recommendedAmount. */
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

  const beforeScore = before.alignment.scoreExact;
  const afterScore = after.alignment.scoreExact;
  if (beforeScore != null && afterScore != null && Math.abs(afterScore - beforeScore) >= 0.1) {
    reasons.push(`Projected portfolio alignment ${afterScore >= beforeScore ? "improves" : "declines"} from ${beforeScore.toFixed(1)} to ${afterScore.toFixed(1)}.`);
  }

  return reasons.slice(0, 4);
}

/**
 * Portfolio expected-return impact, estimated from the research signal's
 * valuation upside (amortized over UPSIDE_REALIZATION_YEARS) plus dividend
 * yield, versus leaving the same dollars in cash. Explicitly an estimate — the
 * `basis` string names its assumptions so the UI can never present it as a
 * measured quantity.
 */
function expectedReturnFor(
  signal: AssetSignal | null,
  before: PortfolioEvaluation,
  after: PortfolioEvaluation,
  sym: string,
): ExpectedReturnEstimate | null {
  if (signal?.upsidePct == null) return null;
  const weightOf = (e: PortfolioEvaluation) => e.holdings.find((h) => h.symbol?.toUpperCase() === sym)?.weight ?? 0;
  const weightDelta = weightOf(after) - weightOf(before);
  if (weightDelta <= 0) return null;

  const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const assetAnnualPct = clampNum(signal.upsidePct / UPSIDE_REALIZATION_YEARS, -15, 25) + Math.max(signal.dividendYieldPct ?? 0, 0);
  const portfolioDeltaPct = (weightDelta / 100) * (assetAnnualPct - RISK_FREE_ANNUAL_PCT);
  const basisSource = signal.upsideBasis === "valuation_case" ? "your valuation case" : "analyst consensus";
  return {
    assetAnnualPct: Math.round(assetAnnualPct * 10) / 10,
    portfolioDeltaPct: Math.round(portfolioDeltaPct * 100) / 100,
    basis: `${signal.upsidePct >= 0 ? "+" : ""}${signal.upsidePct.toFixed(0)}% upside vs ${basisSource}, assumed realized over ~${UPSIDE_REALIZATION_YEARS} years, vs ${RISK_FREE_ANNUAL_PCT}% on cash.`,
  };
}

/* -------------------------------------------------------------------------- */

/**
 * Size a purchase of `target` against `evaluation`, deterministically. Identical
 * inputs always produce an identical plan, and the search budget (maxHoldingPct
 * minus any existing weight in this symbol) is a portfolio-construction question,
 * independent of how much cash the user currently has on hand — funding is
 * resolved separately by the caller.
 *
 * `signal` is the Research page's own verdict for this symbol (asset-signal.ts).
 * When present, conviction sets the position-weight target the loop sizes
 * toward; when absent, the engine falls back to pure portfolio geometry.
 */
export function computePositionSizing(
  evaluation: PortfolioEvaluation,
  target: { symbol: string; name: string; assetClass: PortfolioAssetClass },
  objective: Objective,
  ctx: MarketContext,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  signal: AssetSignal | null = null,
  tranches: number = DEFAULT_SIZING_TRANCHES,
): PositionSizingPlan {
  const sym = target.symbol.toUpperCase();
  const price = ctx.quotes.get(sym)?.price ?? null;

  // Resolved AFTER the template exists — the adapter's asset class (not the
  // quote's) decides whether single-name research conviction applies at all.
  let conviction: ConvictionAssessment | null = null;
  const correlation = highestCorrelationAgainstTopHoldings(sym, evaluation, ctx);
  const signalConfidence = signal?.scoreConfidence ?? null;
  const blendConfidence = (base: number) =>
    signalConfidence != null ? Math.round(0.6 * base + 0.4 * signalConfidence) : base;

  const holdAt = (
    reason: string | null,
    holdKind: HoldKind,
    opts: { after?: PortfolioEvaluation; confidence?: number; reasons?: string[]; effectiveTargetWeightPct?: number | null } = {},
  ): PositionSizingPlan => {
    const after = opts.after ?? evaluation;
    const confidence = opts.confidence ?? 30;
    return {
      symbol: sym,
      name: target.name,
      assetClass: target.assetClass,
      price,
      objective,
      action: "HOLD",
      holdReason: reason,
      holdKind,
      signal,
      conviction,
      effectiveTargetWeightPct: opts.effectiveTargetWeightPct ?? null,
      correlationWithHoldings: correlation != null ? Math.round(correlation * 100) / 100 : null,
      expectedReturn: null,
      confidenceTier: confidenceTierOf(confidence),
      recommendedAmount: 0,
      recommendedShares: null,
      recommendedAllocationPct: Math.round((after.holdings.find((h) => h.symbol?.toUpperCase() === sym)?.weight ?? 0) * 100) / 100,
      confidence,
      impact: { alignmentDelta: 0, themeDeltas: [], riskDelta: null, diversificationDelta: 0, incomeDelta: 0, inflationDelta: null, liquidityDelta: 0 },
      before: evaluation,
      after,
      marginalBenefit: [{ cumulativeAmount: 0, alignmentDelta: 0 }],
      scenarios: [],
      reasons: opts.reasons ?? [],
    };
  };

  if (evaluation.totalValue <= 0 || evaluation.holdings.length === 0) {
    return holdAt("Build your portfolio first — sizing is measured against your actual holdings, cash and objective, and there is nothing to measure against yet.", "no_portfolio");
  }

  const template = templateHoldingFor(target, evaluation, ctx);
  const cashTemplate = cashTemplateHolding(ctx);
  if (!template || !cashTemplate || price == null || price <= 0) {
    return holdAt("No live price is available for this symbol right now.", "no_price");
  }

  if (signal && SIGNAL_CLASSES.has(template.assetClass)) {
    conviction = assessConviction(signal);
  }

  // The research verdict itself argues against adding — this outranks any
  // portfolio-geometry argument, so it is checked first. A SELL on the
  // Research page and a BUY in the modal must be impossible.
  if (conviction?.vetoed) {
    return holdAt(conviction.vetoReason, "research_negative", {
      confidence: blendConfidence(60),
      reasons: conviction.drivers,
    });
  }

  const existingWeight = evaluation.holdings.find((h) => h.id === template.id)?.weight ?? 0;
  let maxAmount = Math.max(0, ((constraints.maxHoldingPct - existingWeight) / 100) * evaluation.totalValue);
  if (maxAmount <= 0) {
    return holdAt(`Already at your ${constraints.maxHoldingPct}% single-holding limit — adding more would breach the concentration cap.`, "at_cap", { confidence: blendConfidence(70) });
  }

  const rawTarget = objective === "target_allocation" && customTarget ? customTarget : OBJECTIVES[objective].target;
  const desired = normalize(rawTarget);
  const objectiveLabel = OBJECTIVES[objective].label;

  /* ---- Conviction → the weight actually sized toward, damped by portfolio context ---- */

  // The class the buy actually moves (see the brake comment below for why this
  // is the template's class, not the caller's).
  const sizedClassPre = template.assetClass;
  const classLabelPre = PORTFOLIO_CLASS_LABEL[sizedClassPre] ?? sizedClassPre;
  const classTargetPre = desired.get(sizedClassPre) ?? 0;
  const classNowPre = weightOfClass(evaluation, sizedClassPre);

  let effectiveTargetWeightPct: number | null = null;
  const contextNotes: string[] = [];
  if (conviction) {
    if (conviction.targetWeightPct <= 0) {
      return holdAt(
        `The research case is too weak to size a position: composite ${signal?.compositeScore != null ? Math.round(signal.compositeScore) : "—"}/100${signal?.upsidePct != null ? ` with ${signal.upsidePct >= 0 ? "+" : ""}${signal.upsidePct.toFixed(0)}% modeled upside` : ""}. A stronger score, better valuation or fewer red flags would change this.`,
        "research_weak",
        { confidence: blendConfidence(55), reasons: conviction.drivers },
      );
    }

    let t = conviction.targetWeightPct;

    // Overweight asset class: shrink, don't forbid. A PM still buys a great
    // idea in an above-target class — just smaller. The scale runs from 1×
    // (class at target) down to 0.35× (class at its hard cap; beyond that
    // violatesConstraints blocks outright).
    if (classTargetPre > 0 && classNowPre > classTargetPre) {
      const capPct = Math.max(constraints.maxAssetClassPct, classTargetPre + 1);
      const room = Math.max(0, Math.min(1, (capPct - classNowPre) / (capPct - classTargetPre)));
      const factor = 0.35 + 0.65 * room;
      t *= factor;
      contextNotes.push(
        `${classLabelPre} is ${classNowPre.toFixed(1)}% of the portfolio vs the ${classTargetPre.toFixed(1)}% ${objectiveLabel} target — conviction size scaled to ${Math.round(factor * 100)}%.`,
      );
    }

    // Sector pressure: approaching the sector cap dampens before the hard cap blocks.
    const sector = template.attributes.sector;
    if (sector) {
      const sectorNow = evaluation.allocation.bySector.slices.find((s) => s.key === sector)?.weight ?? 0;
      if (sectorNow >= constraints.maxSectorPct * 0.75) {
        t *= 0.65;
        contextNotes.push(`${sector} is already ${sectorNow.toFixed(1)}% of the portfolio (cap ${constraints.maxSectorPct}%) — sized down.`);
      }
    }

    // Correlation with what is already held: a diversifier earns a bigger slot,
    // a duplicate earns a smaller one. Null (insufficient history) changes nothing.
    if (correlation != null) {
      if (Math.abs(correlation) >= 0.8) {
        t *= 0.6;
        contextNotes.push(`Returns are highly correlated (r=${correlation.toFixed(2)}) with an existing large holding — adds concentration, not diversification.`);
      } else if (Math.abs(correlation) <= 0.35) {
        t = Math.min(t * 1.15, constraints.maxHoldingPct);
        contextNotes.push(`Low correlation (r=${correlation.toFixed(2)}) with your current holdings — a genuine diversifier.`);
      }
    }

    effectiveTargetWeightPct = Math.round(Math.min(t, constraints.maxHoldingPct) * 10) / 10;

    const roomPP = effectiveTargetWeightPct - existingWeight;
    if (roomPP <= MIN_WEIGHT_ROOM_PP) {
      return holdAt(
        `You already hold ${existingWeight.toFixed(1)}% of the portfolio in ${sym} — at or above the ${effectiveTargetWeightPct.toFixed(1)}% this research case supports${contextNotes.length > 0 ? " after portfolio-context adjustments" : ""}. Adding more would be sizing past your own conviction.`,
        "at_conviction_size",
        { confidence: blendConfidence(65), reasons: [...conviction.drivers, ...contextNotes], effectiveTargetWeightPct },
      );
    }

    // Solve (existingValue + a) / (totalValue + a) = target for the buy amount
    // `a` — the dollars that land the position exactly at the effective target.
    const tFrac = effectiveTargetWeightPct / 100;
    const existingValue = (existingWeight / 100) * evaluation.totalValue;
    const amountToTarget = Math.max(0, (tFrac * evaluation.totalValue - existingValue) / (1 - tFrac));
    maxAmount = Math.min(maxAmount, amountToTarget);
  } else {
    // Signal-free path: cap the single trade — a class gap is filled in steps,
    // not one ticket (see GEOMETRIC_MAX_SINGLE_BUY_PCT).
    maxAmount = Math.min(maxAmount, (GEOMETRIC_MAX_SINGLE_BUY_PCT / 100) * evaluation.totalValue);
  }

  const trancheSize = maxAmount / tranches;
  let current = evaluation;
  let cumulative = 0;
  let totalAlignment = 0;
  const marginalBenefit: MarginalBenefitPoint[] = [{ cumulativeAmount: 0, alignmentDelta: 0 }];
  // Which brake ended the loop — turned into the user-facing holdReason when it
  // stopped before buying anything at all. "It declined" is not an answer; the
  // binding reason is.
  let stoppedBy: "class_target" | "not_better_than_cash" | "constraint" | null = null;

  for (let t = 0; t < tranches; t++) {
    const buyChange: PortfolioChange = { kind: "buy", holding: template, amount: trancheSize };
    const { after: buyAfter, impact: buyImpact } = simulate(current, [buyChange], ctx);
    const buyBlocked = violatesConstraints(current, buyAfter, target, template.id, constraints);
    const buyDistanceImprovement = classDistance(current, desired) - classDistance(buyAfter, desired);
    // alignmentDelta aggregates the alignment engine's themes (vs the
    // investor's own policy); distanceImprovement measures alignment with
    // the objective's strategic asset-class target. Both are real, and both are
    // measured on the SAME tranche on both sides of the comparison below, which
    // is what makes them comparable at all.
    const buyScore = (buyImpact.alignmentDelta ?? 0) + buyDistanceImprovement * DISTANCE_WEIGHT;

    const cashChange: PortfolioChange = { kind: "buy", holding: cashTemplate, amount: trancheSize };
    const { after: cashAfter, impact: cashImpact } = simulate(current, [cashChange], ctx);
    const cashDistanceImprovement = classDistance(current, desired) - classDistance(cashAfter, desired);
    const cashScore = (cashImpact.alignmentDelta ?? 0) + cashDistanceImprovement * DISTANCE_WEIGHT;

    // Brake 1 — the strategic class target.
    //
    // Without any brake, alignment alone will size almost anything up to the
    // concentration cap: every alignment theme that rewards diversification
    // keeps paying out as you add a new, uncorrelated asset to a concentrated
    // book, tranche after tranche. That logic recommended 13% of the portfolio
    // in bitcoin under Maximize Sharpe — an objective whose target holds no
    // crypto at all — purely because bitcoin decorrelates.
    //
    // How hard the brake is depends on what is known about the asset:
    //   - A class the objective allocates NOTHING to (target 0) is never sized
    //     into, signal or not — "no crypto" must not be talked out of by either
    //     the diversification dimensions or a hot research score. Manual
    //     Allocation remains available to overrule it.
    //   - With no research signal, an at-or-above-target class is also a hard
    //     stop: portfolio geometry is the only evidence available, and geometry
    //     says the class needs no more. This was previously the ONLY behavior —
    //     which meant every equity on an equity-overweight book was declined
    //     regardless of how strong its research case was.
    //   - With a research signal, the overweight is already priced in: the
    //     conviction target was scaled down for it above, and the per-tranche
    //     distance penalty below still argues against every overweight tranche
    //     — it just can be outbid by sufficient conviction (the alpha term).
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
    if (classTarget <= 0 && classAfter > classNow) { stoppedBy = "class_target"; break; }
    if (!conviction && classAfter > classTarget && classAfter > classNow) { stoppedBy = "class_target"; break; }

    // Alpha — the research case's edge, in the same pp units as the distance
    // term: conviction × ALPHA_WEIGHT per percentage point this tranche buys.
    // Zero without a signal, so the signal-free path is exactly the old duel.
    const tranchePP = (trancheSize / (current.totalValue + trancheSize)) * 100;
    const alpha = conviction ? conviction.conviction * ALPHA_WEIGHT * tranchePP : 0;

    // Brake 2 — does putting this money into the asset beat leaving it in cash?
    //
    // This deliberately replaces an earlier absolute gate (buyScore < 0.5). That
    // gate compared a per-tranche quantity against a fixed constant, but a
    // tranche is ~1/24th of the room to a concentration cap — on a large book it
    // moves any score by hundredths of a point, so the gate could only ever be
    // cleared by a large asset-class-gap term. The effect was that alignment was
    // decorative and the engine declined almost everything, including assets it
    // had itself measured as better than cash. The margin below is a noise
    // floor on a difference of two same-scale quantities, so it does not
    // inherit that scale dependence.
    if (buyBlocked || buyScore + alpha - cashScore <= NEGLIGIBLE_ADVANTAGE) {
      stoppedBy = buyBlocked ? "constraint" : "not_better_than_cash";
      break;
    }

    current = buyAfter;
    cumulative += trancheSize;
    totalAlignment += buyImpact.alignmentDelta ?? 0;
    marginalBenefit.push({ cumulativeAmount: Math.round(cumulative), alignmentDelta: Math.round(totalAlignment * 10) / 10 });
  }

  const recommendedAmount = Math.round(cumulative);
  const recommendedHolding = current.holdings.find((h) => h.symbol?.toUpperCase() === sym) ?? null;

  if (recommendedAmount <= 0) {
    // Same class the brake keyed on, so the reason names the class actually measured.
    const sizedClass = template.assetClass;
    const classLabel = PORTFOLIO_CLASS_LABEL[sizedClass] ?? sizedClass;
    const classTarget = desired.get(sizedClass) ?? 0;
    const classNow = weightOfClass(evaluation, sizedClass);

    const holdKind: HoldKind = stoppedBy === "class_target" ? "class_target" : stoppedBy === "constraint" ? "constraint" : "no_edge";
    const reason =
      stoppedBy === "class_target"
        ? classTarget <= 0
          ? `The ${objectiveLabel} objective allocates nothing to ${classLabel}, so there is no room to size this position against it. Use Manual Allocation to buy anyway, or switch objectives.`
          : `${classLabel} is already at ${classNow.toFixed(1)}% of your portfolio, at or above the ${classTarget.toFixed(1)}% the ${objectiveLabel} objective targets. Adding more would move you further from that target${signal == null ? ", and no research signal was available to argue otherwise" : ""}.`
        : stoppedBy === "constraint"
          ? `Buying even a small amount would breach one of your portfolio constraints (concentration, asset-class or liquidity limits).`
          : conviction
            ? `Even with the research case (composite ${signal?.compositeScore != null ? Math.round(signal.compositeScore) : "—"}/100, conviction ${(conviction.conviction * 100).toFixed(0)}%), every simulated tranche measured no better for the portfolio than holding cash${classNow > classTarget ? ` — the ${classLabel} overweight (${classNow.toFixed(1)}% vs ${classTarget.toFixed(1)}% target) outweighs the edge` : ` under the ${objectiveLabel} objective`}.`
            : `At every size up to your single-holding limit, this purchase measured no better for the portfolio than leaving the money in cash under the ${objectiveLabel} objective.`;

    return holdAt(reason, holdKind, {
      confidence: conviction ? blendConfidence(55) : 30,
      reasons: conviction ? [...conviction.drivers, ...contextNotes] : [],
      effectiveTargetWeightPct,
    });
  }

  // The tranche loop's per-step alignmentDelta sum telescopes to exactly this same
  // before/after diff, so this is the single source of truth for the plan's impact
  // — no separate accumulation to keep in sync.
  const impact: ImpactEstimate = estimateImpact(evaluation, current);

  /* ---- Alternative size scenarios (Section 4) — each independently simulated ---- */

  const checkpointMultiples = [0.3, 0.7, 1, 1.5];
  const seen = new Set<number>();
  const scenarios: SizeScenario[] = [];
  const perDollarAtRecommended = recommendedAmount > 0 ? (impact.alignmentDelta ?? 0) / recommendedAmount : 0;

  for (const mult of checkpointMultiples) {
    const amount = Math.round(recommendedAmount * mult);
    if (amount <= 0 || seen.has(amount)) continue;
    seen.add(amount);

    const { impact: scenarioImpact } = simulate(evaluation, [{ kind: "buy", holding: template, amount }], ctx);
    const alignmentDelta = Math.round((scenarioImpact.alignmentDelta ?? 0) * 10) / 10;
    const perDollar = amount > 0 ? alignmentDelta / amount : 0;

    scenarios.push({
      amount,
      shares: price > 0 ? Math.round((amount / price) * 1000) / 1000 : null,
      alignmentDelta,
      isRecommended: mult === 1,
      diminishingReturns: mult > 1 && perDollarAtRecommended > 0 && perDollar < perDollarAtRecommended * 0.4,
    });
  }
  scenarios.sort((a, b) => a.amount - b.amount);

  // Research first, portfolio context second, measured portfolio effects third
  // — the order a PM would state them in. The composite/upside drivers are
  // deliberately excluded: buildAiExplanation() already leads with them, and
  // repeating the same sentence as a bullet under the same card reads sloppy.
  const reasons = [
    ...(conviction ? conviction.drivers.filter((d) => !d.startsWith("Research composite") && !/upside|downside/.test(d)).slice(0, 2) : []),
    ...contextNotes,
    ...reasonsFor(evaluation, current, target),
  ].slice(0, 6);

  const confidence = blendConfidence(confidenceFor(impact, recommendedHolding, evaluation));

  return {
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "BUY",
    holdReason: null,
    holdKind: null,
    signal,
    conviction,
    effectiveTargetWeightPct,
    correlationWithHoldings: correlation != null ? Math.round(correlation * 100) / 100 : null,
    expectedReturn: expectedReturnFor(signal, evaluation, current, sym),
    confidenceTier: confidenceTierOf(confidence),
    recommendedAmount,
    recommendedShares: price > 0 ? Math.round((recommendedAmount / price) * 1000) / 1000 : null,
    recommendedAllocationPct: Math.round((recommendedHolding?.weight ?? 0) * 10) / 10,
    confidence,
    impact,
    before: evaluation,
    after: current,
    marginalBenefit,
    scenarios,
    reasons,
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
  signal: AssetSignal | null = null,
): PositionSizingPlan {
  const sym = target.symbol.toUpperCase();
  const price = ctx.quotes.get(sym)?.price ?? null;

  const conviction = signal && SIGNAL_CLASSES.has(target.assetClass) ? assessConviction(signal) : null;
  const correlation = highestCorrelationAgainstTopHoldings(sym, evaluation, ctx);
  const signalConfidence = signal?.scoreConfidence ?? null;
  const blendConfidence = (base: number) =>
    signalConfidence != null ? Math.round(0.6 * base + 0.4 * signalConfidence) : base;

  const holdAt = (reason: string, holdKind: HoldKind): PositionSizingPlan => ({
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "HOLD",
    holdReason: reason,
    holdKind,
    signal,
    conviction,
    effectiveTargetWeightPct: null,
    correlationWithHoldings: correlation != null ? Math.round(correlation * 100) / 100 : null,
    expectedReturn: null,
    confidenceTier: confidenceTierOf(30),
    recommendedAmount: 0,
    recommendedShares: null,
    recommendedAllocationPct: evaluation.holdings.find((h) => h.symbol?.toUpperCase() === sym)?.weight ?? 0,
    confidence: 30,
    impact: { alignmentDelta: 0, themeDeltas: [], riskDelta: null, diversificationDelta: 0, incomeDelta: 0, inflationDelta: null, liquidityDelta: 0 },
    before: evaluation,
    after: evaluation,
    marginalBenefit: [{ cumulativeAmount: 0, alignmentDelta: 0 }],
    scenarios: [],
    reasons: [],
  });

  if (!Number.isFinite(amount) || amount <= 0) return holdAt("Enter an amount greater than zero.", "no_edge");
  if (evaluation.totalValue <= 0 || evaluation.holdings.length === 0) {
    return holdAt("Build your portfolio first — sizing is measured against your actual holdings, cash and objective, and there is nothing to measure against yet.", "no_portfolio");
  }

  const template = templateHoldingFor(target, evaluation, ctx);
  if (!template || price == null || price <= 0) return holdAt("No live price is available for this symbol right now.", "no_price");

  const { after, impact } = simulate(evaluation, [{ kind: "buy", holding: template, amount }], ctx);
  const recommendedHolding = after.holdings.find((h) => h.symbol?.toUpperCase() === sym) ?? null;

  const confidence = blendConfidence(confidenceFor(impact, recommendedHolding, evaluation));

  return {
    symbol: sym,
    name: target.name,
    assetClass: target.assetClass,
    price,
    objective,
    action: "BUY",
    holdReason: null,
    holdKind: null,
    signal,
    conviction,
    effectiveTargetWeightPct: null,
    correlationWithHoldings: correlation != null ? Math.round(correlation * 100) / 100 : null,
    expectedReturn: expectedReturnFor(signal, evaluation, after, sym),
    confidenceTier: confidenceTierOf(confidence),
    recommendedAmount: Math.round(amount),
    recommendedShares: price > 0 ? Math.round((amount / price) * 1000) / 1000 : null,
    recommendedAllocationPct: Math.round((recommendedHolding?.weight ?? 0) * 10) / 10,
    confidence,
    impact,
    before: evaluation,
    after,
    marginalBenefit: [{ cumulativeAmount: 0, alignmentDelta: 0 }, { cumulativeAmount: Math.round(amount), alignmentDelta: Math.round((impact.alignmentDelta ?? 0) * 10) / 10 }],
    scenarios: [],
    reasons: reasonsFor(evaluation, after, target),
  };
}
