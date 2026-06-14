import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/yahoo";
import { applyFilters, parseCriteria } from "@/lib/screener";
import { constituentsForSector } from "@/lib/sp500";
import type { ScreenerRow } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/screener
 * Body: screener criteria. Fetches live quotes for the (optionally
 * sector-narrowed) S&P 500 universe and returns the rows that match.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const criteria = parseCriteria(body);

  // Narrow the universe by sector before fetching to cut down on API calls.
  const universe = constituentsForSector(criteria.sector);
  const bySymbol = new Map(universe.map((c) => [c.symbol, c]));

  let rows: ScreenerRow[];
  try {
    const quotes = await getQuotes(universe.map((c) => c.symbol));
    rows = quotes.map((q) => {
      const meta = bySymbol.get(q.symbol);
      return {
        symbol: q.symbol,
        name: meta?.name ?? q.name,
        sector: meta?.sector ?? "—",
        price: q.price,
        changePercent: q.changePercent,
        marketCap: q.marketCap,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Screener fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const matches = applyFilters(rows, criteria).sort(
    (a, b) => b.changePercent - a.changePercent,
  );

  return NextResponse.json({
    count: matches.length,
    scanned: rows.length,
    rows: matches,
  });
}
