import { NextResponse } from "next/server";
import { getCompanyBrief } from "@/lib/ai-company-brief";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/company-brief?symbol=AAPL
 *
 * The Research Hub's company-orientation layer: sector/industry, a
 * plain-English one-liner, and the structured "About the company" expansion.
 * AI-written when the chain is available, deterministic (profile first
 * sentence) when it isn't — see lib/ai-company-brief.ts.
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
    return NextResponse.json(await getCompanyBrief(symbol));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Company brief lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
