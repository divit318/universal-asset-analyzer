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
import { computeAlignment } from "../alignment/engine";
import { DEFAULT_POLICY } from "../alignment/policy";
import { normalizeHoldings } from "../model/holding";
import type { Holding, MarketContext, RawHolding } from "../model/types";
import type { PortfolioAllocation } from "./allocation";
import type { UniversalRisk } from "./risk";
import type { AlignmentReport } from "../alignment/engine";
import type { InvestorPolicy } from "../alignment/policy";

export interface PortfolioEvaluation {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
  alignment: AlignmentReport;
  /**
   * The policy the alignment was scored against, carried ON the evaluation so
   * every re-evaluation of a hypothetical variant (simulate(), the sizing
   * tranche loops, optimizer previews) scores before and after under the SAME
   * policy. Differencing two evaluations scored under different policies is a
   * category error, and carrying the policy makes it structurally impossible.
   */
  policy: InvestorPolicy;
}

/** Run the full analytics stack over a set of holdings. */
export function evaluate(
  holdings: Holding[],
  ctx: MarketContext,
  policy: InvestorPolicy = DEFAULT_POLICY,
): PortfolioEvaluation {
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
  const alignment = computeAlignment(reweighted, totalValue, allocation, risk, policy);

  return { holdings: reweighted, totalValue, allocation, risk, alignment, policy };
}

/* -------------------------------------------------------------------------- */
/* Changes                                                                     */
/* -------------------------------------------------------------------------- */

export type PortfolioChange =
  /**
   * Buy more of / open a position in an existing or candidate holding.
   *
   * `fundFromCashCurrency` — when set (to the portfolio's base currency), the
   * simulated buy DRAWS its cost from that currency's cash holdings, capped at
   * what exists (never negative), largest-first: the exact behaviour of the
   * executor's cash-balancing draw. Change CREATORS set it when the execution
   * path they feed will actually draw cash (Decision Center buys default to
   * fund-from-cash when cash covers), so the impact numbers on the card are
   * measured on the same book the execution produces. Left unset, the buy is
   * additive new capital — correct for the allocate-cash flow (which deposits
   * first) and the position-size modal (which tracks funding separately; see
   * position-size.ts's header).
   */
  | { kind: "buy"; holding: Holding; amount: number; fundFromCashCurrency?: string }
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

/**
 * Draw `amount` from `currency`-denominated cash holdings, capped at what
 * exists — the simulation twin of the executor's cash-balancing lot (and of
 * planCashDraw's largest-first order). Lots drained below $1 leave the book,
 * same as a fully-sold holding. Never fabricates negative cash.
 */
function drawFromCash(holdings: Holding[], amount: number, currency: string): Holding[] {
  if (amount < 0.5) return holdings; // executor's settlement tolerance — no dust draws
  const cur = currency.toUpperCase();
  const cashIds = holdings
    .filter((h) => h.assetClass === "cash" && h.currency.toUpperCase() === cur && h.valuation.valueBase > 0)
    .sort((a, b) => b.valuation.valueBase - a.valuation.valueBase)
    .map((h) => h.id);

  let remaining = amount;
  const draws = new Map<string, number>();
  for (const id of cashIds) {
    if (remaining <= 0) break;
    const h = holdings.find((x) => x.id === id)!;
    const draw = Math.min(remaining, h.valuation.valueBase);
    draws.set(id, draw);
    remaining -= draw;
  }
  if (draws.size === 0) return holdings;

  const out: Holding[] = [];
  for (const h of holdings) {
    const draw = draws.get(h.id);
    if (draw == null) {
      out.push(h);
      continue;
    }
    const left = h.valuation.valueBase - draw;
    if (left > 1) out.push(resize(h, left));
  }
  return out;
}

/** Apply a change and return the resulting holdings. Pure — never mutates. */
export function applyChange(holdings: Holding[], change: PortfolioChange): Holding[] {
  switch (change.kind) {
    case "buy": {
      const existing = holdings.find((h) => h.id === change.holding.id);
      const bought = existing
        ? holdings.map((h) =>
            h.id === change.holding.id
              ? resize(h, h.valuation.valueBase + change.amount)
              : h,
          )
        // New position, sized at the proposed amount.
        : [...holdings, resize(change.holding, change.amount)];
      return change.fundFromCashCurrency
        ? drawFromCash(bought, change.amount, change.fundFromCashCurrency)
        : bought;
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

/**
 * One theme's before → after under a simulated change — the TRADEOFF substrate.
 *
 * An aggregate delta can hide a conflict: a trade that improves Downside +9 while
 * pushing Structure −2 nets +7ish and looks universally good. Decisions must be
 * able to say "improves X at the cost of Y" instead, so the per-theme movement is
 * measured here, once, from the same two evaluations the aggregate came from.
 * Only themes rated on BOTH sides appear — a theme that gains or loses a rating
 * mid-trade has no honest delta.
 */
export interface ThemeDelta {
  id: string;
  label: string;
  /** Unrounded, for arithmetic. */
  before: number;
  after: number;
  delta: number;
  /** The share of the alignment score this theme carries under the policy. */
  weightShare: number;
}

export interface ImpactEstimate {
  /**
   * Change in the portfolio-alignment score, in points, under the SAME investor
   * policy on both sides. Null when either side is unscorable — a delta between
   * a score and a non-score is not zero, it is unknown, and consumers that need
   * a scalar must decide their own fallback explicitly (`?? 0`).
   */
  alignmentDelta: number | null;
  /** Per-theme movement behind `alignmentDelta`, largest |delta| first. */
  themeDeltas: ThemeDelta[];
  /** Change in annualized volatility, in percentage points. Negative = less risky. */
  riskDelta: number | null;
  /**
   * Change in ASSET-CLASS HHI (`allocation.byAssetClass.hhi`). Negative = better
   * diversified.
   *
   * PAIR THIS ONLY WITH AN ASSET-CLASS HHI BASELINE. It is a delta on one
   * specific denominator, and this app computes an HHI on several: adding it to
   * `UniversalRisk.positionHhi` (an HHI over individual holdings) produces a
   * number that belongs to no denominator at all — which is exactly what the
   * Decision Center rendered until it was caught (688 + −160 = 528, versus a true
   * post-trade position HHI of 664 and asset-class HHI of 3271).
   */
  diversificationDelta: number;
  /** Change in expected annual income, in base currency. */
  incomeDelta: number;
  /** Change in inflation sensitivity. */
  inflationDelta: number | null;
  /** Change in illiquid share, in percentage points. */
  liquidityDelta: number;
}

/** Per-theme deltas for themes rated on BOTH sides. See ThemeDelta. */
function themeDeltasOf(before: PortfolioEvaluation, after: PortfolioEvaluation): ThemeDelta[] {
  const afterById = new Map(after.alignment.themes.map((t) => [t.id, t]));
  const out: ThemeDelta[] = [];
  for (const b of before.alignment.themes) {
    const a = afterById.get(b.id);
    if (b.scoreExact == null || a?.scoreExact == null) continue;
    out.push({
      id: b.id,
      label: b.label,
      before: b.scoreExact,
      after: a.scoreExact,
      delta: a.scoreExact - b.scoreExact,
      weightShare: b.weightShare,
    });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
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
    // Unrounded on both sides: differencing the DISPLAYED integers made every
    // realistic single-position change measure as exactly 0, which in turn made
    // the sizing loop fall back entirely on its secondary asset-class signal.
    alignmentDelta:
      after.alignment.scoreExact != null && before.alignment.scoreExact != null
        ? after.alignment.scoreExact - before.alignment.scoreExact
        : null,
    themeDeltas: themeDeltasOf(before, after),
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
  const after = evaluate(applyChanges(before.holdings, changes), ctx, before.policy);
  return { after, impact: estimateImpact(before, after) };
}
