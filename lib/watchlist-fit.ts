/**
 * Watchlist fit enrichment — produces the *full* research inputs the IOS fit
 * scorer needs for every watchlist symbol, so scores are accurate and
 * differentiated instead of collapsing to a data-poor neutral.
 *
 * For each symbol we assemble the same StockMetrics the screener builds
 * (cached fundamentals + live price layer), run composite scoring, and attach
 * sector / dividend yield / beta / geography. Newly-added tickers that were
 * never screened (e.g. foreign ADRs like SHG, EQNR, PBR) are fetched on demand
 * and cached, so a stock is fully researched the moment it enters the list.
 */

import { computeScores } from "./composite";
import { getFreshFundamentals, putFundamentals } from "./db";
import { enrichSymbol } from "./enrich";
import { detectMarket } from "./market";
import { getQuotes, getRichQuotes } from "./yahoo";
import type { CompositeScores, StockFundamentals } from "./types";

/** Everything the client needs to pass into `getPortfolioFit`. */
export interface FitEnrichment {
  symbol: string;
  sector: string | null;
  marketCap: number | null;
  compositeScores: CompositeScores;
  dividendYield: number | null; // %
  beta: number | null;
  geography: "US" | "IN" | "JP" | "HK" | "AU" | "EU" | "CRYPTO" | null;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // fundamentals change slowly
const CONCURRENCY = 6;

async function mapPool<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/**
 * Enrich a set of watchlist symbols with full fit inputs. Uses the shared
 * fundamentals cache; only genuinely-missing symbols hit the network, and
 * whatever is fetched is persisted so subsequent loads are instant.
 */
export async function enrichForFit(
  items: Array<{ symbol: string; name: string }>,
): Promise<FitEnrichment[]> {
  if (items.length === 0) return [];

  const symbols = items.map((i) => i.symbol.toUpperCase());

  // 1. Hydrate from cache.
  const { rows } = getFreshFundamentals(CACHE_TTL_MS);
  const fundamentals = new Map<string, StockFundamentals>(
    rows.filter((r) => symbols.includes(r.symbol)).map((r) => [r.symbol, r]),
  );

  // 2. Fetch fundamentals for anything not cached, then persist in one batch.
  const missing = items.filter((i) => !fundamentals.has(i.symbol.toUpperCase()));
  const fetched: StockFundamentals[] = [];
  await mapPool(missing, async (item) => {
    try {
      const data = await enrichSymbol(item.symbol.toUpperCase(), item.name);
      fundamentals.set(data.symbol, data);
      fetched.push(data);
    } catch {
      /* leave uncached; handled as a graceful gap below */
    }
  });
  if (fetched.length) {
    try { putFundamentals(fetched); } catch { /* cache write is best-effort */ }
  }

  // 3. Live price + identity layer (batched). Rich quotes carry momentum
  //    inputs; plain quotes carry currency/exchange for geography detection.
  const [rich, quotes] = await Promise.all([
    getRichQuotes(symbols).catch(() => []),
    getQuotes(symbols).catch(() => []),
  ]);
  const richBy = new Map(rich.map((q) => [q.symbol.toUpperCase(), q]));
  const quoteBy = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

  // 4. Assemble metrics + score.
  return items.map((item) => {
    const sym = item.symbol.toUpperCase();
    const f = fundamentals.get(sym);
    const rq = richBy.get(sym);
    const q = quoteBy.get(sym);
    const marketCap = rq?.marketCap ?? q?.marketCap ?? null;

    const geography = q
      ? detectMarket({ symbol: sym, currency: q.currency, exchange: q.exchange, assetType: q.assetType })
      : null;

    if (!f) {
      // Fundamentals genuinely unavailable — return a minimal record. Sector may
      // still be known from the quote; scores are empty and the fit scorer will
      // reflect that honestly rather than inventing a number.
      return {
        symbol: sym,
        sector: null,
        marketCap,
        compositeScores: { value: null, growth: null, quality: null, financialHealth: null, momentum: null, overall: null },
        dividendYield: null,
        beta: null,
        geography,
      } satisfies FitEnrichment;
    }

    const rawFcfYield =
      f.freeCashflow != null && marketCap && marketCap !== 0
        ? (f.freeCashflow / marketCap) * 100
        : null;
    const fcfYield = rawFcfYield != null && Math.abs(rawFcfYield) <= 40 ? rawFcfYield : null;

    const base = {
      symbol: f.symbol,
      name: f.name,
      sector: f.sector,
      industry: f.industry,
      price: rq?.price ?? q?.price ?? null,
      marketCap,
      forwardPE: f.forwardPE,
      evToEbitda: f.evToEbitda,
      fcfYield,
      revenueGrowthYoY: f.revenueGrowthYoY,
      revenueCagr3y: f.revenueCagr3y,
      epsGrowthYoY: f.epsGrowthYoY,
      epsCagr3y: f.epsCagr3y,
      roic: f.roic,
      roe: f.roe,
      grossMargin: f.grossMargin,
      operatingMargin: f.operatingMargin,
      debtToEquity: f.debtToEquity,
      netDebtToEbitda: f.netDebtToEbitda,
      currentRatio: f.currentRatio,
      fcfMargin: f.fcfMargin,
      fcfGrowthYoY: f.fcfGrowthYoY,
      dividendYield: f.dividendYield,
      buybackYield: f.buybackYield,
      oneYearReturn: rq?.oneYearReturn ?? null,
      distanceFrom52WkHigh: rq?.distanceFrom52WkHigh ?? null,
      institutionalOwnership: f.institutionalOwnership,
      earningsSurprisePct: f.earningsSurprisePct,
    };

    return {
      symbol: sym,
      sector: f.sector,
      marketCap,
      compositeScores: computeScores(base),
      dividendYield: f.dividendYield,
      beta: f.beta,
      geography,
    } satisfies FitEnrichment;
  });
}
