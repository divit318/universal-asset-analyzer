import { NextResponse } from "next/server";
import { listLots } from "@/lib/db";
import { getHistory, getQuote, getQuotes } from "@/lib/yahoo";
import { portfolioPerformance, type PortfolioPerformance } from "@/lib/portfolio-performance";
import type { PortfolioLot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/performance
 *
 * Money-weighted (XIRR) portfolio performance from the lot ledger, plus a
 * true benchmark-relative comparison (the same cash flows invested in the
 * benchmark index). This is the "are you actually beating the market?" answer
 * the old cost-vs-value number could never give.
 */
export async function GET() {
  const lots = listLots();
  if (lots.length === 0) {
    return NextResponse.json({ empty: true } satisfies { empty: true });
  }

  // Group lots by symbol.
  const bySymbol = new Map<string, PortfolioLot[]>();
  for (const l of lots) {
    const list = bySymbol.get(l.symbol);
    if (list) list.push(l);
    else bySymbol.set(l.symbol, [l]);
  }

  const symbols = [...bySymbol.keys()];
  const asOf = new Date().toISOString();

  // Benchmark: S&P 500 via SPY. (A per-region benchmark split — SPY vs ^NSEI —
  // is a future refinement; today's holdings are US.)
  const BENCH = "SPY";
  const earliest = lots.reduce((min, l) => (l.tradeDate < min ? l.tradeDate : min), lots[0].tradeDate);
  const daysSinceFirst = Math.ceil((Date.now() - Date.parse(earliest)) / 86_400_000) + 7;

  const [quotes, benchHistory, benchQuote] = await Promise.all([
    getQuotes(symbols),
    getHistory(BENCH, Math.max(30, daysSinceFirst)),
    getQuote(BENCH).catch(() => null),
  ]);

  const priceBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.price]));
  const priceFor = (s: string) => priceBySymbol.get(s.toUpperCase()) ?? null;

  const benchPriceNow = benchQuote?.price ?? benchHistory.at(-1)?.close ?? 0;
  const benchmark =
    benchHistory.length > 0 && benchPriceNow > 0
      ? {
          symbol: BENCH,
          history: benchHistory.map((h) => ({ date: h.date.slice(0, 10), close: h.close })),
          priceNow: benchPriceNow,
        }
      : undefined;

  const performance: PortfolioPerformance = portfolioPerformance(bySymbol, priceFor, asOf, benchmark);
  return NextResponse.json(performance);
}
