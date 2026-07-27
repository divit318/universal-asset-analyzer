import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { gatherWatchlistAlerts } from "@/lib/ai-watchlist";
import type { WatchlistItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * GET /api/watchlist/symbol-alerts?symbol=AAPL
 *
 * Watchlist Intelligence, scoped to a single symbol — reuses
 * gatherWatchlistAlerts() (lib/ai-watchlist.ts), the same canonical
 * orchestration already used by /api/dashboard, /api/ai/watchlist,
 * /api/portfolio/audit, and /api/portfolio/new-positions. The symbol
 * doesn't need to already be saved to the watchlist — this lets Research
 * surface the same deterministic alerts (new opportunity / deteriorating /
 * breakout / sector leadership / valuation) for whatever the user is
 * currently looking at.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  const item: WatchlistItem = {
    symbol,
    name: symbol,
    addedAt: new Date().toISOString(),
    targetPrice: null,
    alertPctDrop: null,
    notes: null,
    stage: "surfaced",
    stageChangedAt: null,
  };

  const alerts = await gatherWatchlistAlerts(undefined, { items: [item] });
  return NextResponse.json({ alerts });
}
