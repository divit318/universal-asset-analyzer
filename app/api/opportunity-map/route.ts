import { NextResponse } from "next/server";
import { getOpportunityMapData } from "@/lib/opportunity-map";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/opportunity-map
 * Reshapes the last cached Scanner auto-scan into map nodes + theme
 * clusters. Never triggers a live pipeline run — Scanner already owns that
 * (heavy, multi-minute) workflow; this route is read-only composition.
 */
export async function GET() {
  try {
    const data = getOpportunityMapData();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build opportunity map";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
