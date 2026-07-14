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
import type { Holding, MarketContext } from "../model/types";
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
