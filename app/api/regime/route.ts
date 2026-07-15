/**
 * GET /api/regime — the market regime, and nothing else.
 *
 * Replaces the research page's old habit of fetching /api/dashboard (a full
 * portfolio report + calendar + watchlist alert sweep) to read one enum. Reads
 * the Scanner's last snapshot when it's fresh, and falls back to a live
 * macro/sector computation when it isn't. Never triggers a Scanner run.
 */
import { NextResponse } from "next/server";
import { getMarketRegime } from "@/lib/mission-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const regime = await getMarketRegime();
    return NextResponse.json({ regime });
  } catch (err) {
    console.error("[api/regime]", err);
    return NextResponse.json({ regime: null });
  }
}
