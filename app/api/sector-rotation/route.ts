import { NextResponse } from "next/server";
import { computeSectorRotation, getLatestSectorRotation } from "@/lib/sector-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sector-rotation — latest persisted rotation snapshot (fast, no recompute).
 * GET /api/sector-rotation?refresh=1 — recompute today's snapshot from live sector ETF history.
 */
export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const snapshot = refresh ? await computeSectorRotation() : getLatestSectorRotation();
    if (!snapshot) {
      // No snapshot persisted yet — compute one now so the endpoint is always usable.
      return NextResponse.json({ snapshot: await computeSectorRotation() });
    }
    return NextResponse.json({ snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sector rotation computation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
