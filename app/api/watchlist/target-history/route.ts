/**
 * GET /api/watchlist/target-history?symbol=AAPL
 *
 * Every recorded revision of one symbol's price target, newest first. Fetched on
 * demand by the expanded row rather than shipped with the list: history is deep,
 * per-symbol, and only ever looked at one name at a time, so putting it on the
 * main payload would multiply the size of every page load for something almost
 * never read. The list payload carries only a count, which is what the row needs
 * to decide whether to offer the affordance at all.
 */
import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import { listTargetRevisions } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ revisions: listTargetRevisions(symbol) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read target history";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
