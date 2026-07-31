/**
 * The commodity universe: the curated front-month contracts in
 * lib/assets/reference/commodities.ts (27 of them — the investable set is
 * genuinely this small), plus the real futures curve for each.
 *
 * The curve is the interesting part. Yahoo quotes dated contracts under a
 * predictable symbology — ROOT + MONTH_CODE + YY + "." + EXCHANGE, so crude for
 * August 2026 is CLQ26.NYM — which was verified live: CLQ26 at 71.41 through
 * CLF27 at 70.34 is a clean, downward-sloping curve, i.e. backwardation. So we
 * fetch the next several expiries per contract, fit the slope against time to
 * expiry, and get a genuine contango/backwardation reading instead of asserting
 * one.
 */

import { getHistory, getQuotes } from "../../yahoo";
import {
  annualizedVolatility,
  distanceFromHigh,
  mapPool,
  seasonality,
  trailingReturn,
  trendScore,
  withRetry,
} from "../metrics-util";
import { createUniverseCache, type UniverseProvider } from "../universe-cache";
import type { ScreenerCandidate } from "../types";
import { COMMODITIES, FUTURES_MONTH_CODES, type CommodityRef } from "../../assets/reference/commodities";

const TTL_MS = 60 * 60 * 1000;
/** How many forward expiries to sample when measuring the curve. */
const CURVE_POINTS = 6;

/**
 * Build the next `count` dated contract symbols for a root, starting from next
 * month. Not every root trades every month (crude does; corn only trades
 * Mar/May/Jul/Sep/Dec), so we over-fetch and simply drop the symbols Yahoo has
 * no quote for — which is exactly the months that contract doesn't list.
 */
export function datedContracts(ref: CommodityRef, count: number, from = new Date()): string[] {
  const out: string[] = [];
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();

  for (let i = 1; i <= count + 6 && out.length < count + 6; i++) {
    const d = new Date(Date.UTC(year, month + i, 1));
    const code = FUTURES_MONTH_CODES[d.getUTCMonth()];
    const yy = String(d.getUTCFullYear()).slice(-2);
    out.push(`${ref.root}${code}${yy}.${ref.exchange}`);
  }
  return out;
}

export interface CurvePoint {
  symbol: string;
  price: number;
  /** Months from now until this contract expires. */
  monthsOut: number;
}

/**
 * Annualised slope of the futures curve, %.
 *
 * Positive = contango (deferred contracts cost more; a long position loses on
 * every roll). Negative = backwardation (the roll pays you). Computed from the
 * nearest and furthest contracts we got quotes for, annualised by the gap
 * between them so a 6-month curve and a 12-month curve are comparable.
 */
export function curveSlope(points: CurvePoint[]): number | null {
  const valid = points.filter((p) => p.price > 0).sort((a, b) => a.monthsOut - b.monthsOut);
  if (valid.length < 2) return null;

  const front = valid[0];
  const back = valid[valid.length - 1];
  const monthsApart = back.monthsOut - front.monthsOut;
  if (monthsApart <= 0 || front.price <= 0) return null;

  const totalChange = back.price / front.price - 1;
  return (totalChange / monthsApart) * 12 * 100;
}

async function buildOne(ref: CommodityRef): Promise<ScreenerCandidate | null> {
  const [quotes, history] = await Promise.all([
    withRetry(() => getQuotes([ref.symbol])),
    withRetry(() => getHistory(ref.symbol, 1825)), // 5 years, for seasonality
  ]);

  const quote = quotes?.[0];
  if (!quote || quote.price == null) return null;

  // The curve: quote the next several dated contracts and keep whatever exists.
  const symbols = datedContracts(ref, CURVE_POINTS);
  const dated = (await withRetry(() => getQuotes(symbols))) ?? [];
  const bySymbol = new Map(dated.map((d) => [d.symbol.toUpperCase(), d]));

  const points: CurvePoint[] = symbols
    .map((sym, i) => {
      const d = bySymbol.get(sym.toUpperCase());
      if (!d || d.price == null || d.price <= 0) return null;
      return { symbol: sym, price: d.price, monthsOut: i + 1 };
    })
    .filter((p): p is CurvePoint => p != null);

  const slope = curveSlope(points);
  const season = history ? seasonality(history, new Date().getUTCMonth()) : { avgReturn: null, score: null };

  return {
    symbol: ref.symbol,
    name: ref.name,
    assetClass: "commodity",
    price: quote.price,
    changePercent: quote.changePercent ?? null,
    metrics: {
      price: quote.price,
      return1m: history ? trailingReturn(history, 21) : null,
      return1y: history ? trailingReturn(history, 252) : null,
      trendScore: history ? trendScore(history) : null,
      distanceFrom52WkHigh: history ? distanceFromHigh(history) : null,
      curveSlope: slope,
      rollYield: slope != null ? -slope : null,
      seasonalityScore: season.score,
      seasonalAvgReturn: season.avgReturn,
      volatility: history ? annualizedVolatility(history, 252) : null,

      /*
       * Return per unit of volatility over the trailing year. Commodities differ
       * in volatility by an order of magnitude — natural gas against gold — so
       * ranking them on raw return ranks them on how violent they are. This is
       * the comparison that survives that difference.
       */
      returnPerVol: (() => {
        const r = history ? trailingReturn(history, 252) : null;
        const v = history ? annualizedVolatility(history, 252) : null;
        return r != null && v != null && v > 0 ? r / v : null;
      })(),
      /*
       * Roll yield as a share of total volatility: how much of the carry you are
       * being paid is meaningful against the noise you have to sit through. A 2%
       * roll yield on a 15% vol contract is a real edge; the same 2% on 60% vol
       * is a rounding error.
       */
      carryQuality: (() => {
        const v = history ? annualizedVolatility(history, 252) : null;
        return slope != null && v != null && v > 0 ? -slope / v : null;
      })(),
    },
    attributes: {
      sector: ref.sector,
      geopoliticalExposure: ref.geopolitical,
    },
  };
}

async function build(report: (ready: number, total: number) => void): Promise<ScreenerCandidate[]> {
  report(0, COMMODITIES.length);
  let done = 0;

  const results = await mapPool(COMMODITIES, 3, async (ref) => {
    const c = await buildOne(ref).catch(() => null);
    report(++done, COMMODITIES.length);
    return c;
  });

  return results.filter((c): c is ScreenerCandidate => c != null);
}

export const commodityUniverse: UniverseProvider = createUniverseCache({
  assetClass: "commodity",
  ttlMs: TTL_MS,
  build,
});
