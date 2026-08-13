/**
 * GET /api/exposure/events?symbol=NVDA — recent stories naming one issuer.
 *
 * Events are ANNOTATIONS here, never nodes. The old knowledge graph promoted
 * headlines to first-class entities alongside companies, and the result was a
 * graph where two generic macro stories out-connected Apple 45-and-40 to 9 on
 * Apple's own page — plus several hundred lines of gates and suppression rules
 * written to contain the damage. A story is something that happened to an
 * entity; it is not a peer of one.
 *
 * So this route exists only to fill a panel beside a selected issuer, it is
 * fetched lazily, and it draws no causal chains: `getCompanyNews` returns
 * stories the provider tagged with this ticker, and the page shows them. There
 * is deliberately no inference from a headline to a price, a driver, or a
 * portfolio impact.
 */

import { NextResponse } from "next/server";
import { getCompanyNews } from "@/lib/news";
import { isValidSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }
  try {
    const items = await getCompanyNews(symbol, 6);
    return NextResponse.json({ symbol, items });
  } catch {
    // No news is a normal state, and a failed feed must never break the panel.
    return NextResponse.json({ symbol, items: [] });
  }
}
