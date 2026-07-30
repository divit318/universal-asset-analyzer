/**
 * Performance, built from an ALREADY-BUILT evaluation.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * The Performance tab and the page headline used to be computed by two different
 * routes, each building its own `MarketContext`. `quotes.batch` is cached for 15
 * seconds and not persisted, so the two snapshots were taken at different instants
 * and the totals could not agree: measured live, the Dashboard header read
 * $9,260,734.55 while the Performance panel's own total read $9,262,809.37 — a
 * $2,074.82 gap on numbers that were supposed to describe the same portfolio, and
 * the panel labelled its figure "Total portfolio value" as though it were the
 * headline's equal.
 *
 * Passing prices through was not enough: any second fetch reintroduces the gap the
 * moment the 15-second window rolls. So the composition changed instead. There is
 * now exactly ONE `buildEvaluation()` per request, and this function derives the
 * performance block from it. Two surfaces, one snapshot, one set of prices — the
 * two totals are the same object, not two computations that happen to agree.
 *
 * Server-only (reads the lot ledger).
 */

import { listLots } from "../db";
import { getHistory, getQuote } from "../yahoo";
import {
  portfolioPerformance,
  priceOnOrBefore,
  type FxOnDate,
  type PortfolioPerformance,
  type UnitPricing,
} from "../portfolio-performance";
import type { PortfolioLot } from "../types";
import type { Holding, MarketContext } from "./model/types";

/** Benchmark. (A per-region split — SPY vs ^NSEI — is a future refinement.) */
const BENCH = "SPY";

/**
 * Match `buildMarketContext`'s own benchmark window so both share one cache entry
 * rather than issuing two near-identical history fetches.
 */
const HISTORY_DAYS = 400;

export type PerformanceBlock = PortfolioPerformance | { empty: true };

export function isEmptyPerformance(p: PerformanceBlock): p is { empty: true } {
  return "empty" in p && p.empty === true;
}

/**
 * Historical currency→base rates for every non-base currency in the ledger.
 *
 * Realized P&L, deployed capital and every cash flow are DATED facts, and a fully
 * closed foreign position has no holding left to read even a current rate off — so
 * without this they were converted at 1.0 and francs were reported as dollars.
 *
 * Yahoo quotes `CHFUSD=X` as "USD per 1 CHF", which is exactly the multiplier
 * needed, matching `fetchFx()`'s convention for the live rates in `ctx.fx`. Missing
 * series are non-fatal: the resolver returns null and the engine falls back to the
 * current rate, which is wrong by the drift since the trade but not wrong by a
 * factor of the exchange rate itself.
 */
async function buildHistoricalFx(
  currencies: string[],
  base: string,
  days: number,
): Promise<FxOnDate> {
  const needed = [...new Set(currencies.map((c) => c.toUpperCase()))].filter(
    (c) => c && c !== base.toUpperCase(),
  );
  if (needed.length === 0) return () => null;

  const series = new Map<string, { date: string; close: number }[]>();
  await Promise.all(
    needed.map(async (cur) => {
      try {
        const h = await getHistory(`${cur}${base.toUpperCase()}=X`, days);
        const points = h
          .map((p) => ({ date: p.date.slice(0, 10), close: p.adjClose ?? p.close }))
          .filter((p) => p.close > 0);
        if (points.length > 0) series.set(cur, points);
      } catch {
        // Non-fatal — the engine falls back to the current rate. A portfolio must
        // not fail to load because one FX history was unavailable.
      }
    }),
  );

  // Step-function lookup, the same rule `priceOnOrBefore()` applies to prices: a
  // trade on a weekend or holiday uses the last published rate before it.
  return (currency, date) => {
    const points = series.get(currency.toUpperCase());
    if (!points) return null;
    return priceOnOrBefore(points, date.slice(0, 10));
  };
}

/**
 * Derive performance from an evaluation that has already been built.
 *
 * `holdings` and `asOf` MUST come from the same `buildEvaluation()` call whose
 * `totalValue`/`totalCost` the page renders. That is the entire point: it is what
 * makes `performance.total` identical to the Dashboard's total return rather than
 * merely close to it.
 *
 * `ctx` supplies the CURRENT FX table (`ctx.fx`) as the fallback for any date the
 * historical series cannot cover, and the base currency. Optional so existing
 * callers keep working; without it a foreign position falls back to the rate its
 * live valuation carries, which is what open positions always used.
 */
export async function buildPerformance(
  holdings: Holding[],
  asOf: string,
  portfolioId = 1,
  ctx?: Pick<MarketContext, "fx" | "baseCurrency">,
): Promise<PerformanceBlock> {
  const lots = listLots(undefined, portfolioId);
  if (lots.length === 0) return { empty: true };

  const bySymbol = new Map<string, PortfolioLot[]>();
  for (const l of lots) {
    const list = bySymbol.get(l.symbol);
    if (list) list.push(l);
    else bySymbol.set(l.symbol, [l]);
  }

  /** Ledger-symbol → the holding the page headline is summed from. */
  const holdingBySymbol = new Map<string, Holding>();
  const manualHoldings: Holding[] = [];
  for (const h of holdings) {
    if (h.id.startsWith("lot:")) holdingBySymbol.set(h.id.slice("lot:".length).toUpperCase(), h);
    else manualHoldings.push(h);
  }

  /**
   * A holding's value per unit, in base currency.
   *
   * `valueBase / quantity` rather than the raw quote deliberately: the class
   * adapter has already applied FX and, for a bond, divided the percent-of-par
   * price by 100. Deriving the unit price from the valuation the page total uses is
   * what guarantees the two agree.
   *
   * A STALE valuation is reported as unpriced, not passed through.
   * `marketValuation()` falls back to cost basis when no quote resolved, which
   * through this seam would become "price == average cost" — an unrealized P&L of
   * exactly zero, printed with the same authority as a measured one. The whole book
   * fell back this way once on a cold cache (86% stale) and the only trace was a
   * `stalePct` field nothing prominent rendered.
   */
  const priceFor = (symbol: string): UnitPricing | null => {
    const h = holdingBySymbol.get(symbol.toUpperCase());
    if (!h || h.quantity <= 0) return null;
    if (h.valuation.stale) return null;
    const priceBase = h.valuation.valueBase / h.quantity;
    if (!Number.isFinite(priceBase) || priceBase <= 0) return null;
    return { priceBase, fxRate: h.valuation.fxRate };
  };

  const earliest = lots.reduce((min, l) => (l.tradeDate < min ? l.tradeDate : min), lots[0].tradeDate);
  const daysSinceFirst = Math.ceil((Date.now() - Date.parse(earliest)) / 86_400_000) + 7;
  const window = Math.max(HISTORY_DAYS, daysSinceFirst);

  const base = (ctx?.baseCurrency ?? "USD").toUpperCase();
  /**
   * Currencies to price historically come from the LOTS, not the holdings.
   *
   * A closed position is absent from `holdings` entirely, which is precisely the
   * case this fixes — reading currencies off the holdings would have left the closed
   * foreign position with no series and no rate, exactly as before.
   */
  const ledgerCurrencies = [...new Set(lots.map((l) => (l.currency ?? "").toUpperCase()))].filter(Boolean);

  const [benchHistory, benchQuote, fxOn] = await Promise.all([
    getHistory(BENCH, window).catch(() => []),
    getQuote(BENCH).catch(() => null),
    buildHistoricalFx(ledgerCurrencies, base, window),
  ]);

  // ADJUSTED closes, not raw closes. The benchmark replication values the
  // portfolio's own cash flows in the index; raw `close` discards every dividend
  // SPY paid (~1.3%/yr, compounding), and the error is one-directional — it
  // understates the benchmark and so flatters the user on exactly the question
  // where a flattering answer is most expensive.
  const benchPriceNow = benchQuote?.price ?? benchHistory.at(-1)?.adjClose ?? 0;
  const benchmark =
    benchHistory.length > 0 && benchPriceNow > 0
      ? {
          symbol: BENCH,
          history: benchHistory.map((h) => ({ date: h.date.slice(0, 10), close: h.adjClose ?? h.close })),
          priceNow: benchPriceNow,
        }
      : undefined;

  return portfolioPerformance(bySymbol, priceFor, asOf, benchmark, {
    // Manually-valued assets have a valuation but no dated buy/sell history, so no
    // RATE can be derived from them — but they have a real, signed gain or loss
    // ($1,750 against a $15,250 basis on this book) and it belongs in the total.
    // Omitting it is what made this panel disagree with the Dashboard about
    // whether the portfolio was up or down.
    otherHoldings: manualHoldings.map((h) => ({
      label: h.name,
      valueBase: h.valuation.valueBase,
      costBasisBase: h.costBasisBase,
    })),
    // An unpriced position is carried at whatever the page total carried it at, so
    // the reconciliation balances to the cent.
    fallbackValueFor: (symbol) => holdingBySymbol.get(symbol.toUpperCase())?.valuation.valueBase ?? null,
    // Dated FX for realized P&L, deployed capital and cash flows. `fxNow` is the
    // documented fallback when a date predates the series or the fetch failed —
    // never 1.0 for a currency we know is foreign.
    fxOn,
    fxNow: (currency) => ctx?.fx?.[currency.toUpperCase()] ?? null,
  });
}
