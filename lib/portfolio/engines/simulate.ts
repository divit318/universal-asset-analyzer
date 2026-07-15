/**
 * Portfolio simulation — the substrate for every "expected impact" number in the app.
 *
 * The requirement is that each recommendation states its "expected portfolio score
 * improvement, estimated risk reduction, estimated diversification improvement".
 *
 * There are two ways to produce those numbers. The easy way is to assert them from
 * a heuristic ("adding bonds reduces risk, call it -8%"). The honest way is to
 * BUILD the resulting portfolio and re-run the actual engines on it, then report
 * the difference.
 *
 * We do the second. Every impact figure in the Decision Center is a real delta
 * between two full portfolio evaluations, which means it cannot drift away from
 * what the analytics tabs would show if the user actually made the trade — the
 * recommendation and the analytics are computed by the same code.
 */

import { computeAllocation } from "./allocation";
import { computeRisk } from "./risk";
import { computeHealth } from "./health";
import { normalizeHoldings } from "../model/holding";
import type { Holding, MarketContext, RawHolding } from "../model/types";
import type { PortfolioAllocation } from "./allocation";
import type { UniversalRisk } from "./risk";
import type { HealthScore } from "./health";

export interface PortfolioEvaluation {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
  health: HealthScore;
}

/** Run the full analytics stack over a set of holdings. */
export function evaluate(holdings: Holding[], ctx: MarketContext): PortfolioEvaluation {
  const totalValue = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);

  // Weights must be recomputed for the hypothetical portfolio — a simulated buy
  // changes the denominator for every other holding, and forgetting that is the
  // classic way a "what-if" quietly reports the wrong before/after.
  const reweighted = holdings.map((h) => ({
    ...h,
    weight: totalValue > 0 ? (h.valuation.valueBase / totalValue) * 100 : 0,
  }));

  const allocation = computeAllocation(reweighted, totalValue);
  const risk = computeRisk(reweighted, totalValue, allocation, ctx);
  const health = computeHealth(reweighted, totalValue, allocation, risk);

  return { holdings: reweighted, totalValue, allocation, risk, health };
}

/* -------------------------------------------------------------------------- */
/* Changes                                                                     */
/* -------------------------------------------------------------------------- */

export type PortfolioChange =
  /** Buy more of / open a position in an existing or candidate holding. */
  | { kind: "buy"; holding: Holding; amount: number }
  /** Sell down an existing holding by a dollar amount. */
  | { kind: "sell"; holdingId: string; amount: number }
  /** Set an existing holding to a target weight. */
  | { kind: "target"; holdingId: string; targetWeight: number };

/** Scale a holding to a new base-currency value, keeping everything else intact. */
function resize(h: Holding, newValueBase: number): Holding {
  const ratio = h.valuation.valueBase > 0 ? newValueBase / h.valuation.valueBase : 0;
  return {
    ...h,
    quantity: h.quantity * ratio,
    costBasis: h.costBasis * ratio,
    costBasisBase: h.costBasisBase * ratio,
    valuation: {
      ...h.valuation,
      value: h.valuation.value * ratio,
      valueBase: newValueBase,
    },
    unrealizedPL: h.unrealizedPL != null ? h.unrealizedPL * ratio : null,
  };
}

/** Apply a change and return the resulting holdings. Pure — never mutates. */
export function applyChange(holdings: Holding[], change: PortfolioChange): Holding[] {
  switch (change.kind) {
    case "buy": {
      const existing = holdings.find((h) => h.id === change.holding.id);
      if (existing) {
        return holdings.map((h) =>
          h.id === change.holding.id
            ? resize(h, h.valuation.valueBase + change.amount)
            : h,
        );
      }
      // New position, sized at the proposed amount.
      return [...holdings, resize(change.holding, change.amount)];
    }

    case "sell": {
      const out: Holding[] = [];
      for (const h of holdings) {
        if (h.id !== change.holdingId) {
          out.push(h);
          continue;
        }
        const remaining = h.valuation.valueBase - change.amount;
        // A fully-sold holding leaves the portfolio rather than lingering at zero
        // value, where it would still be counted in `holdings.length` and quietly
        // inflate every diversification count.
        if (remaining > 1) out.push(resize(h, remaining));
      }
      return out;
    }

    case "target": {
      const total = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
      const target = (change.targetWeight / 100) * total;
      return holdings.map((h) => (h.id === change.holdingId ? resize(h, target) : h));
    }
  }
}

export function applyChanges(holdings: Holding[], changes: PortfolioChange[]): Holding[] {
  return changes.reduce(applyChange, holdings);
}

/* -------------------------------------------------------------------------- */
/* Value-conserving rebalance                                                  */
/* -------------------------------------------------------------------------- */

export interface TargetWeightChange {
  holdingId: string;
  /** The weight (0-100) this holding should move to. */
  targetWeight: number;
}

/** A synthetic base-currency cash holding, valued by the real cash adapter. */
function makeCashHolding(valueBase: number, ctx: MarketContext): Holding {
  const raw: RawHolding = {
    id: `cash:${ctx.baseCurrency.toUpperCase()}`,
    assetClass: "cash",
    symbol: null,
    name: `${ctx.baseCurrency.toUpperCase()} Cash`,
    currency: ctx.baseCurrency.toUpperCase(),
    quantity: valueBase,
    unit: "currency",
    costBasis: valueBase,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    meta: { synthetic: true },
  };
  return normalizeHoldings([raw], ctx).holdings[0];
}

/** Set a cash holding to an absolute base value (resize() can't grow one from 0). */
function setCashValue(h: Holding, newValueBase: number): Holding {
  const v = Math.max(0, newValueBase);
  return {
    ...h,
    quantity: v,
    costBasis: v,
    costBasisBase: v,
    valuation: { ...h.valuation, value: v, valueBase: v },
    unrealizedPL: 0,
    unrealizedPct: 0,
  };
}

/**
 * Apply target-weight changes with TOTAL PORTFOLIO VALUE CONSERVED.
 *
 * This is the simulation twin of how executeTrades() actually rebalances: the
 * portfolio's total base value is held FIXED, each targeted holding is set to
 * `targetWeight%` of that fixed total, and whatever the targets don't account for
 * is parked in (base-currency) cash — the same residual-to-cash plug the executor
 * writes as a real lot.
 *
 * Why this matters: the old `applyChange("target")` path let total value drift on
 * every simulated rebalance (a lone "sell" shrank the pie, a lone "buy" grew it
 * from nowhere), so a rebalance PREVIEW never matched what execution did, and
 * re-running the optimizer on the drifted result produced fresh phantom trades
 * forever. Conserving value here makes the preview honest and makes the optimizer
 * converge: re-run it on this output and it proposes nothing.
 */
export function applyTargetPlanConserving(
  holdings: Holding[],
  changes: TargetWeightChange[],
  ctx: MarketContext,
): Holding[] {
  const total = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
  if (total <= 0) return holdings;

  const byId = new Map(changes.map((c) => [c.holdingId, c.targetWeight]));
  const resized = holdings.map((h) =>
    byId.has(h.id) ? resize(h, (byId.get(h.id)! / 100) * total) : h,
  );

  const placed = resized.reduce((s, h) => s + h.valuation.valueBase, 0);
  const drift = total - placed;
  if (Math.abs(drift) < 1e-6) return resized;

  const base = ctx.baseCurrency.toUpperCase();
  const cashIdx = resized.findIndex(
    (h) => h.assetClass === "cash" && h.currency.toUpperCase() === base,
  );

  if (cashIdx >= 0) {
    const next = [...resized];
    next[cashIdx] = setCashValue(next[cashIdx], next[cashIdx].valuation.valueBase + drift);
    return next;
  }

  // No base-currency cash holding to absorb the residual. A positive drift (net
  // sell) opens one; a negative drift (net buy the portfolio can't fund from
  // non-existent cash) is left unfunded rather than fabricating negative cash.
  if (drift > 0) return [...resized, makeCashHolding(drift, ctx)];
  return resized;
}

/* -------------------------------------------------------------------------- */
/* Impact                                                                      */
/* -------------------------------------------------------------------------- */

export interface ImpactEstimate {
  /** Change in the universal health score, in points. */
  healthDelta: number;
  /** Change in annualized volatility, in percentage points. Negative = less risky. */
  riskDelta: number | null;
  /** Change in asset-class HHI. Negative = better diversified. */
  diversificationDelta: number;
  /** Change in expected annual income, in base currency. */
  incomeDelta: number;
  /** Change in inflation sensitivity. */
  inflationDelta: number | null;
  /** Change in illiquid share, in percentage points. */
  liquidityDelta: number;
}

/**
 * The difference two portfolios make, measured — not asserted.
 */
export function estimateImpact(
  before: PortfolioEvaluation,
  after: PortfolioEvaluation,
): ImpactEstimate {
  const incomeOf = (e: PortfolioEvaluation) =>
    e.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);

  const volBefore = before.risk.annualizedVolatility;
  const volAfter = after.risk.annualizedVolatility;

  const inflBefore = before.risk.inflationSensitivity;
  const inflAfter = after.risk.inflationSensitivity;

  return {
    healthDelta: after.health.total - before.health.total,
    riskDelta:
      volBefore != null && volAfter != null
        ? Math.round((volAfter - volBefore) * 10) / 10
        : null,
    diversificationDelta: after.allocation.byAssetClass.hhi - before.allocation.byAssetClass.hhi,
    incomeDelta: Math.round(incomeOf(after) - incomeOf(before)),
    inflationDelta:
      inflBefore != null && inflAfter != null
        ? Math.round((inflAfter - inflBefore) * 100) / 100
        : null,
    liquidityDelta: Math.round((after.risk.illiquidPct - before.risk.illiquidPct) * 10) / 10,
  };
}

/** Convenience: apply changes, evaluate, and measure the impact in one call. */
export function simulate(
  before: PortfolioEvaluation,
  changes: PortfolioChange[],
  ctx: MarketContext,
): { after: PortfolioEvaluation; impact: ImpactEstimate } {
  const after = evaluate(applyChanges(before.holdings, changes), ctx);
  return { after, impact: estimateImpact(before, after) };
}
