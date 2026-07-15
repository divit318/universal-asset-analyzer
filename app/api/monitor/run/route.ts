import { NextResponse } from "next/server";
import { runMonitor } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST/GET /api/monitor/run — evaluate every watchlist and portfolio alert
 * against live quotes and persist any that fired (24h-deduped).
 *
 * The header bell polls this while the app is open; the same endpoint can be
 * hit by cron/launchd to deliver alerts even when no tab is — the app being a
 * local server means "background monitoring" is just a scheduled curl. The
 * server itself now also runs this on a timer (instrumentation.ts).
 */
async function run() {
  return NextResponse.json(await runMonitor());
}

export async function POST() {
  return run();
}

export async function GET() {
  return run();
}
