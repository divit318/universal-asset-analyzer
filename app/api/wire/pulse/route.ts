import { NextResponse } from "next/server";
import { getWirePulse } from "@/lib/wire/pulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/wire/pulse
 *
 * The Wire's Tier-1 payload: live macro signals, sector day performance,
 * breadth, and the deterministic regime read. Quotes only — no news, no LLM
 * — so it answers in about a second and the top of the Wire never waits on
 * the intelligence pipeline. Server-cached for 60s (lib/wire/pulse.ts).
 */
export async function GET() {
  try {
    const pulse = await getWirePulse();
    return NextResponse.json(pulse, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pulse failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
