import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import {
  addToWatchlist,
  getFreshFundamentals,
  listWatchlist,
  removeFromWatchlist,
  updateWatchlistItem,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/watchlist — list saved symbols, enriched with cached sector data. */
export async function GET() {
  try {
    // Sector/yield rarely change — tolerate week-old cache rows so the fit
    // scorer gets real inputs instead of scoring every symbol identically.
    const { rows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000);
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    const items = listWatchlist().map((item) => {
      const f = bySymbol.get(item.symbol);
      return {
        ...item,
        sector: f?.sector ?? null,
        dividendYield: f?.dividendYield ?? null,
      };
    });
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/watchlist — body { symbol, name } adds/updates an entry. */
export async function POST(request: Request) {
  let body: { symbol?: string; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "`symbol` must be a valid ticker (e.g. AAPL)" }, { status: 400 });
  }

  try {
    const item = addToWatchlist(symbol, body.name?.trim() || symbol.toUpperCase());
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add to watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/watchlist — body { symbol, targetPrice?, alertPctDrop?, notes? } updates alert config. */
export async function PATCH(request: Request) {
  let body: { symbol?: string; targetPrice?: number | null; alertPctDrop?: number | null; notes?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const symbol = body.symbol?.trim();
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });
  try {
    updateWatchlistItem(symbol, {
      targetPrice: "targetPrice" in body ? body.targetPrice : undefined,
      alertPctDrop: "alertPctDrop" in body ? body.alertPctDrop : undefined,
      notes: "notes" in body ? body.notes : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** DELETE /api/watchlist?symbol=AAPL — remove an entry. */
export async function DELETE(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });
  }

  try {
    removeFromWatchlist(symbol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove from watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
