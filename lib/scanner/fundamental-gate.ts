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
import { getQuote } from "../yahoo";
import type { ScannerOpportunity, CompositeScores } from "../types";

async function safeGetQuote(ticker: string): Promise<ScannerOpportunity["quote"]> {
  try {
    return await getQuote(ticker);
  } catch {
    // Try with .NS suffix for Indian stocks without suffix
    if (!ticker.includes(".")) {
      try { return await getQuote(`${ticker}.NS`); } catch { /* ignored */ }
    }
    return null;
  }
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

  // Enrich in parallel (quotes) + compute scores synchronously
  const enriched = await Promise.allSettled(
    opportunities.map(async (opp) => {
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

      // Fetch live quote
      const quote = await safeGetQuote(opp.ticker);

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
    }),
  );

  const results: ScannerOpportunity[] = [];
  for (const r of enriched) {
    if (r.status !== "fulfilled") continue;
    const opp = r.value;

    // Apply quality gate: only pass through if we have no fundamentals data
    // (can't penalize what we can't measure) OR if score meets minimum
    const overallScore = opp.compositeScores?.overall;
    if (overallScore != null && overallScore < MIN_QUALITY_GATE) continue;

    results.push(opp);
  }

  return results;
}
