/**
 * Universal Optimization Engine.
 *
 * The old optimizer was `computeTargetWeights()`: equal-weight, plus a premium of
 * ±0.2% per composite point, capped at 18% per name. That is a STOCK-SIZING
 * heuristic. It has no concept of an asset class, so it cannot express "hold 60%
 * equities / 30% bonds / 10% real assets" — the single most consequential decision
 * in portfolio construction, and the one that empirically explains most of the
 * variance in outcomes.
 *
 * This optimizer works in TWO stages, which is how the problem is actually shaped:
 *
 *   1. ASSET ALLOCATION — what fraction belongs in each class, given the objective
 *      and the constraints. This is where the real risk/return decision is made.
 *   2. WITHIN-CLASS SIZING — distribute each class's budget across its holdings by
 *      confidence-weighted score. A holding scoring 80 at 30% confidence does NOT
 *      get sized like one scoring 80 at 90%.
 *
 * Objectives are expressed as target allocations plus a scoring tilt, so the same
 * machinery serves "maximize income" and "target inflation protection" without a
 * special case for either.
 */

import { evaluate, estimateImpact, applyTargetPlanConserving, type PortfolioEvaluation, type ImpactEstimate, type TargetWeightChange } from "./simulate";
import type { Holding, MarketContext, PortfolioAssetClass } from "../model/types";
import { PORTFOLIO_CLASS_LABEL, describeIlliquidWeight, isIlliquid } from "../model/types";
import { MAX_SINGLE_HOLDING_PCT, MATERIAL_WEIGHT_DELTA_PCT } from "../policy";
import { formatCurrency } from "../../format";

export type Objective =
  | "maximize_return"
  | "minimize_volatility"
  | "maximize_sharpe"
  | "maximize_income"
  | "maximize_diversification"
  | "inflation_protection"
  | "preserve_capital"
  | "balanced"
  | "growth"
  | "target_allocation";

export interface ObjectiveConfig {
  label: string;
  description: string;
  icon: string;
  /** Strategic asset-allocation target for this objective, in %. */
  target: Partial<Record<PortfolioAssetClass, number>>;
}

/**
 * Strategic allocations per objective. These are conventional, defensible starting
 * points, not optimizer output — we do not have the return/covariance estimates a
 * true mean-variance optimizer would need, and pretending otherwise (by running an
 * MVO on 90 days of noisy history) produces confident nonsense. Stating the target
 * openly and letting the user override it is the honest design.
 */
export const OBJECTIVES: Record<Objective, ObjectiveConfig> = {
  maximize_return: {
    label: "Maximize Return",
    description: "Growth-first. Accepts higher drawdowns for higher expected return.",
    icon: "↗",
    target: { equity: 55, etf: 25, crypto: 5, reit: 5, bond: 5, cash: 5 },
  },
  minimize_volatility: {
    label: "Minimize Volatility",
    description: "Smoothest ride. Heavy duration and cash, low equity beta.",
    icon: "◉",
    target: { bond: 50, cash: 15, equity: 15, etf: 10, reit: 5, commodity: 5 },
  },
  maximize_sharpe: {
    label: "Maximize Sharpe",
    description: "Best return per unit of risk — a balanced, classically-diversified mix.",
    icon: "⚡",
    target: { equity: 35, etf: 20, bond: 25, reit: 7, commodity: 8, cash: 5 },
  },
  maximize_income: {
    label: "Maximize Income",
    description: "Cash flow first: coupons, dividends, rent.",
    icon: "$",
    target: { bond: 40, reit: 20, equity: 20, etf: 10, cash: 10 },
  },
  maximize_diversification: {
    label: "Maximize Diversification",
    description: "Spread across every available class, minimizing correlation.",
    icon: "⊞",
    target: { equity: 25, etf: 15, bond: 25, reit: 10, commodity: 12, crypto: 3, cash: 10 },
  },
  inflation_protection: {
    label: "Inflation Protection",
    description: "Real assets and inflation-linked bonds. Minimizes purchasing-power loss.",
    icon: "▲",
    target: { commodity: 20, reit: 20, equity: 25, bond: 20, real_estate: 5, cash: 10 },
  },
  preserve_capital: {
    label: "Preserve Capital",
    description: "Protect principal. Short duration, high liquidity, minimal drawdown.",
    icon: "◈",
    target: { bond: 45, cash: 30, equity: 12, etf: 8, commodity: 5 },
  },
  balanced: {
    label: "Balanced",
    description: "A classic 60/40-style split — growth and ballast in roughly equal measure.",
    icon: "⚖",
    target: { equity: 35, etf: 20, bond: 30, reit: 5, commodity: 5, cash: 5 },
  },
  growth: {
    label: "Growth",
    description: "Equity-tilted for long-horizon appreciation, with less concentration than Maximize Return.",
    icon: "▲",
    target: { equity: 45, etf: 25, bond: 10, reit: 5, commodity: 5, crypto: 3, cash: 7 },
  },
  target_allocation: {
    label: "Custom Target",
    description: "Your own strategic allocation.",
    icon: "⚙",
    target: {},
  },
};

export interface Constraints {
  maxHoldingPct: number;
  maxAssetClassPct: number;
  maxSectorPct: number;
  /** Cap on any single country/geography's combined target weight. */
  maxCountryPct: number;
  minCashPct: number;
  /** Cap on holdings that cannot be sold within days. */
  maxIlliquidPct: number;
  /** Portfolio duration ceiling, in years. Null = unconstrained. */
  maxDuration: number | null;
  excludedSymbols: string[];
  /** Never propose selling these (tax lots, restricted stock, a home). */
  lockedHoldingIds: string[];
}

export const DEFAULT_CONSTRAINTS: Constraints = {
  maxHoldingPct: MAX_SINGLE_HOLDING_PCT,
  maxAssetClassPct: 70,
  maxSectorPct: 40,
  // Generous by design: most real portfolios are heavily home-country-biased
  // (allocation.ts's own concentration checker only flags single-currency at
  // ≥90% as "medium", not "high") — this is a genuine backstop, not a rule
  // that fires on every US-based retail portfolio by default.
  maxCountryPct: 90,
  minCashPct: 2,
  maxIlliquidPct: 30,
  maxDuration: null,
  excludedSymbols: [],
  lockedHoldingIds: [],
};

export interface TargetWeight {
  holdingId: string;
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  currentWeight: number;
  targetWeight: number;
  delta: number;
  dollarDelta: number;
  action: "BUY" | "SELL" | "HOLD";
  reason: string;
  /** True when the holding cannot actually be traded to its target. */
  constrained: boolean;
}

export interface ClassTarget {
  assetClass: PortfolioAssetClass;
  label: string;
  currentWeight: number;
  targetWeight: number;
  delta: number;
}

export interface OptimizationResult {
  objective: Objective;
  classTargets: ClassTarget[];
  holdings: TargetWeight[];
  /** Trades worth doing — filtered by a materiality threshold. */
  trades: TargetWeight[];
  /** Measured impact of executing the whole plan. */
  impact: ReturnType<typeof estimateImpact>;
  /**
   * Where the money for `trades` comes from. The full trade list rarely nets to
   * zero (see PlanFundingDisclosure) and a plan whose funding is not stated is a
   * plan the user cannot check.
   */
  funding: PlanFundingDisclosure;
  warnings: string[];
}

/* -------------------------------------------------------------------------- */
/* Funding — can this plan actually be paid for?                               */
/* -------------------------------------------------------------------------- */

/**
 * A cash imbalance smaller than this is not one. Shared with the executor's
 * cash-balancing lot so "self-funded" means exactly "the executor writes no cash
 * plug" — not two thresholds that agree most of the time.
 */
export const CASH_SETTLEMENT_TOLERANCE = 0.5;

export interface PlanFunding {
  /** Dollars of buying. */
  buys: number;
  /** Dollars of selling. */
  sells: number;
  /** buys + sells — gross dollars traded, the turnover numerator. */
  gross: number;
  /** buys − sells. Positive = the plan consumes cash; negative = it releases cash. */
  netCash: number;
  /** Base-currency cash the plan can draw on. */
  cashAvailable: number;
  /** Cash left once the plan settles. */
  cashAfter: number;
  /** True when the sells alone pay for the buys. */
  selfFunded: boolean;
  /**
   * Dollars the plan needs beyond BOTH its own sell proceeds and the cash
   * balance. Anything above zero cannot be executed as shown — the executor caps
   * its cash draw at what exists, so the excess buys would land unfunded.
   */
  shortfall: number;
}

export interface PlanFundingDisclosure extends PlanFunding {
  /**
   * How many target changes are real but too small to list as trades (under
   * MATERIAL_WEIGHT_DELTA_PCT). Their dollars are still part of why buys and
   * sells don't tie out, so the count has to be visible.
   */
  unlistedTrades: number;
  /**
   * Net dollars of everything the trade list does NOT show: the sub-materiality
   * target changes above, plus the cash holding's own target change. Because the
   * optimizer's governing invariant is that target changes sum to zero across
   * EVERY holding, this is exactly `-netCash` — which is the proof that the
   * apparent buy/sell gap is disclosure, not arithmetic.
   */
  unlistedNetCash: number;
}

/**
 * Base-currency cash a rebalance can draw on.
 *
 * Shared with the executor's cashBalancingLot() so the number the UI promises is
 * the number the executor will actually find. It SUMS every base-currency cash
 * holding rather than taking the first: a book that has both a checking lot and a
 * money-market lot in USD has two, and funding a plan from only one of them
 * understates available cash and silently under-funds the buys.
 */
export function availableBaseCash(holdings: readonly Holding[], baseCurrency: string): number {
  const base = (baseCurrency || "USD").toUpperCase();
  return holdings
    .filter((h) => h.assetClass === "cash" && h.currency.toUpperCase() === base)
    .reduce((s, h) => s + h.valuation.valueBase, 0);
}

/**
 * Can this set of trades be paid for?
 *
 * A rebalancing plan's buys and sells are NOT expected to tie out, and that is the
 * single most confusing thing about a trade list. Two entirely legitimate reasons:
 *
 *   1. The objective may want more or less invested than the portfolio currently
 *      is, so the difference is a genuine cash draw or a genuine cash build.
 *   2. The list is filtered to material trades (MATERIAL_WEIGHT_DELTA_PCT). The
 *      sub-threshold moves the optimizer counted on are not shown, so the visible
 *      buys can exceed the visible sells by their sum.
 *
 * Neither is an error, but both are invisible unless stated — and the difference
 * between them and a genuinely unfundable plan is exactly what a user needs to
 * know before pressing Implement. `dollarDelta` is signed (positive = buy) and is
 * expected to already be scaled by any partial-implementation percentage.
 */
export function computePlanFunding(
  trades: readonly { dollarDelta: number }[],
  cashAvailable: number,
): PlanFunding {
  let buys = 0;
  let sells = 0;
  for (const t of trades) {
    if (t.dollarDelta > 0) buys += t.dollarDelta;
    else sells += -t.dollarDelta;
  }
  const netCash = buys - sells;
  return {
    buys,
    sells,
    gross: buys + sells,
    netCash,
    cashAvailable,
    cashAfter: cashAvailable - netCash,
    selfFunded: netCash <= CASH_SETTLEMENT_TOLERANCE,
    shortfall: Math.max(0, netCash - cashAvailable),
  };
}

/* -------------------------------------------------------------------------- */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Distribute a class's budget across its holdings.
 *
 * Confidence-weighted: a holding we know little about drifts toward its equal-weight
 * share rather than being sized on a score we don't trust. This is the difference
 * between "NVDA scores 85, so make it 20%" and "NVDA scores 85 with 90% confidence,
 * so make it 20% — but this crypto position scores 85 with 30% confidence, so size
 * it near neutral."
 */
function distributeWithinClass(
  holdings: Holding[],
  budget: number,
  maxHoldingPct: number,
): Map<string, number> {
  const out = new Map<string, number>();
  if (holdings.length === 0) return out;

  // A zero budget is an explicit "sell all of this", not "nothing to say" — it
  // must be written into the map. Returning an empty map here (the previous
  // behavior) meant the caller's `targetWeights.get(id) ?? h.weight` fallback
  // read the ABSENCE of an entry as "no target, keep current weight", so a
  // class the objective wants at 0% silently never generated a single sell
  // trade — even though the class-level summary correctly showed the 0% target.
  if (budget <= 0) {
    for (const h of holdings) out.set(h.id, 0);
    return out;
  }

  // Confidence-weighted relative weights: tilt away from equal weight in
  // proportion to BOTH how good the score is and how much we trust it.
  const items = holdings.map((h) => {
    const score = h.score?.score ?? 50;
    const conf = (h.score?.confidence ?? 0) / 100;
    const tilt = ((score - 50) / 50) * conf * 0.6;
    return { id: h.id, weight: Math.max(1 + tilt, 1e-4), alloc: 0, capped: false };
  });

  // WATER-FILLING. The old code did a single proportional split then clamped each
  // holding to maxHoldingPct — and threw the clamped-off budget AWAY. So a class
  // whose top name wanted 30% (capped to 20%) silently placed only its capped
  // shares, and ~10pp of the class's intended allocation evaporated on every run,
  // leaving a permanent, unreachable gap in the class-target bar. Here the freed
  // budget is redistributed across the not-yet-capped holdings, repeating until
  // either the whole budget is placed or every holding is at the cap. The unplaced
  // remainder (all holdings capped) is intentionally NOT forced in — the caller
  // routes it to cash so targets still sum to 100.
  let remaining = Math.min(budget, items.length * maxHoldingPct);
  for (let guard = 0; guard <= items.length && remaining > 1e-9; guard++) {
    const active = items.filter((i) => !i.capped);
    const wsum = active.reduce((s, i) => s + i.weight, 0);
    if (wsum <= 0) break;

    let cappedThisRound = false;
    let distributed = 0;
    for (const i of active) {
      const add = (i.weight / wsum) * remaining;
      if (i.alloc + add >= maxHoldingPct - 1e-9) {
        distributed += maxHoldingPct - i.alloc;
        i.alloc = maxHoldingPct;
        i.capped = true;
        cappedThisRound = true;
      } else {
        i.alloc += add;
        distributed += add;
      }
    }
    remaining -= distributed;
    if (!cappedThisRound) break;
  }

  for (const i of items) out.set(i.id, clamp(i.alloc, 0, maxHoldingPct));
  return out;
}

/**
 * Cap any sector or geography group's combined target weight at the constraint,
 * scaling every tradeable holding in an over-cap group down proportionally. The
 * freed budget is not redistributed into other groups — like a per-class cap, it
 * simply isn't placed here, and flows to cash via the residual invariant computed
 * right after this runs. Same "excess doesn't evaporate, it becomes cash"
 * discipline the per-class cap already relies on for maxAssetClassPct.
 */
function capByAttribute(
  holdings: Holding[],
  targetWeights: Map<string, number>,
  attrOf: (h: Holding) => string | null,
  maxPct: number,
  isFrozen: (h: Holding) => boolean,
  isExcluded: (h: Holding) => boolean,
  label: string,
  warnings: string[],
): void {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    if (isFrozen(h) || isExcluded(h) || h.assetClass === "cash") continue;
    const key = attrOf(h);
    if (key == null) continue;
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }

  for (const [key, hs] of groups) {
    const sum = hs.reduce((s, h) => s + (targetWeights.get(h.id) ?? 0), 0);
    if (sum > maxPct + 1e-9) {
      const factor = maxPct / sum;
      for (const h of hs) targetWeights.set(h.id, (targetWeights.get(h.id) ?? 0) * factor);
      warnings.push(
        `${label} "${key}" would be ${sum.toFixed(0)}% of the portfolio, above the ${maxPct}% cap — scaled down to fit; the freed budget routes to cash.`,
      );
    }
  }
}

/**
 * Renormalize a target map to sum to 100. Exported so the Capital Allocation
 * Engine (cash.ts) can measure "distance to the same strategic target" using the
 * exact same objective definitions this file owns — one table, two consumers.
 */
export function normalize(target: Partial<Record<PortfolioAssetClass, number>>): Map<PortfolioAssetClass, number> {
  const entries = Object.entries(target) as [PortfolioAssetClass, number][];
  const sum = entries.reduce((s, [, v]) => s + v, 0);
  const out = new Map<PortfolioAssetClass, number>();
  if (sum <= 0) return out;
  for (const [k, v] of entries) out.set(k, (v / sum) * 100);
  return out;
}

/* -------------------------------------------------------------------------- */

export function optimize(
  evaluation: PortfolioEvaluation,
  objective: Objective,
  constraints: Constraints = DEFAULT_CONSTRAINTS,
  customTarget?: Partial<Record<PortfolioAssetClass, number>>,
  ctx?: MarketContext,
): OptimizationResult {
  const { holdings, totalValue, allocation } = evaluation;
  const warnings: string[] = [];

  const rawTarget = objective === "target_allocation" && customTarget
    ? customTarget
    : OBJECTIVES[objective].target;

  const desired = normalize(rawTarget);

  const heldClasses = new Set(holdings.map((h) => h.assetClass));

  // isIlliquid() — not a local `liquidity === "illiquid"` test. That local test
  // excluded `t2` ("weeks to sell": structured products), so the Risk Lab counted
  // such a holding as illiquid, the Holdings tab gave it an ILLIQUID badge, and
  // this optimizer cheerfully proposed selling it in a same-day rebalance. The
  // shared predicate is documented as the one answer to "is this available for a
  // rebalance", which is precisely the question being asked here.
  const isFrozen = (h: Holding) =>
    isIlliquid(h.liquidity) || constraints.lockedHoldingIds.includes(h.id);
  const isExcluded = (h: Holding) => constraints.excludedSymbols.includes(h.symbol ?? "");

  // Illiquid/locked holdings cannot be traded to a target. Pretending otherwise
  // produces a plan the user physically cannot execute — so we FREEZE them at
  // current weight and allocate the remaining budget around them.
  const frozen = holdings.filter(isFrozen);
  const frozenWeight = frozen.reduce((s, h) => s + h.weight, 0);
  const lockedOnly = frozen.filter((h) => !isIlliquid(h.liquidity));
  if (frozen.length > 0) {
    // Weight AND count, in the Risk Lab's own words. `${frozenWeight.toFixed(0)}%`
    // rendered "0% of the portfolio is illiquid or locked and cannot be
    // rebalanced" for a book with three genuinely untradeable holdings — a
    // sentence that argues against its own existence, and that contradicted the
    // Risk Lab's Illiquid card describing the identical fact. Both now read from
    // computeRisk()'s illiquidPct/illiquidHoldings through describeIlliquidWeight(),
    // so neither can be re-worded without the other.
    const illiquidCount = evaluation.risk.illiquidHoldings;
    const illiquid = describeIlliquidWeight(evaluation.risk.illiquidPct, illiquidCount);
    const parts = [
      illiquidCount > 0 ? illiquid.sentence : null,
      lockedOnly.length > 0
        ? `${illiquidCount > 0 ? "A further " : ""}${lockedOnly.length} ${lockedOnly.length === 1 ? "holding is" : "holdings are"} locked.`
        : null,
    ].filter(Boolean);
    warnings.push(
      `${parts.join(" ")} Those cannot be rebalanced, so the targets below apply to the tradeable ${(100 - frozenWeight).toFixed(1)}%.`,
    );
  }

  const tradeableBudget = Math.max(0, 100 - frozenWeight);

  const frozenByClass = new Map<PortfolioAssetClass, number>();
  for (const h of frozen) {
    frozenByClass.set(h.assetClass, (frozenByClass.get(h.assetClass) ?? 0) + h.weight);
  }

  let desiredSum = 0;
  for (const pct of desired.values()) desiredSum += pct;
  const scaledDesired = new Map<PortfolioAssetClass, number>();
  for (const [cls, pct] of desired) {
    scaledDesired.set(cls, desiredSum > 0 ? (pct / desiredSum) * tradeableBudget : 0);
  }

  /* ---- Per-holding non-cash targets; CASH is the residual plug ------------- *
   *
   * The governing invariant: Σ targetWeights over EVERY holding (incl. cash) is
   * exactly 100. Any budget the rebalancer cannot place — a class the portfolio
   * doesn't hold, a per-class cap, a per-holding cap, an objective that simply
   * wants less than 100% invested — flows to cash. Because the executor conserves
   * total value by writing that same residual as a real cash lot, executing this
   * plan lands the portfolio exactly here, so RE-RUNNING the optimizer proposes
   * nothing: the engine is convergent and idempotent by construction.
   *
   * This replaces the old two-stage code whose class targets could sum to less
   * than 100 (budget for unheld classes was warned about then dropped; capped
   * budget was discarded), so executing its plan was a net sell into the void —
   * the portfolio shrank, weights drifted, and the next run proposed the same
   * sells again, forever. */

  const targetWeights = new Map<string, number>();

  // Frozen and excluded holdings are held at their current weight.
  for (const h of holdings) {
    if (isFrozen(h) || isExcluded(h)) targetWeights.set(h.id, h.weight);
  }

  // Place each non-cash class's tradeable budget across its tradeable holdings.
  for (const cls of heldClasses) {
    if (cls === "cash") continue;
    const tradeableInClass = holdings.filter(
      (h) => h.assetClass === cls && !isFrozen(h) && !isExcluded(h),
    );
    if (tradeableInClass.length === 0) continue;

    const frozenW = frozenByClass.get(cls) ?? 0;
    // 0 when the objective doesn't want this class → its holdings sell to cash.
    const desiredBudget = scaledDesired.get(cls) ?? 0;
    const budgetForTradeable = Math.max(
      0,
      Math.min(desiredBudget - frozenW, constraints.maxAssetClassPct - frozenW),
    );
    const dist = distributeWithinClass(tradeableInClass, budgetForTradeable, constraints.maxHoldingPct);
    for (const [id, w] of dist) targetWeights.set(id, w);
  }

  // Sector/geography caps run AFTER per-class placement, BEFORE the cash residual
  // is computed, so any excess they scale off correctly flows to cash below rather
  // than silently vanishing.
  capByAttribute(holdings, targetWeights, (h) => h.attributes.sector ?? null, constraints.maxSectorPct, isFrozen, isExcluded, "Sector", warnings);
  capByAttribute(holdings, targetWeights, (h) => h.attributes.geography ?? null, constraints.maxCountryPct, isFrozen, isExcluded, "Geography", warnings);

  // Cash target = whatever the non-cash targets left unplaced.
  const nonCashSum = () =>
    holdings.reduce((s, h) => (h.assetClass === "cash" ? s : s + (targetWeights.get(h.id) ?? 0)), 0);

  let cashTarget = 100 - nonCashSum();

  // Enforce the minimum-cash floor by scaling down TRADEABLE non-cash targets
  // (never frozen/excluded ones) to free up the shortfall.
  if (cashTarget < constraints.minCashPct) {
    const toFree = constraints.minCashPct - cashTarget;
    const reducible = holdings.filter(
      (h) => h.assetClass !== "cash" && !isFrozen(h) && !isExcluded(h) && (targetWeights.get(h.id) ?? 0) > 0,
    );
    const redSum = reducible.reduce((s, h) => s + (targetWeights.get(h.id) ?? 0), 0);
    if (redSum > 0) {
      const factor = Math.max(0, (redSum - toFree) / redSum);
      for (const h of reducible) targetWeights.set(h.id, (targetWeights.get(h.id) ?? 0) * factor);
      cashTarget = 100 - nonCashSum();
    }
  }

  // Assign the cash target to the cash holding(s) (proportional to current weight).
  // With no cash holding the target is realized purely by the executor's plug.
  const cashHoldings = holdings.filter((h) => h.assetClass === "cash");
  if (cashHoldings.length > 0) {
    const curCash = cashHoldings.reduce((s, h) => s + h.weight, 0);
    for (const h of cashHoldings) {
      const share = curCash > 0 ? h.weight / curCash : 1 / cashHoldings.length;
      targetWeights.set(h.id, cashTarget * share);
    }
  }

  /* ---- Warnings ----------------------------------------------------------- */

  for (const [cls, pct] of scaledDesired) {
    if (cls === "cash") continue;
    if (pct > 3 && !heldClasses.has(cls)) {
      warnings.push(
        `Target allocation includes ${pct.toFixed(0)}% ${PORTFOLIO_CLASS_LABEL[cls]}, but the portfolio holds none — the rebalancer parks that share in cash. See the Decision Center to actually add ${PORTFOLIO_CLASS_LABEL[cls]}.`,
      );
    }
  }
  const desiredCashScaled = scaledDesired.get("cash") ?? 0;
  if (cashTarget > desiredCashScaled + 5) {
    warnings.push(
      `${(cashTarget - desiredCashScaled).toFixed(0)}% of the portfolio is routed to cash because the objective's other targets can't be fully placed (unheld classes, or the per-holding / per-class caps). Adding holdings in the under-target classes would deploy it.`,
    );
  }

  /* ---- Class-target display (realized weights + cash; sums to 100) --------- */

  const realizedByClass = new Map<PortfolioAssetClass, number>();
  for (const h of holdings) {
    const w = targetWeights.get(h.id) ?? h.weight;
    realizedByClass.set(h.assetClass, (realizedByClass.get(h.assetClass) ?? 0) + w);
  }
  if (cashHoldings.length === 0 && cashTarget > 0.05) {
    realizedByClass.set("cash", (realizedByClass.get("cash") ?? 0) + cashTarget);
  }

  const classTargetList: ClassTarget[] = [...new Set([...realizedByClass.keys(), ...heldClasses])]
    .map((cls) => {
      const current = allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
      const target = realizedByClass.get(cls) ?? 0;
      return {
        assetClass: cls,
        label: PORTFOLIO_CLASS_LABEL[cls],
        currentWeight: Math.round(current * 10) / 10,
        targetWeight: Math.round(target * 10) / 10,
        delta: Math.round((target - current) * 10) / 10,
      };
    })
    .sort((a, b) => b.targetWeight - a.targetWeight);

  /* ---- Build the trade list ---- */

  /**
   * How far this holding's CLASS is from its target — needed because a trade's
   * reason must name the driver that actually applies to it.
   *
   * A plan can legitimately sell one holding and buy another in the SAME class:
   * the class is at its target while the weight inside it is being spread out. But
   * the reason string used to attribute every trade to the class being off-target,
   * so such a plan read "SELL VCLT — above Bonds target" directly above "BUY SHY —
   * below Bonds target". Two opposite claims about one class is exactly the kind of
   * self-contradiction that makes a user distrust the whole plan, and it was a
   * labelling defect, not a trade defect: the trades were right.
   */
  const classDeltaOf = (cls: PortfolioAssetClass): number => {
    const current = allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
    return (realizedByClass.get(cls) ?? 0) - current;
  };

  const targets: TargetWeight[] = holdings.map((h) => {
    const target = targetWeights.get(h.id) ?? h.weight;
    const delta = target - h.weight;
    const frozenH = isFrozen(h);
    // Does the class move the same way this holding does? If so the class target IS
    // the driver; if not, the driver is this holding's own weight within the class.
    const classDelta = classDeltaOf(h.assetClass);
    const classDrivesIt =
      (delta > 0 && classDelta > MATERIAL_WEIGHT_DELTA_PCT) ||
      (delta < 0 && classDelta < -MATERIAL_WEIGHT_DELTA_PCT);
    const label = PORTFOLIO_CLASS_LABEL[h.assetClass];

    return {
      holdingId: h.id,
      symbol: h.symbol,
      name: h.name,
      assetClass: h.assetClass,
      currentWeight: Math.round(h.weight * 10) / 10,
      targetWeight: Math.round(target * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      // NOT rounded. The displayed weights above are rounded because a tenth of a
      // percent is the resolution a human reads them at, but this figure is the
      // EXECUTION INSTRUCTION: the transaction engine divides it by the live price
      // to get units to trade. Rounding it to whole dollars left a full exit
      // short by up to $0.50 — which came back as a phantom position of 0.0005
      // GLD worth $0.18 sitting in the Commodities group forever. Callers that
      // display it already round for presentation via formatCurrency().
      dollarDelta: (delta / 100) * totalValue,
      action: frozenH
        ? "HOLD"
        : delta > MATERIAL_WEIGHT_DELTA_PCT ? "BUY" : delta < -MATERIAL_WEIGHT_DELTA_PCT ? "SELL" : "HOLD",
      reason: frozenH
        ? `${h.liquidity === "illiquid" ? "Illiquid" : "Locked"} — held at current weight.`
        : delta > MATERIAL_WEIGHT_DELTA_PCT
          ? classDrivesIt
            ? `Below ${label} target for the ${OBJECTIVES[objective].label} objective.`
            : `Below its own target weight within ${label} — topped up from the other ${label} holdings.`
          : delta < -MATERIAL_WEIGHT_DELTA_PCT
            ? classDrivesIt
              ? `Above ${label} target for the ${OBJECTIVES[objective].label} objective.`
              : `Above its own target weight within ${label} — trimmed into the other ${label} holdings.`
            : "At target.",
      constrained: frozenH,
    };
  });

  // Cash is the residual plug the executor balances automatically — it is never an
  // actionable row (a "sell cash" IS the other trades; showing it would double-count).
  const trades = targets
    .filter((t) => !t.constrained && t.assetClass !== "cash" && Math.abs(t.delta) > MATERIAL_WEIGHT_DELTA_PCT)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  /* ---- Measure what the plan actually does (value-conserving) ---- */

  const changes: TargetWeightChange[] = trades.map((t) => ({
    holdingId: t.holdingId,
    targetWeight: t.targetWeight,
  }));

  const after = ctx
    ? evaluate(applyTargetPlanConserving(holdings, changes, ctx), ctx)
    : evaluation;
  const impact = estimateImpact(evaluation, after);

  /* ---- Funding: state where the money comes from ---------------------------
   *
   * The trade list is a FILTERED view of a plan whose target changes sum to zero
   * across every holding. Two kinds of row are deliberately absent — the cash
   * residual, and any move under MATERIAL_WEIGHT_DELTA_PCT — so the visible buys
   * and sells generally do NOT tie out. On a real $9.2M book under Maximize
   * Sharpe the sixteen listed trades bought $1.95M and sold $1.71M: a $242k gap
   * that looks exactly like a sizing error and is in fact four sub-1pp trims plus
   * the cash row. Computed and surfaced rather than left for the user to add up
   * and mistrust. */

  const tradeIds = new Set(trades.map((t) => t.holdingId));
  const unlisted = targets.filter((t) => !tradeIds.has(t.holdingId) && t.dollarDelta !== 0);
  const funding: PlanFundingDisclosure = {
    ...computePlanFunding(trades, availableBaseCash(holdings, ctx?.baseCurrency ?? "USD")),
    unlistedTrades: unlisted.filter((t) => t.assetClass !== "cash" && !t.constrained).length,
    unlistedNetCash: unlisted.reduce((s, t) => s + t.dollarDelta, 0),
  };

  if (funding.shortfall > CASH_SETTLEMENT_TOLERANCE) {
    const money = (v: number) => formatCurrency(v, ctx?.baseCurrency ?? "USD");
    warnings.push(
      `These trades buy ${money(funding.buys)} and sell ${money(funding.sells)} — ${money(funding.shortfall)} more than the sell proceeds plus the ${money(funding.cashAvailable)} cash balance can cover. Implementing all of them would leave that much unfunded; deselect some buys, or add cash first.`,
    );
  }

  if (constraints.maxDuration != null && evaluation.risk.duration != null
      && evaluation.risk.duration > constraints.maxDuration) {
    warnings.push(
      `Portfolio duration (${evaluation.risk.duration.toFixed(1)}y) exceeds the ${constraints.maxDuration}y limit. Shorten by shifting to shorter-maturity bonds.`,
    );
  }

  return { objective, classTargets: classTargetList, holdings: targets, trades, impact, funding, warnings };
}

/**
 * Per-trade impact, measured individually — exactly like recommend.ts's
 * candidate-trial loop simulates each candidate, never asserted.
 *
 * Deliberately NOT folded into optimize() itself: that function runs on every
 * portfolio-report load regardless of which tab is open, and N extra
 * simulate() calls (one per trade) would slow every page load down for a
 * number only the Optimize tab's bulk-select buttons ("Select Highest
 * Impact", "Select Health Improvements", "Select Risk Reduction") need. Call
 * this separately, only when that UI actually needs it.
 */
export function computeTradeImpacts(
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
  trades: TargetWeight[],
): Map<string, ImpactEstimate> {
  const out = new Map<string, ImpactEstimate>();
  for (const t of trades) {
    const change: TargetWeightChange = { holdingId: t.holdingId, targetWeight: t.targetWeight };
    const after = evaluate(applyTargetPlanConserving(evaluation.holdings, [change], ctx), ctx);
    out.set(t.holdingId, estimateImpact(evaluation, after));
  }
  return out;
}
