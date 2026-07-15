import { NextResponse } from "next/server";
import { clearChartDrawings } from "@/lib/db";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chart-drawings/clear — body { symbol, timeframe } deletes every
 * drawing for that scope. Backs the toolbar's "Clear All Drawings" action,
 * which the client confirms before calling this.
 */
export async function POST(request: Request) {
  let body: { symbol?: string; timeframe?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const symbol = normalizeSymbol(body.symbol);
  const timeframe = body.timeframe?.trim();
  if (!symbol || !timeframe) {
    return NextResponse.json({ error: "A valid `symbol` and `timeframe` are required" }, { status: 400 });
  }
  try {
    clearChartDrawings(symbol, timeframe);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
