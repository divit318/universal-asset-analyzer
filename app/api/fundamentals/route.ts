import { NextResponse } from "next/server";
import { buildFundamentalsData } from "@/lib/fundamentals-data";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fundamentals?symbol=AAPL
 *
 * Thin wrapper over `buildFundamentalsData` (lib/fundamentals-data.ts), which
 * is also what the orchestrated research bundle calls directly — so the two
 * paths cannot drift, and the bundle doesn't pay an HTTP hop to reach it.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid `symbol` query parameter is required" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await buildFundamentalsData(symbol));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fundamentals lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
