import { NextResponse } from "next/server";
import { getCalendarEvents } from "@/lib/calendar";

export type {
  EventType,
  EventSource,
  ImpactLevel,
  Region,
  CalendarEvent,
  CalendarResponse,
} from "@/lib/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getCalendarEvents());
}
