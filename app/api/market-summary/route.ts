import { NextResponse } from "next/server";
import { generateMarketSummary } from "@/lib/market-summary";
import { getLatestSectorRotation } from "@/lib/sector-rotation";
import type { MarketRegime, MacroSignal } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/market-summary
 *
 * Narrates the caller's already-computed Market Regime + macro signals
 * (from a Scanner result) alongside the latest Sector Rotation snapshot
 * into a short AI-generated brief. No new scoring — pure composition.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { regime?: MarketRegime; macroSignals?: MacroSignal[] };
    if (!body?.regime) {
      return NextResponse.json({ error: "Missing regime" }, { status: 400 });
    }
    const sectorRotation = getLatestSectorRotation();
    const summary = await generateMarketSummary(body.regime, body.macroSignals ?? [], sectorRotation);
    return NextResponse.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate market summary";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
