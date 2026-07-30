/**
 * Which named lists a symbol belongs to.
 *
 * GET   /api/watchlist/membership?symbol=AAPL          → the ids it appears in
 * PATCH /api/watchlist/membership                      → add to / remove from a list,
 *                                                        or move between two
 *
 * Separate from `/api/watchlist` because membership is a relation, not a property
 * of the symbol's research state: adding AAPL to a second list must not touch its
 * target, thesis or stage, and this route physically cannot.
 */
import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import { addSymbolToGroup, groupsForSymbol, removeSymbolFromGroup } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ symbol, groups: groupsForSymbol(symbol) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "`symbol` must be a valid ticker" }, { status: 400 });
  }

  const addTo = body.addTo != null ? Number(body.addTo) : null;
  const removeFrom = body.removeFrom != null ? Number(body.removeFrom) : null;
  if (addTo == null && removeFrom == null) {
    return NextResponse.json({ error: "Supply `addTo`, `removeFrom`, or both to move" }, { status: 400 });
  }
  if ((addTo != null && !Number.isInteger(addTo)) || (removeFrom != null && !Number.isInteger(removeFrom))) {
    return NextResponse.json({ error: "`addTo` / `removeFrom` must be watchlist ids" }, { status: 400 });
  }
  if (addTo != null && addTo === removeFrom) {
    return NextResponse.json({ error: "`addTo` and `removeFrom` are the same list" }, { status: 400 });
  }

  try {
    // Add before removing, so a move can never transiently leave the symbol in
    // no list at all — which is the one state that would delete its research row.
    if (addTo != null) addSymbolToGroup(symbol, addTo);
    let removedEntirely = false;
    if (removeFrom != null) removedEntirely = removeSymbolFromGroup(symbol, removeFrom).removedEntirely;
    return NextResponse.json({ ok: true, symbol, groups: groupsForSymbol(symbol), removedEntirely });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
