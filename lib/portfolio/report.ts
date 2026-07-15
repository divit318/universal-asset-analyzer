/**
 * The Universal Portfolio Report — the single object the Portfolio page renders.
 *
 * This is the composition root: it reads BOTH ledgers (market-priced + manual),
 * builds one MarketContext through the platform layer, normalizes everything into
 * the Universal Holdings Model, and runs the engines. Everything downstream — every
 * tab, every API route, the AI layer — consumes this.
 *
 * Server-only.
 */

import { listRawHoldings } from "./store";
import { buildMarketContext } from "./context";
import { normalizeHoldings } from "./model/holding";
import { evaluate, type PortfolioEvaluation } from "./engines/simulate";
import { computeConcentration, type ConcentrationFinding } from "./engines/allocation";
import { runAllScenarios, type ScenarioResult } from "./engines/scenario";
import { computeRecommendations, getRelevantCandidateSymbols, type Recommendation } from "./engines/recommend";
import { buildDecisionCards, type DecisionCard } from "./engines/decision";
import { optimize, DEFAULT_CONSTRAINTS, type Objective, type OptimizationResult } from "./engines/optimize";
import type { Holding, MarketContext, RawHolding } from "./model/types";
import type { PortfolioAllocation } from "./engines/allocation";
import type { UniversalRisk } from "./engines/risk";
import type { HealthScore } from "./engines/health";

export interface BuiltEvaluation {
  raws: RawHolding[];
  ctx: MarketContext;
  evaluation: PortfolioEvaluation;
  totalCost: number;
  marketPricedPct: number;
  stalePct: number;
}

/**
 * The two-pass context build every portfolio-reading route needs: held
 * holdings only (pass 1), then the specific recommendation candidates this
 * portfolio's gaps actually need (pass 2, often zero symbols). Extracted so
 * the Transaction Engine's preview/execute routes can get the same real
 * `PortfolioEvaluation` + `MarketContext` objects `buildPortfolioReport()`
 * uses internally, instead of re-fetching or re-deriving anything.
 */
export async function buildEvaluation(opts: ReportOptions = {}): Promise<BuiltEvaluation> {
  const raws = listRawHoldings();

  let ctx = await buildMarketContext(raws, { baseCurrency: opts.baseCurrency });
  let { holdings, totalCost, marketPricedPct, stalePct } = normalizeHoldings(raws, ctx);
  let evaluation: PortfolioEvaluation = evaluate(holdings, ctx);

  const neededCandidates = getRelevantCandidateSymbols(evaluation);
  if (neededCandidates.length > 0) {
    ctx = await buildMarketContext(raws, { baseCurrency: opts.baseCurrency, candidateSymbols: neededCandidates });
    ({ holdings, totalCost, marketPricedPct, stalePct } = normalizeHoldings(raws, ctx));
    evaluation = evaluate(holdings, ctx);
  }

  return { raws, ctx, evaluation, totalCost, marketPricedPct, stalePct };
}

export interface UniversalPortfolioReport {
  generatedAt: string;
  baseCurrency: string;

  holdingCount: number;
  totalValue: number;
  totalCost: number;
  totalReturn: number;
  totalReturnDollar: number;
  todayChangeDollar: number;
  todayChangePct: number;

  /** Annual income across ALL sources — dividends, coupons, rent, interest, staking. */
  annualIncome: number;
  incomeYieldPct: number;

  /**
   * Data-quality disclosure. A portfolio that is 60% self-reported marks has a
   * "total value" that is largely the user's own opinion, and every percentage in
   * this report inherits that softness. We state it rather than presenting a
   * manually-marked total with the same authority as a marked-to-market one.
   */
  marketPricedPct: number;
  stalePct: number;

  holdings: Holding[];
  allocation: PortfolioAllocation;
  concentration: ConcentrationFinding[];
  risk: UniversalRisk;
  health: HealthScore;
  scenarios: ScenarioResult[];
  recommendations: Recommendation[];
  /** Same recommendations, ranked and narrated as investment-committee decisions. */
  decisions: DecisionCard[];
  optimization: OptimizationResult;
}

export interface ReportOptions {
  baseCurrency?: string;
  objective?: Objective;
}

/**
 * Today's change, computed only over holdings that actually have a live quote.
 *
 * A house does not move 0.4% today just because the S&P did, and counting its
 * unchanged manual value as "flat" in the denominator would silently dilute the
 * day's percentage move toward zero.
 */
function todayChange(holdings: Holding[], ctx: MarketContext): { dollar: number; pct: number } {
  let dollar = 0;
  let liveValue = 0;

  for (const h of holdings) {
    if (h.valuation.mode !== "market" || !h.symbol) continue;
    const q = ctx.quotes.get(h.symbol.toUpperCase());
    if (!q || q.changePercent == null) continue;
    dollar += h.valuation.valueBase * (q.changePercent / 100);
    liveValue += h.valuation.valueBase;
  }

  return { dollar, pct: liveValue > 0 ? (dollar / liveValue) * 100 : 0 };
}

/** Build the full report. This is the one entry point the API routes call. */
export async function buildPortfolioReport(
  opts: ReportOptions = {},
): Promise<UniversalPortfolioReport> {
  const { ctx, evaluation, totalCost, marketPricedPct, stalePct } = await buildEvaluation(opts);
  const totalValue = evaluation.totalValue;

  const concentration = computeConcentration(evaluation.holdings, evaluation.allocation);
  const scenarios = runAllScenarios(evaluation.holdings, evaluation.totalValue);
  const recommendations = computeRecommendations(evaluation, ctx);
  const decisions = buildDecisionCards(recommendations, evaluation);
  const optimization = optimize(
    evaluation,
    opts.objective ?? "maximize_sharpe",
    DEFAULT_CONSTRAINTS,
    undefined,
    ctx,
  );

  const annualIncome = evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
  const change = todayChange(evaluation.holdings, ctx);

  return {
    generatedAt: ctx.asOf,
    baseCurrency: ctx.baseCurrency,

    holdingCount: evaluation.holdings.length,
    totalValue,
    totalCost,
    totalReturn: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    totalReturnDollar: totalValue - totalCost,
    todayChangeDollar: change.dollar,
    todayChangePct: change.pct,

    annualIncome,
    incomeYieldPct: totalValue > 0 ? (annualIncome / totalValue) * 100 : 0,

    marketPricedPct: Math.round(marketPricedPct),
    stalePct: Math.round(stalePct),

    holdings: evaluation.holdings,
    allocation: evaluation.allocation,
    concentration,
    risk: evaluation.risk,
    health: evaluation.health,
    scenarios,
    recommendations,
    decisions,
    optimization,
  };
}

/** Re-run everything against an in-memory portfolio. Used by what-if simulation. */
export { evaluate } from "./engines/simulate";
