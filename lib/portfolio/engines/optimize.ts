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

import { evaluate, applyChange, applyChanges, estimateImpact, type PortfolioEvaluation, type PortfolioChange, type ImpactEstimate } from "./simulate";
import type { Holding, MarketContext, PortfolioAssetClass } from "../model/types";
import { PORTFOLIO_CLASS_LABEL } from "../model/types";

export type Objective =
  | "maximize_return"
  | "minimize_volatility"
  | "maximize_sharpe"
  | "maximize_income"
  | "maximize_diversification"
  | "inflation_protection"
  | "preserve_capital"
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
  maxHoldingPct: 20,
  maxAssetClassPct: 70,
  maxSectorPct: 40,
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
  warnings: string[];
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

  const equal = budget / holdings.length;

  const raw = holdings.map((h) => {
    const score = h.score?.score ?? 50;
    const conf = (h.score?.confidence ?? 0) / 100;
    // Tilt away from equal weight in proportion to BOTH how good the score is and
    // how much we trust it.
    const tilt = ((score - 50) / 50) * conf * 0.6;
    return { id: h.id, w: Math.max(equal * (1 + tilt), 0) };
  });

  const total = raw.reduce((s, x) => s + x.w, 0);
  if (total <= 0) {
    for (const h of holdings) out.set(h.id, equal);
    return out;
  }

  for (const { id, w } of raw) {
    out.set(id, clamp((w / total) * budget, 0, maxHoldingPct));
  }
  return out;
}

/** Renormalize a target map to sum to 100. */
function normalize(target: Partial<Record<PortfolioAssetClass, number>>): Map<PortfolioAssetClass, number> {
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

  /* ---- Stage 1: asset-class targets, reconciled with what's actually held ---- */

  const heldClasses = new Set(holdings.map((h) => h.assetClass));

  // Illiquid holdings cannot be traded to a target. Pretending otherwise produces a
  // plan the user physically cannot execute — so we FREEZE them at current weight
  // and allocate the remaining budget around them. This is the difference between a
  // plan and a fantasy.
  const frozen = holdings.filter(
    (h) => h.liquidity === "illiquid" || constraints.lockedHoldingIds.includes(h.id),
  );
  const frozenWeight = frozen.reduce((s, h) => s + h.weight, 0);

  if (frozenWeight > 0) {
    warnings.push(
      `${frozenWeight.toFixed(0)}% of the portfolio is illiquid or locked and cannot be rebalanced. Targets below apply to the tradeable ${(100 - frozenWeight).toFixed(0)}%.`,
    );
  }

  const tradeableBudget = 100 - frozenWeight;

  // Distribute the desired allocation over the tradeable portion, capped by the
  // per-class constraint.
  const classTargets = new Map<PortfolioAssetClass, number>();
  const frozenByClass = new Map<PortfolioAssetClass, number>();
  for (const h of frozen) {
    frozenByClass.set(h.assetClass, (frozenByClass.get(h.assetClass) ?? 0) + h.weight);
  }

  let desiredSum = 0;
  for (const pct of desired.values()) desiredSum += pct;

  for (const [cls, pct] of desired) {
    const scaled = desiredSum > 0 ? (pct / desiredSum) * tradeableBudget : 0;
    const withFrozen = scaled + (frozenByClass.get(cls) ?? 0);
    classTargets.set(cls, Math.min(withFrozen, constraints.maxAssetClassPct));
  }
  // Classes held but not in the target (e.g. a private stake under a growth
  // objective) keep their frozen weight rather than being zeroed out of existence.
  for (const [cls, w] of frozenByClass) {
    if (!classTargets.has(cls)) classTargets.set(cls, w);
  }
  // Every OTHER held class — tradeable, but simply not part of this objective's
  // strategic mix (e.g. Commodities/Forex/Structured Products under "Maximize
  // Return") — must get an explicit 0% entry, not be left absent from the map.
  // Without this, the per-holding loop below never visits that class's holdings
  // at all, so they never receive a target and the trade list silently omits the
  // sell-down the class-level summary is telling the user should happen.
  for (const cls of heldClasses) {
    if (!classTargets.has(cls)) classTargets.set(cls, 0);
  }

  const classTargetList: ClassTarget[] = [...new Set([...classTargets.keys(), ...heldClasses])]
    .map((cls) => {
      const current = allocation.byAssetClass.slices.find((s) => s.key === cls)?.weight ?? 0;
      const target = classTargets.get(cls) ?? 0;
      return {
        assetClass: cls,
        label: PORTFOLIO_CLASS_LABEL[cls],
        currentWeight: Math.round(current * 10) / 10,
        targetWeight: Math.round(target * 10) / 10,
        delta: Math.round((target - current) * 10) / 10,
      };
    })
    .sort((a, b) => b.targetWeight - a.targetWeight);

  /* ---- Stage 2: within-class sizing ---- */

  const targetWeights = new Map<string, number>();

  for (const [cls, budget] of classTargets) {
    const inClass = holdings.filter(
      (h) => h.assetClass === cls && !constraints.excludedSymbols.includes(h.symbol ?? ""),
    );
    const frozenInClass = inClass.filter((h) => frozen.includes(h));
    const tradeableInClass = inClass.filter((h) => !frozen.includes(h));

    for (const h of frozenInClass) targetWeights.set(h.id, h.weight);

    const frozenW = frozenInClass.reduce((s, h) => s + h.weight, 0);
    const remaining = Math.max(budget - frozenW, 0);

    const dist = distributeWithinClass(tradeableInClass, remaining, constraints.maxHoldingPct);
    for (const [id, w] of dist) targetWeights.set(id, w);
  }

  // A class the portfolio is targeted to hold but currently doesn't → surface it as
  // a gap the Decision Center should fill, rather than silently dropping the target.
  for (const [cls, target] of classTargets) {
    if (target > 3 && !heldClasses.has(cls)) {
      warnings.push(
        `Target allocation includes ${target.toFixed(0)}% ${PORTFOLIO_CLASS_LABEL[cls]}, but the portfolio holds none. See the Decision Center for how to add it.`,
      );
    }
  }

  /* ---- Build the trade list ---- */

  const targets: TargetWeight[] = holdings.map((h) => {
    const target = targetWeights.get(h.id) ?? h.weight;
    const delta = target - h.weight;
    const isFrozen = frozen.includes(h);

    return {
      holdingId: h.id,
      symbol: h.symbol,
      name: h.name,
      assetClass: h.assetClass,
      currentWeight: Math.round(h.weight * 10) / 10,
      targetWeight: Math.round(target * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      dollarDelta: Math.round((delta / 100) * totalValue),
      action: isFrozen ? "HOLD" : delta > 0.5 ? "BUY" : delta < -0.5 ? "SELL" : "HOLD",
      reason: isFrozen
        ? `${h.liquidity === "illiquid" ? "Illiquid" : "Locked"} — held at current weight.`
        : delta > 0.5
          ? `Below ${PORTFOLIO_CLASS_LABEL[h.assetClass]} target for the ${OBJECTIVES[objective].label} objective.`
          : delta < -0.5
            ? `Above ${PORTFOLIO_CLASS_LABEL[h.assetClass]} target for the ${OBJECTIVES[objective].label} objective.`
            : "At target.",
      constrained: isFrozen,
    };
  });

  const trades = targets
    .filter((t) => !t.constrained && Math.abs(t.delta) > 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  /* ---- Measure what the plan actually does ---- */

  const changes: PortfolioChange[] = trades.map((t) => ({
    kind: "target",
    holdingId: t.holdingId,
    targetWeight: t.targetWeight,
  }));

  const after = ctx
    ? evaluate(applyChanges(holdings, changes), ctx)
    : evaluation;
  const impact = estimateImpact(evaluation, after);

  if (constraints.maxDuration != null && evaluation.risk.duration != null
      && evaluation.risk.duration > constraints.maxDuration) {
    warnings.push(
      `Portfolio duration (${evaluation.risk.duration.toFixed(1)}y) exceeds the ${constraints.maxDuration}y limit. Shorten by shifting to shorter-maturity bonds.`,
    );
  }

  return { objective, classTargets: classTargetList, holdings: targets, trades, impact, warnings };
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
    const change: PortfolioChange = { kind: "target", holdingId: t.holdingId, targetWeight: t.targetWeight };
    const after = evaluate(applyChange(evaluation.holdings, change), ctx);
    out.set(t.holdingId, estimateImpact(evaluation, after));
  }
  return out;
}
