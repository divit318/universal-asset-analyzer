/**
 * Scanner v2 — fundamental validation gate.
 *
 * Enriches each ScannerOpportunity with:
 *   1. Live Yahoo Finance quote (price, change%, market cap)
 *   2. CompositeScores from screener DB (quality, value, growth, health, momentum)
 *
 * Filters out companies with overall composite < 35 (fundamentally poor quality).
 * This is the step that was always null in v1.
 */

import { getFreshFundamentals } from "../db";
import { computeScores } from "../composite";
import { getQuotes } from "../yahoo";
import type { ScannerOpportunity, CompositeScores } from "../types";

/**
 * One batched quote fetch for every opportunity, instead of a live quote
 * per opportunity (previously an unbounded `Promise.allSettled` fan-out —
 * N simultaneous Yahoo requests for N opportunities). Indian tickers that
 * come back missing get a single second batched attempt with `.NS`
 * appended, preserving the old per-symbol fallback without a second
 * per-symbol round-trip.
 */
async function fetchQuotesWithFallback(
  tickers: string[],
): Promise<Map<string, ScannerOpportunity["quote"]>> {
  const unique = [...new Set(tickers)];
  const bySymbol = new Map<string, ScannerOpportunity["quote"]>();
  for (const q of await getQuotes(unique)) bySymbol.set(q.symbol.toUpperCase(), q);

  const missing = unique.filter((t) => !bySymbol.has(t.toUpperCase()) && !t.includes("."));
  if (missing.length > 0) {
    for (const q of await getQuotes(missing.map((t) => `${t}.NS`))) {
      const original = missing.find((t) => `${t}.NS`.toUpperCase() === q.symbol.toUpperCase());
      if (original) bySymbol.set(original.toUpperCase(), q);
    }
  }
  return bySymbol;
}

/** Minimum overall composite score to allow an opportunity through. */
const MIN_QUALITY_GATE = 35;

/**
 * Enrich opportunities with fundamentals + live quotes,
 * filter out low-quality companies.
 */
export async function applyFundamentalGate(
  opportunities: ScannerOpportunity[],
): Promise<ScannerOpportunity[]> {
  if (opportunities.length === 0) return [];

  // Load screener cache (24h TTL — fundamentals don't change intraday)
  const { rows: dbRows } = getFreshFundamentals(24 * 60 * 60 * 1000);
  const fundamentalsMap = new Map(dbRows.map((r) => [r.symbol, r]));

  // Also build a map with .NS stripped for matching
  const strippedMap = new Map<string, typeof dbRows[0]>();
  for (const row of dbRows) {
    const stripped = row.symbol.replace(/\.(NS|BO)$/, "");
    strippedMap.set(stripped, row);
  }

  // One batched quote fetch for every opportunity, then score synchronously —
  // no network I/O left inside the per-opportunity loop below.
  const quoteBySymbol = await fetchQuotesWithFallback(opportunities.map((o) => o.ticker));

  const enriched = opportunities.map((opp) => {
    // Look up fundamentals — try exact symbol, then stripped symbol
    const fund =
      fundamentalsMap.get(opp.ticker) ??
      strippedMap.get(opp.ticker) ??
      null;

    let compositeScores: CompositeScores | null = null;
    if (fund) {
      // Build a minimal ScorableMetrics object from StockFundamentals
      // (StockFundamentals lacks price/marketCap/scores but has everything else)
      compositeScores = computeScores({
        ...fund,
        price: null,
        marketCap: null,
        fcfYield: null,
        oneYearReturn: null,
        distanceFrom52WkHigh: null,
      });
    }

    const quote = quoteBySymbol.get(opp.ticker.toUpperCase()) ?? null;

    // If we have a quote with momentum data, recompute momentum score
    if (quote && compositeScores && fund) {
      const oneYearReturn =
        quote.fiftyTwoWeekHigh && quote.fiftyTwoWeekLow && quote.price
          ? null // we don't have a 1Y return from quote alone
          : null;
      const distanceFrom52WkHigh =
        quote.fiftyTwoWeekHigh && quote.price
          ? ((quote.price - quote.fiftyTwoWeekHigh) / quote.fiftyTwoWeekHigh) * 100
          : null;

      // Re-score with momentum data from quote
      compositeScores = computeScores({
        ...fund,
        price: quote.price,
        marketCap: quote.marketCap,
        fcfYield: fund.freeCashflow && fund.ebitda
          ? (fund.freeCashflow / (quote.marketCap ?? 1)) * 100
          : null,
        oneYearReturn,
        distanceFrom52WkHigh,
      });
    }

    return {
      ...opp,
      quote,
      compositeScores,
      dividendYieldPct: fund?.dividendYield ?? null,
    };
  });

  const results: ScannerOpportunity[] = [];
  for (const opp of enriched) {
    // Apply quality gate: only pass through if we have no fundamentals data
    // (can't penalize what we can't measure) OR if score meets minimum
    const overallScore = opp.compositeScores?.overall;
    if (overallScore != null && overallScore < MIN_QUALITY_GATE) continue;

    results.push(opp);
  }

  return results;
}
