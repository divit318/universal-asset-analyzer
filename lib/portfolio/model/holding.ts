/**
 * The Universal Holdings Engine — RawHolding[] → Holding[].
 *
 * This is the funnel every asset in the portfolio passes through, and the reason
 * the engines downstream can be class-agnostic: by the time a holding leaves this
 * file, a house, a Treasury fund, 1.4 BTC and $50k of cash all have a `valueBase`,
 * a `liquidity`, an `income`, a `factors` map and a confidence-scored `score` — the
 * same five fields, in the same units.
 *
 * Note what is NOT here: any knowledge of what a house or a bond IS. That lives in
 * the class adapters. This file only orchestrates and computes weights, which is
 * the one thing that genuinely requires seeing all holdings at once.
 */

import "../classes";  // side-effect: registers all twelve class adapters
import { getClassAdapter } from "./adapter";
import type { Holding, MarketContext, RawHolding } from "./types";

/**
 * Normalize one holding. Pure; all I/O already happened in the MarketContext.
 *
 * Failure isolation: a single bad holding (a malformed details blob, a class whose
 * provider returned garbage) must not take down the whole portfolio. It is valued
 * at cost and flagged, rather than throwing — the same "partial results beat total
 * failure" rule the IC report pipeline follows.
 */
function normalizeOne(raw: RawHolding, ctx: MarketContext): Holding {
  const adapter = getClassAdapter(raw.assetClass);

  const valuation = adapter.value(raw, ctx);
  const income = adapter.income(raw, valuation, ctx);
  const factors = adapter.factors(raw, ctx);
  const metrics = adapter.metrics(raw, ctx);
  const attributes = adapter.attributes(raw, ctx);
  const score = adapter.score(raw, ctx);
  const liquidity = adapter.liquidity?.(raw, ctx) ?? adapter.defaultLiquidity;

  // adapter.costBasis() lets a levered class (real estate) compare valueBase
  // against a basis in the SAME units — net equity against cash invested, not
  // against the gross purchase price. See the interface doc for the bug this fixes.
  const costBasis = adapter.costBasis?.(raw, ctx) ?? raw.costBasis;
  const costBasisBase = costBasis * valuation.fxRate;
  const unrealizedPL = valuation.valueBase - costBasisBase;
  const unrealizedPct = costBasisBase > 0 ? (unrealizedPL / costBasisBase) * 100 : null;

  return {
    id: raw.id,
    assetClass: raw.assetClass,
    symbol: raw.symbol,
    name: raw.name,
    currency: raw.currency,
    quantity: raw.quantity,
    unit: raw.unit,
    costBasis: raw.costBasis,
    costBasisBase,
    acquiredAt: raw.acquiredAt,
    valuation,
    weight: 0,  // assigned below, once the total is known
    unrealizedPL,
    unrealizedPct,
    liquidity,
    income,
    factors,
    metrics,
    attributes,
    score,
    meta: raw.meta,
  };
}

/** A holding that failed to normalize — valued at cost so it still counts. */
function fallbackHolding(raw: RawHolding, ctx: MarketContext, err: unknown): Holding {
  const message = err instanceof Error ? err.message : String(err);
  return {
    id: raw.id,
    assetClass: raw.assetClass,
    symbol: raw.symbol,
    name: raw.name,
    currency: raw.currency,
    quantity: raw.quantity,
    unit: raw.unit,
    costBasis: raw.costBasis,
    costBasisBase: raw.costBasis,
    acquiredAt: raw.acquiredAt,
    valuation: {
      mode: "manual",
      value: raw.costBasis,
      valueBase: raw.costBasis,
      fxRate: 1,
      source: "user",
      asOf: raw.acquiredAt,
      stale: true,
    },
    weight: 0,
    unrealizedPL: null,
    unrealizedPct: null,
    liquidity: "illiquid",
    income: null,
    factors: {},
    metrics: {},
    attributes: { error: message },
    score: null,
    meta: raw.meta,
  };
}

export interface NormalizedPortfolio {
  holdings: Holding[];
  totalValue: number;
  totalCost: number;
  /**
   * Share of portfolio value that is KNOWN rather than estimated — i.e. valued by a
   * live market price or held as cash.
   *
   * This number is the portfolio's epistemic honesty in one figure. A portfolio that
   * is 60% house + private stake has a "total value" that is mostly the user's own
   * opinion, and every downstream percentage inherits that softness. The engines and
   * the UI both surface it rather than presenting a manually-marked total with the
   * same authority as a marked-to-market one.
   *
   * Cash counts as known. Its value is face value — a certainty, not an estimate.
   * Excluding it (as this originally did) would tell a user with a large cash buffer
   * that a quarter of their portfolio "comes from your own valuations", which is
   * exactly backwards: cash is the one thing there is no doubt about.
   */
  marketPricedPct: number;
  /** Share of value whose manual valuation has aged past its class's bound. */
  stalePct: number;
}

export function normalizeHoldings(raws: RawHolding[], ctx: MarketContext): NormalizedPortfolio {
  const holdings = raws.map((raw) => {
    try {
      return normalizeOne(raw, ctx);
    } catch (err) {
      return fallbackHolding(raw, ctx, err);
    }
  });

  const totalValue = holdings.reduce((s, h) => s + h.valuation.valueBase, 0);
  const totalCost = holdings.reduce((s, h) => s + h.costBasisBase, 0);

  for (const h of holdings) {
    h.weight = totalValue > 0 ? (h.valuation.valueBase / totalValue) * 100 : 0;
  }

  const marketValue = holdings
    .filter((h) => (h.valuation.mode === "market" || h.valuation.mode === "cash") && !h.valuation.stale)
    .reduce((s, h) => s + h.valuation.valueBase, 0);
  const staleValue = holdings
    .filter((h) => h.valuation.stale)
    .reduce((s, h) => s + h.valuation.valueBase, 0);

  return {
    holdings,
    totalValue,
    totalCost,
    marketPricedPct: totalValue > 0 ? (marketValue / totalValue) * 100 : 0,
    stalePct: totalValue > 0 ? (staleValue / totalValue) * 100 : 0,
  };
}
