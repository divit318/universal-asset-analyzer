import { NextResponse } from "next/server";
import { getPeerComparison } from "@/lib/peers";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/peers?symbol=AAPL
 * Median of the symbol's S&P 500 sector peers (P/E, ROE, rev growth, D/E)
 * for the peer-comparison radar. Slower (fans out across the sector), cached.
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
    return NextResponse.json(await getPeerComparison(symbol));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Peer comparison failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
