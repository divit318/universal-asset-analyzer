/**
 * POST /api/watchlist/pass — the deliberate "no" on a tracked idea.
 *
 *   { symbol, reason, note?, priceAt? }  → pass: stage becomes `passed` and a
 *       CLOSED journal entry records the reason (lib/db.ts `passIdea`). The
 *       reason is required — an unexplained pass is exactly the unaccountable
 *       state the old pipeline's unused "Passed" column produced.
 *   { symbol, reactivate: true }         → reopen a passed/exited idea; the
 *       derived workflow takes over from the evidence again.
 *
 * Deliberately NOT part of PATCH /api/watchlist: passing is a decision with a
 * journal side effect, not a field edit.
 */
import { NextResponse } from "next/server";
import { passIdea, reactivateIdea } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REASON = 120;
const MAX_NOTE = 280;

export async function POST(request: Request) {
  let body: { symbol?: unknown; reason?: unknown; note?: unknown; priceAt?: unknown; reactivate?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });

  try {
    if (body.reactivate === true) {
      const { changed } = reactivateIdea(symbol);
      return NextResponse.json({ ok: true, symbol, reactivated: changed });
    }

    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";
    if (!reason) return NextResponse.json({ error: "`reason` is required — a pass without one is unaccountable" }, { status: 400 });
    const note = typeof body.note === "string" ? body.note.trim().slice(0, MAX_NOTE) || null : null;
    const priceAt = typeof body.priceAt === "number" && Number.isFinite(body.priceAt) && body.priceAt > 0 ? body.priceAt : null;

    const { changed } = passIdea(symbol, { reason, note, priceAt });
    if (!changed && !note) {
      // Not tracked, or already passed — both are honest no-ops for the caller.
      return NextResponse.json({ ok: true, symbol, changed: false });
    }
    return NextResponse.json({ ok: true, symbol, changed: true });
  } catch (err) {
    console.error("[api/watchlist/pass]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
