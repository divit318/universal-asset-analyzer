import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import { listWatchlist } from "@/lib/db";
import { enrichForFit } from "@/lib/watchlist-fit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/watchlist/fit
 * Returns full fit-scoring inputs (composite scores, sector, dividend yield,
 * beta, geography) for every watchlist symbol. Fetches + caches fundamentals
 * on demand so newly-added tickers are fully researched.
 */
export async function GET() {
  try {
    const items = listWatchlist()
      .filter((i) => isValidSymbol(i.symbol))
      .map((i) => ({ symbol: i.symbol, name: i.name }));
    const enriched = await enrichForFit(items);
    return NextResponse.json({ items: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to enrich watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
