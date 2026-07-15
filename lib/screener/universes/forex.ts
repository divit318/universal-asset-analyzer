/**
 * The forex universe: the 36 curated pairs in
 * lib/assets/reference/policy-rates.ts.
 *
 * This is a curated list rather than a screener result because Yahoo's
 * CURRENCY quoteType returns **zero rows** from the screener endpoint
 * (verified). Individual pair quotes and history work fine, and the tradeable
 * FX universe is small enough that enumerating it is the correct approach
 * regardless.
 *
 * Price, trend, volatility and drawdown are computed live from Yahoo history.
 * Carry, rate differentials and central-bank stance come from the shipped
 * policy-rate table — read the warning at the top of that file: those are
 * hand-maintained numbers with an as-of date, not market data, and the UI
 * badges them as such.
 */

import { getHistory, getQuotes } from "../../yahoo";
import {
  annualizedVolatility,
  distanceFromHigh,
  drawdown,
  mapPool,
  trailingReturn,
  trendScore,
  withRetry,
} from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import {
  FX_PAIRS,
  inflationDifferential,
  policyDivergence,
  rateDifferential,
  realRateDifferential,
  type PairRef,
} from "../../assets/reference/policy-rates";

const TTL_MS = 60 * 60 * 1000;

async function buildOne(pair: PairRef): Promise<ScreenerCandidate | null> {
  const [quotes, history] = await Promise.all([
    withRetry(() => getQuotes([pair.symbol])),
    withRetry(() => getHistory(pair.symbol, 500)),
  ]);

  const quote = quotes?.[0];
  if (!quote || quote.price == null) return null;

  const volatility = history ? annualizedVolatility(history, 252) : null;
  const carry = rateDifferential(pair);

  return {
    symbol: pair.symbol,
    name: `${pair.base}/${pair.quote}`,
    assetClass: "forex",
    price: quote.price,
    changePercent: quote.changePercent ?? null,
    metrics: {
      liquidityTier: pair.liquidityTier,
      rateDifferential: carry,
      realRateDifferential: realRateDifferential(pair),
      inflationDifferential: inflationDifferential(pair),
      policyDivergence: policyDivergence(pair),
      // Risk-adjusted carry. Guarded against a near-zero volatility, which
      // would otherwise produce an absurd ratio from a rounding artefact.
      carryToVol:
        carry != null && volatility != null && volatility > 0.5 ? carry / volatility : null,
      trendScore: history ? trendScore(history) : null,
      return1m: history ? trailingReturn(history, 21) : null,
      return1y: history ? trailingReturn(history, 252) : null,
      distanceFrom52WkHigh: history ? distanceFromHigh(history) : null,
      volatility,
      maxDrawdown: history ? drawdown(history) : null,
    },
    attributes: {
      pairType: pair.type,
    },
  };
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  report(0, FX_PAIRS.length);
  let done = 0;

  const results = await mapPool(FX_PAIRS, 4, async (pair) => {
    const c = await buildOne(pair).catch(() => null);
    report(++done, FX_PAIRS.length);
    return c;
  });

  return results.filter((c): c is ScreenerCandidate => c != null);
}

export const forexUniverse: UniverseProvider = createUniverseCache({
  assetClass: "forex",
  ttlMs: TTL_MS,
  build,
});
