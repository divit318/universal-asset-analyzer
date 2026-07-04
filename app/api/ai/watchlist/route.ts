import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/db";
import { generateWatchlistDigest, type WatchlistPortfolioContext } from "@/lib/ai-watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/watchlist
 * Generates an AI digest across all saved watchlist symbols.
 * Fetches live quotes + quick fundamentals, then asks the AI to rank/summarise.
 * Accepts optional `portfolioContext` in the body to personalize the digest.
 */
export async function POST(request: Request) {
  let portfolioContext: WatchlistPortfolioContext | undefined;
  try {
    const body = await request.json() as { portfolioContext?: WatchlistPortfolioContext };
    portfolioContext = body.portfolioContext;
  } catch {
    // Body is optional — empty body or no JSON is fine
  }

  const items = listWatchlist();
  try {
    const digest = await generateWatchlistDigest(items, portfolioContext);
    return NextResponse.json(digest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Digest failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
