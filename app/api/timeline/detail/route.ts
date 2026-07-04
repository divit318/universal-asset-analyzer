import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { findTimelineEvent, explainTimelineEvent } from "@/lib/timeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * GET /api/timeline/detail?symbol=AAPL&eventId=<id>
 * Rich, AI-generated detail panel for one timeline event — executive
 * summary, background, root cause, bull/bear case, current relevance, etc.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase();
  const eventId = params.get("eventId")?.trim();

  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (!eventId) {
    return NextResponse.json({ error: "An `eventId` query parameter is required" }, { status: 400 });
  }

  const found = findTimelineEvent(symbol, eventId);
  if (!found) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  try {
    const detail = await explainTimelineEvent(found.event, found.allEvents);
    return NextResponse.json({ detail });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Detail generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
