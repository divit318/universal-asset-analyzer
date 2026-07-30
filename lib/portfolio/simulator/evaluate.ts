/**
 * Simulator evaluation — a hypothetical holdings list through the REAL engines.
 *
 * There is deliberately no analytics code here: SimHolding[] is converted to
 * the same RawHolding shape the ledger produces, then flows through the exact
 * pipeline the Portfolio page uses (buildMarketContext → normalizeHoldings →
 * evaluate → runAllScenarios). Identical holdings therefore produce identical
 * numbers on both surfaces by construction, not by parallel implementation.
 */

import { buildMarketContext } from "@/lib/portfolio/context";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { runAllScenarios, type ScenarioResult } from "@/lib/portfolio/engines/scenario";
import type { Holding, HoldingUnit, MarketContext, RawHolding } from "@/lib/portfolio/model/types";
import type { PortfolioAllocation } from "@/lib/portfolio/engines/allocation";
import type { HealthScore } from "@/lib/portfolio/engines/health";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { SimHeadline, SimHolding } from "./types";

export interface SimEvaluation {
  holdings: Holding[];
  totalValue: number;
  allocation: PortfolioAllocation;
  risk: UniversalRisk;
  health: HealthScore;
  scenarios: ScenarioResult[];
  annualIncome: number;
  incomeYieldPct: number;
  /** Live-priced % of value — the rest had no quote and fell back to cost. */
  marketPricedPct: number;
  asOf: string;
}

function unitFor(h: SimHolding): HoldingUnit {
  if (h.assetClass === "cash") return "currency";
  if (h.assetClass === "crypto") return "coins";
  return "shares";
}

/** SimHolding[] → the persisted shape the real ledger produces. costBasis is a
 * placeholder here; {@link evaluateSimHoldings} rebases it to live value so a
 * hypothetical book starts with zero unrealized P&L instead of a fictional one. */
export function simHoldingsToRaw(holdings: SimHolding[]): RawHolding[] {
  const now = new Date().toISOString();
  return holdings.map((h, i) => ({
    id: `sim-${i}-${h.symbol ?? "cash"}`,
    assetClass: h.assetClass,
    symbol: h.assetClass === "cash" ? null : h.symbol,
    name: h.name,
    currency: h.currency,
    quantity: h.quantity,
    unit: unitFor(h),
    costBasis: h.assetClass === "cash" ? h.quantity : 0,
    acquiredAt: now,
    manualValue: null,
    manualValueAsOf: null,
    meta: {},
  }));
}

/** Rebase cost to current market value: a hypothetical position is "bought"
 * at today's price by definition. */
function rebaseCostToLive(raws: RawHolding[], ctx: MarketContext): void {
  for (const r of raws) {
    if (r.symbol === null) continue;
    const q = ctx.quotes.get(r.symbol);
    if (q) r.costBasis = q.price * r.quantity;
  }
}

/** Full analytical surface for a hypothetical holdings list — the same
 * evaluate/health/risk/scenario outputs the real Portfolio page renders.
 * Pass a prebuilt `ctx` to reuse one market-context fetch across a pipeline
 * (generation sizes and evaluates against the same snapshot). */
export async function evaluateSimHoldings(
  holdings: SimHolding[],
  baseCurrency: string,
  prebuiltCtx?: MarketContext,
): Promise<SimEvaluation> {
  const raws = simHoldingsToRaw(holdings);
  const ctx = prebuiltCtx ?? (await buildMarketContext(raws, { baseCurrency }));
  rebaseCostToLive(raws, ctx);

  const { holdings: normalized, marketPricedPct } = normalizeHoldings(raws, ctx);
  const evaluation = evaluate(normalized, ctx);
  const scenarios = runAllScenarios(evaluation.holdings, evaluation.totalValue);
  const annualIncome = evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);

  return {
    holdings: evaluation.holdings,
    totalValue: evaluation.totalValue,
    allocation: evaluation.allocation,
    risk: evaluation.risk,
    health: evaluation.health,
    scenarios,
    annualIncome,
    incomeYieldPct: evaluation.totalValue > 0 ? (annualIncome / evaluation.totalValue) * 100 : 0,
    marketPricedPct,
    asOf: ctx.asOf,
  };
}

/** The denormalized list-view numbers persisted on the simulation row. */
export function headlineFrom(evaluation: SimEvaluation): SimHeadline {
  return {
    totalValue: evaluation.totalValue,
    healthScore: evaluation.health.total,
    healthGrade: evaluation.health.grade,
    holdingCount: evaluation.holdings.length,
    assetClassCount: evaluation.allocation.byAssetClass.slices.length,
    annualIncome: evaluation.annualIncome,
    asOf: evaluation.asOf,
  };
}
