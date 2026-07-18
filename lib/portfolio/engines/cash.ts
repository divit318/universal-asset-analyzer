/**
 * Capital Allocation Engine — "Allocate New Cash".
 *
 * Deploys new cash into the ENTIRE investable universe — existing holdings, every
 * candidate exposure, and cash itself — the way an institutional PM would: pick an
 * objective, then find where the next dollar does the most good under that
 * objective, subject to real constraints, never selling anything already held.
 *
 * ALGORITHM. Fine-grained greedy water-filling, not a single-shot heuristic. Cash
 * is deployed in ~18 small tranches; at each step every eligible candidate is
 * priced by simulating the trade through the real engines (simulate.ts) and scored
 * against how much it reduces the distance between the portfolio's asset-class mix
 * and the SELECTED OBJECTIVE's strategic target (the same `OBJECTIVES` table
 * optimize.ts already owns — one definition, two consumers, so "Income" always
 * means the same thing whether you're rebalancing or deploying new cash). This is
 * the same mathematical structure `distributeWithinClass()` already uses for
 * within-class sizing: for a concave, separable objective (diminishing marginal
 * benefit per dollar in any one candidate — which target-distance improvement
 * genuinely is), greedy allocation over a fine partition converges to the
 * constrained optimum. More tranches = closer to the true optimum, and that is
 * provable, not asserted — which is why this app does NOT run a mean-variance
 * optimizer on 90 days of noisy price history (see optimize.ts's header): there is
 * no honest covariance/expected-return estimate to feed one.
 *
 * Every number this engine produces — health delta, objective-alignment delta,
 * the marginal-benefit curve, why an alternative lost, why a major holding or
 * candidate was never selected — is read directly off the same tranche-by-tranche
 * simulation, never asserted after the fact. English narration of these structured
 * results (WhyExplanation, rejection sentences, the held-cash sentence) lives in
 * cash-explain.ts, mirroring how decision.ts narrates recommend.ts's output
 * without adding new heuristics of its own.
 */

import { CANDIDATES, candidateToRaw } from "./candidates";
import { applyChange, evaluate, simulate, type PortfolioEvaluation, type PortfolioChange } from "./simulate";
import { normalizeHoldings } from "../model/holding";
import type { Holding, MarketContext, RawHolding, PortfolioAssetClass } from "../model/types";
import { PORTFOLIO_CLASS_LABEL } from "../model/types";
import { OBJECTIVES, normalize, DEFAULT_CONSTRAINTS, type Objective, type Constraints } from "./optimize";
import { pearson } from "../../portfolio-analytics";

export const DEFAULT_TRANCHES = 18;
const ELIGIBLE_SCORE_MIN = 55;
const ELIGIBLE_CONFIDENCE_MIN = 45;
const HIGH_CORRELATION_THRESHOLD = 0.85;
const CORRELATION_MIN_HOLDING_WEIGHT = 10; // % — only worth checking against holdings big enough to matter
/** Below this combined score, a tranche's measured effect rounds to "didn't move anything". */
const NEGLIGIBLE_SCORE_THRESHOLD = 0.5;

export type RejectionReason =
  | "constraint_capped"
  | "already_at_target"
  | "high_correlation"
  | "negligible_improvement"
  | "inferior_alternative";

export type HeldCashReason = "cash_optimal" | "below_threshold" | "no_opportunity";

export interface AlternativeConsidered {
  symbol: string | null;
  name: string;
  score: number;
  /** 0-100, relative to the winning option's own best measured score. */
  relativeScorePct: number;
  reasonRejected: RejectionReason;
}

export interface CashAllocationItem {
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  assetClassLabel: string;
  dollarAmount: number;
  shareCount: number | null;
  /** Weight this position will have AFTER the cash is deployed. */
  resultingWeight: number;
  /** What this vehicle is / why it exists as a candidate — static context, not a measured claim. */
  reason: string;
  /** Health-score improvement attributable to this tranche. Measured, summed across every round this option won. */
  healthDelta: number;
  /** Reduction in distance to the selected objective's strategic target, summed across winning rounds. */
  objectiveAlignmentDelta: number;
  /** Change in annualized volatility (pp), summed across winning rounds. Null when risk coverage never supported a measurement. */
  riskDelta: number | null;
  /** Change in asset-class HHI, summed across winning rounds. Negative = better diversified. */
  diversificationDelta: number;
  /** Change in expected annual income ($), summed across winning rounds. */
  incomeDelta: number;
  /** Confidence of the resulting holding's score, where one exists. Never fabricated when absent. */
  confidence: number | null;
  /** 1 = strongest measured contribution to this plan. */
  rank: number;
  alternatives: AlternativeConsidered[];
}

export interface RejectedOpportunity {
  symbol: string | null;
  subject: string;
  assetClass: PortfolioAssetClass;
  assetClassLabel: string;
  reason: RejectionReason;
  /** The best single-tranche score this option ever achieved across the whole run, if it competed at all. */
  bestScoreSeen: number | null;
}

export interface MarginalBenefitPoint {
  cumulativeAmount: number;
  healthDelta: number;
}

export interface CashAllocationPlan {
  cashAmount: number;
  objective: Objective;
  items: CashAllocationItem[];
  /** Amount deliberately left in cash. */
  heldAsCash: number;
  heldAsCashReason: HeldCashReason;
  /** Total measured health improvement from the whole plan. */
  totalHealthDelta: number;
  /** Cumulative health improvement at each tranche boundary — the diminishing-returns curve, derived for free from the same run that built the plan. */
  marginalBenefit: MarginalBenefitPoint[];
  /** Major candidates/holdings that never won a single tranche, with why. */
  rejectedOpportunities: RejectedOpportunity[];
  /** The fully-evaluated portfolio AFTER this plan, for before/after comparisons — the exact state the tranche loop actually simulated, not reconstructed. */
  after: PortfolioEvaluation;
  summary: string;
}

/** Cash held as cash — the option a purely-additive engine must still be able to choose. */
function cashRaw(amount: number): RawHolding {
  return {
    id: "candidate:cash",
    assetClass: "cash",
    symbol: null,
    name: "Cash",
    currency: "USD",
    quantity: amount,
    unit: "currency",
    costBasis: amount,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    // Assume a competitive money-market yield rather than 0% — leaving cash idle at
    // 0% is a choice the user can make, but it isn't the honest default for
    // "cash you have just decided to hold".
    meta: { candidate: true, yieldPct: 4.3, vehicle: "Money market / T-bills" },
  };
}

interface Option {
  key: string;
  label: string;
  symbol: string | null;
  assetClass: PortfolioAssetClass;
  reason: string;
  build: (amount: number) => Holding | null;
}

function buildOptions(evaluation: PortfolioEvaluation, ctx: MarketContext, constraints: Constraints): Option[] {
  const options: Option[] = [];

  // 1. Every candidate exposure not explicitly excluded.
  for (const c of CANDIDATES) {
    if (constraints.excludedSymbols.includes(c.symbol)) continue;
    options.push({
      key: `cand:${c.symbol}`,
      label: c.name,
      symbol: c.symbol,
      assetClass: c.assetClass,
      reason: c.rationale,
      build: (amount) => {
        const price = ctx.quotes.get(c.symbol.toUpperCase())?.price ?? null;
        const { holdings } = normalizeHoldings([candidateToRaw(c, amount, price)], ctx);
        return holdings[0] ?? null;
      },
    });
  }

  // 2. Adding to existing holdings — but only ones we can actually justify. A high
  //    score at low confidence is not a reason to buy more of something, and a
  //    holding already at the concentration cap has nowhere left to go.
  for (const h of evaluation.holdings) {
    if (h.liquidity === "illiquid") continue; // can't "add $5k" to a house
    if (!h.score || h.score.score < ELIGIBLE_SCORE_MIN || h.score.confidence < ELIGIBLE_CONFIDENCE_MIN) continue;
    if (h.symbol && constraints.excludedSymbols.includes(h.symbol)) continue;
    if (h.weight >= constraints.maxHoldingPct) continue;

    options.push({
      key: `add:${h.id}`,
      label: h.name,
      symbol: h.symbol,
      assetClass: h.assetClass,
      reason: `Existing holding scoring ${h.score.score}/100 at ${h.score.confidence}% confidence. ${h.score.why[0] ?? ""}`.trim(),
      // Resizing happens in applyChange(), so the tranche amount isn't needed here.
      build: () => h,
    });
  }

  // 3. Hold it as cash.
  options.push({
    key: "cash",
    label: "Cash",
    symbol: null,
    assetClass: "cash",
    reason: "Holding cash is the right answer when nothing else measurably improves the portfolio under this objective — it preserves optionality and funds the next opportunity.",
    build: (amount) => {
      const { holdings } = normalizeHoldings([cashRaw(amount)], ctx);
      return holdings[0] ?? null;
    },
  });

  return options;
}

/**
 * L1 distance between the portfolio's current asset-class mix and the objective's
 * strategic target. Lower is better; this — not raw health — is what "objective
 * alignment" measures. Exported so other engines that need to score a hypothetical
 * trade against the SAME strategic target (e.g. engines/position-size.ts's
 * single-symbol sizing) reuse this exact formula instead of re-deriving it.
 */
export function classDistance(e: PortfolioEvaluation, desired: Map<PortfolioAssetClass, number>): number {
  const classes = new Set<PortfolioAssetClass>();
  for (const k of desired.keys()) classes.add(k);
  for (const s of e.allocation.byAssetClass.slices) classes.add(s.key as PortfolioAssetClass);

  let dist = 0;
  for (const cls of classes) {
    const current = e.allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
    const target = desired.get(cls) ?? 0;
    dist += Math.abs(current - target);
  }
  return dist;
}

/** A resulting holding/asset-class/sector/geography weight has crossed a hard cap. */
function violatesConstraints(option: Option, after: PortfolioEvaluation, constraints: Constraints): boolean {
  if (option.assetClass === "cash") return false;

  const classWeight = after.allocation.byAssetClass.slices.find((s) => s.key === option.assetClass)?.weight ?? 0;
  if (classWeight > constraints.maxAssetClassPct + 1e-9) return true;

  const holding = option.symbol
    ? after.holdings.find((h) => h.symbol === option.symbol)
    : after.holdings.find((h) => h.id === option.key.replace(/^add:/, ""));
  if (!holding) return false;

  if (holding.weight > constraints.maxHoldingPct + 1e-9) return true;

  const sector = holding.attributes.sector;
  if (sector) {
    const sectorWeight = after.allocation.bySector.slices.find((s) => s.key === sector)?.weight ?? 0;
    if (sectorWeight > constraints.maxSectorPct + 1e-9) return true;
  }

  const geography = holding.attributes.geography;
  if (geography) {
    const geoWeight = after.allocation.byGeography.slices.find((s) => s.key === geography)?.weight ?? 0;
    if (geoWeight > constraints.maxCountryPct + 1e-9) return true;
  }

  return false;
}

function simpleReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) out.push(closes[i] / closes[i - 1] - 1);
  }
  return out;
}

/**
 * Best-effort correlation against the portfolio's largest existing holdings, using
 * the same real-return-series math risk.ts already relies on (lib/portfolio-
 * analytics.ts's pearson()). Returns null — never an assumed 0 — when either series
 * lacks enough history, matching risk.ts's own "exclude, don't assume uncorrelated"
 * discipline. End-aligned by trailing window rather than by trading date, so this
 * is an approximation, not a covariance-matrix-grade figure — used only to decide
 * whether "highly correlated with an existing holding" is a fair rejection reason.
 */
function highestCorrelationAgainstTopHoldings(
  symbol: string | null,
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
): number | null {
  if (!symbol) return null;
  const candidateCloses = ctx.history.get(symbol.toUpperCase());
  if (!candidateCloses || candidateCloses.length < 30) return null;
  const candidateReturns = simpleReturns(candidateCloses);

  let best: number | null = null;
  for (const h of evaluation.holdings) {
    if (!h.symbol || h.weight < CORRELATION_MIN_HOLDING_WEIGHT) continue;
    if (h.symbol.toUpperCase() === symbol.toUpperCase()) continue;
    const closes = ctx.history.get(h.symbol.toUpperCase());
    if (!closes || closes.length < 30) continue;
    const returns = simpleReturns(closes);
    const n = Math.min(returns.length, candidateReturns.length);
    if (n < 30) continue;
    const r = pearson(candidateReturns.slice(-n), returns.slice(-n));
    if (Number.isFinite(r) && (best == null || Math.abs(r) > Math.abs(best))) best = r;
  }
  return best;
}

function classifyRejection(
  option: Option,
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
  everBlocked: Set<string>,
  initialDistance: Map<string, number>,
  bestScoreSeen: Map<string, number>,
): RejectionReason {
  if (everBlocked.has(option.key)) return "constraint_capped";

  const corr = highestCorrelationAgainstTopHoldings(option.symbol, evaluation, ctx);
  if (corr != null && Math.abs(corr) >= HIGH_CORRELATION_THRESHOLD) return "high_correlation";

  if ((initialDistance.get(option.key) ?? 0) <= 0) return "already_at_target";

  if ((bestScoreSeen.get(option.key) ?? 0) < NEGLIGIBLE_SCORE_THRESHOLD) return "negligible_improvement";

  return "inferior_alternative";
}

function relativeScorePct(altScore: number, winnerBest: number): number {
  if (winnerBest <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((altScore / winnerBest) * 100)));
}

/**
 * Deploy `cashAmount` under `objective`, subject to `constraints`. Deterministic
 * and idempotent: identical inputs always produce identical output, and applying
 * the plan then re-running this function on the result proposes no further
 * material deployment for the same objective (the portfolio has moved as close to
 * the target as tranche granularity and the constraints allow).
 */
export function computeCashAllocation(
  evaluation: PortfolioEvaluation,
  cashAmount: number,
  objective: Objective,
  ctx: MarketContext,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  tranches: number = DEFAULT_TRANCHES,
): CashAllocationPlan {
  if (cashAmount <= 0) {
    return {
      cashAmount,
      objective,
      items: [],
      heldAsCash: 0,
      heldAsCashReason: "no_opportunity",
      totalHealthDelta: 0,
      marginalBenefit: [],
      rejectedOpportunities: [],
      after: evaluation,
      summary: "No cash to allocate.",
    };
  }

  const rawTarget = objective === "target_allocation" && customTarget ? customTarget : OBJECTIVES[objective].target;
  const desired = normalize(rawTarget);

  const options = buildOptions(evaluation, ctx, constraints);
  const trancheSize = cashAmount / tranches;

  const wonBy = new Map<
    string,
    {
      option: Option;
      amount: number;
      healthDelta: number;
      alignmentDelta: number;
      riskDeltaSum: number;
      riskDeltaCount: number;
      diversificationDelta: number;
      incomeDelta: number;
    }
  >();
  const everBlocked = new Set<string>();
  const bestScoreSeen = new Map<string, number>();
  const closeAlternatives = new Map<string, Map<string, { option: Option; score: number }>>();
  const initialDistance = new Map<string, number>();

  let current = evaluation;
  let totalDelta = 0;
  const marginalBenefit: MarginalBenefitPoint[] = [{ cumulativeAmount: 0, healthDelta: 0 }];

  let cashRoundsBeatRealAlternative = 0;
  let cashRoundsBelowThreshold = 0;
  let cashRoundsNoRealAlternative = 0;

  for (let t = 0; t < tranches; t++) {
    const roundEntries: {
      option: Option;
      score: number;
      distanceImprovement: number;
      healthDelta: number;
      riskDelta: number | null;
      diversificationDelta: number;
      incomeDelta: number;
      after: PortfolioEvaluation;
      blocked: boolean;
    }[] = [];

    for (const opt of options) {
      const holding = opt.build(trancheSize);
      if (!holding) continue;

      const change: PortfolioChange = { kind: "buy", holding, amount: trancheSize };
      const { after, impact } = simulate(current, [change], ctx);

      const blocked = violatesConstraints(opt, after, constraints);
      const distanceImprovement = classDistance(current, desired) - classDistance(after, desired);
      const score = distanceImprovement * 100 + impact.healthDelta;

      if (t === 0) initialDistance.set(opt.key, distanceImprovement);

      roundEntries.push({
        option: opt,
        score,
        distanceImprovement,
        healthDelta: impact.healthDelta,
        riskDelta: impact.riskDelta,
        diversificationDelta: impact.diversificationDelta,
        incomeDelta: impact.incomeDelta,
        after,
        blocked,
      });

      if (blocked) everBlocked.add(opt.key);
      else bestScoreSeen.set(opt.key, Math.max(bestScoreSeen.get(opt.key) ?? -Infinity, score));
    }

    const eligible = roundEntries.filter((e) => !e.blocked).sort((a, b) => b.score - a.score);
    if (eligible.length === 0) break; // every option constraint-blocked — nowhere left to place this tranche

    const winner = eligible[0];

    if (winner.option.key === "cash") {
      const runnerUp = eligible[1];
      if (!runnerUp) cashRoundsNoRealAlternative++;
      else if (runnerUp.score < NEGLIGIBLE_SCORE_THRESHOLD) cashRoundsBelowThreshold++;
      else cashRoundsBeatRealAlternative++;
    }

    const runnerUps = eligible.slice(1, 4);
    if (runnerUps.length > 0) {
      const bucket = closeAlternatives.get(winner.option.key) ?? new Map<string, { option: Option; score: number }>();
      for (const r of runnerUps) {
        const prev = bucket.get(r.option.key);
        if (!prev || r.score > prev.score) bucket.set(r.option.key, { option: r.option, score: r.score });
      }
      closeAlternatives.set(winner.option.key, bucket);
    }

    const prevWin = wonBy.get(winner.option.key);
    wonBy.set(winner.option.key, {
      option: winner.option,
      amount: (prevWin?.amount ?? 0) + trancheSize,
      healthDelta: (prevWin?.healthDelta ?? 0) + winner.healthDelta,
      alignmentDelta: (prevWin?.alignmentDelta ?? 0) + winner.distanceImprovement,
      riskDeltaSum: (prevWin?.riskDeltaSum ?? 0) + (winner.riskDelta ?? 0),
      riskDeltaCount: (prevWin?.riskDeltaCount ?? 0) + (winner.riskDelta != null ? 1 : 0),
      diversificationDelta: (prevWin?.diversificationDelta ?? 0) + winner.diversificationDelta,
      incomeDelta: (prevWin?.incomeDelta ?? 0) + winner.incomeDelta,
    });

    totalDelta += winner.healthDelta;
    current = winner.after;
    marginalBenefit.push({
      cumulativeAmount: Math.round((t + 1) * trancheSize),
      healthDelta: Math.round(totalDelta * 10) / 10,
    });
  }

  const finalTotal = current.totalValue;
  const items: CashAllocationItem[] = [];
  let heldAsCash = 0;

  for (const { option, amount, healthDelta, alignmentDelta, riskDeltaSum, riskDeltaCount, diversificationDelta, incomeDelta } of wonBy.values()) {
    if (option.key === "cash") {
      heldAsCash = Math.round(amount);
      continue;
    }
    const price = option.symbol ? ctx.quotes.get(option.symbol.toUpperCase())?.price ?? null : null;
    const resulting = current.holdings.find(
      (h) => h.symbol === option.symbol || h.id === option.key.replace(/^add:/, ""),
    );

    const winnerBest = bestScoreSeen.get(option.key) ?? 0;
    const alternatives: AlternativeConsidered[] = [...(closeAlternatives.get(option.key)?.values() ?? [])]
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((alt) => ({
        symbol: alt.option.symbol,
        name: alt.option.label,
        score: Math.round(alt.score * 100) / 100,
        relativeScorePct: relativeScorePct(alt.score, winnerBest),
        reasonRejected: classifyRejection(alt.option, evaluation, ctx, everBlocked, initialDistance, bestScoreSeen),
      }));

    items.push({
      symbol: option.symbol,
      name: option.label,
      assetClass: option.assetClass,
      assetClassLabel: PORTFOLIO_CLASS_LABEL[option.assetClass] ?? option.assetClass,
      dollarAmount: Math.round(amount),
      shareCount: price != null && price > 0 ? Math.floor(amount / price) : null,
      resultingWeight: resulting
        ? Math.round((resulting.valuation.valueBase / Math.max(finalTotal, 1)) * 1000) / 10
        : Math.round((amount / Math.max(finalTotal, 1)) * 1000) / 10,
      reason: option.reason,
      healthDelta: Math.round(healthDelta * 10) / 10,
      objectiveAlignmentDelta: Math.round(alignmentDelta * 10) / 10,
      riskDelta: riskDeltaCount > 0 ? Math.round(riskDeltaSum * 10) / 10 : null,
      diversificationDelta: Math.round(diversificationDelta),
      incomeDelta: Math.round(incomeDelta),
      confidence: resulting?.score?.confidence ?? null,
      rank: 0,
      alternatives,
    });
  }

  items.sort((a, b) => (b.healthDelta * 3 + b.objectiveAlignmentDelta) - (a.healthDelta * 3 + a.objectiveAlignmentDelta));
  items.forEach((it, i) => {
    it.rank = i + 1;
  });

  const rejectedOpportunities: RejectedOpportunity[] = [];
  for (const opt of options) {
    if (opt.key === "cash" || wonBy.has(opt.key)) continue;
    rejectedOpportunities.push({
      symbol: opt.symbol,
      subject: opt.label,
      assetClass: opt.assetClass,
      assetClassLabel: PORTFOLIO_CLASS_LABEL[opt.assetClass] ?? opt.assetClass,
      reason: classifyRejection(opt, evaluation, ctx, everBlocked, initialDistance, bestScoreSeen),
      bestScoreSeen: bestScoreSeen.has(opt.key) ? Math.round((bestScoreSeen.get(opt.key) as number) * 100) / 100 : null,
    });
  }

  let heldAsCashReason: HeldCashReason = "cash_optimal";
  if (heldAsCash > 0) {
    if (cashRoundsBeatRealAlternative > 0) heldAsCashReason = "cash_optimal";
    else if (cashRoundsBelowThreshold > 0) heldAsCashReason = "below_threshold";
    else if (cashRoundsNoRealAlternative > 0) heldAsCashReason = "no_opportunity";
  }

  const summary =
    items.length === 0
      ? `The portfolio is already well-aligned with the ${OBJECTIVES[objective].label} objective. Holding the full $${cashAmount.toLocaleString()} in cash is the honest recommendation — no available exposure measurably improves it.`
      : `Deploying $${(cashAmount - heldAsCash).toLocaleString()} across ${items.length} ${items.length === 1 ? "position" : "positions"} under the ${OBJECTIVES[objective].label} objective` +
        (heldAsCash > 0 ? `, holding $${heldAsCash.toLocaleString()} in cash` : "") +
        `. Projected health improvement: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)} points.`;

  return {
    cashAmount,
    objective,
    items,
    heldAsCash,
    heldAsCashReason,
    totalHealthDelta: Math.round(totalDelta * 10) / 10,
    marginalBenefit,
    rejectedOpportunities,
    after: current,
    summary,
  };
}

// Re-exported so callers driving a hypothetical "what if I bought this candidate
// outright" preview don't need a separate import path.
export { applyChange, evaluate };
