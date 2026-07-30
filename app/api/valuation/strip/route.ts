import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getValuationCase } from "@/lib/db";
import { summarizeForDisplay, type ValuationSummary } from "@/lib/valuation/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface StripResponse {
  /** Null when this symbol has no case — the strip then invites creating one. */
  summary: ValuationSummary | null;
}

/**
 * GET /api/valuation/strip?symbol=AAPL&price=232.11
 *
 * The Research Hub's read-only view of the case. Deliberately does *not* seed a
 * case and does *not* fetch a quote: the Hub already has the live price and the
 * strip must not add a network round-trip to a page on a two-second budget, nor
 * silently create rows for every symbol a user merely glances at.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  const vcase = getValuationCase(symbol);
  if (!vcase) return NextResponse.json({ summary: null } satisfies StripResponse);

  const priceParam = Number(url.searchParams.get("price"));
  const livePrice = Number.isFinite(priceParam) && priceParam > 0 ? priceParam : null;

  return NextResponse.json({
    summary: summarizeForDisplay(vcase, livePrice),
  } satisfies StripResponse);
}
