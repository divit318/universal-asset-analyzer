import { NextResponse } from "next/server";
import { recordIntelFeedback } from "@/lib/intel/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["shown", "dismissed", "opened"]);

/**
 * POST /api/intel/event — the suppression write path.
 *
 * `shown` (fired after a card has actually been on screen for a beat) stops
 * the immediate replay when the user bounces between tabs; `dismissed` and
 * `opened` silence the fingerprint for longer. See lib/db.ts intel_event.
 */
export async function POST(request: Request) {
  let body: { id?: unknown; status?: unknown; symbol?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim().slice(0, 200) : "";
  const status = typeof body.status === "string" ? body.status : "";
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase().slice(0, 12) : null;

  if (!id || !STATUSES.has(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }

  try {
    recordIntelFeedback(id, status as "shown" | "dismissed" | "opened", symbol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record event";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
