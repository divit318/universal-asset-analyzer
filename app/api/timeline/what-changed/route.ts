import { NextResponse } from "next/server";
import { computeWhatChanged } from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;

/**
 * GET /api/timeline/what-changed?symbol=AAPL&eventId=<id>
 * "What Changed Since Then?" — subsequent developments, validated/failed
 * assumptions, management execution, and stock response since a past event.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase();
  const eventId = params.get("eventId")?.trim();

  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (!eventId) {
    return NextResponse.json({ error: "An `eventId` query parameter is required" }, { status: 400 });
  }

  try {
    const result = await computeWhatChanged(symbol, eventId);
    if (!result) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "What-changed generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
