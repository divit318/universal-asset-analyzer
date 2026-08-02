import { NextResponse } from "next/server";
import type { CalendarEvent } from "../route";
import { generateCalendarBrief, MAX_CALENDAR_EVENTS } from "@/lib/ai-calendar-brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { events?: CalendarEvent[]; weekStart?: string; weekEnd?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const events = (body.events ?? []).slice(0, MAX_CALENDAR_EVENTS);
  const weekStart = body.weekStart ?? new Date().toISOString().slice(0, 10);
  const weekEnd = body.weekEnd ?? new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  try {
    const brief = await generateCalendarBrief(events, weekStart, weekEnd);
    return NextResponse.json({ brief });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI brief generation failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
