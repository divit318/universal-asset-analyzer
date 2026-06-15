import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/db";
import { generateWatchlistDigest } from "@/lib/ai-watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/watchlist
 * Generates an AI digest across all saved watchlist symbols.
 * Fetches live quotes + quick fundamentals, then asks the AI to rank/summarise.
 */
export async function POST() {
  const items = listWatchlist();
  try {
    const digest = await generateWatchlistDigest(items);
    return NextResponse.json(digest);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Digest failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
