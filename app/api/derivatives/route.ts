import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getOptionsChain } from "@/lib/yahoo";
import { computeDerivativesSummary, type DerivativesSummary } from "@/lib/derivatives-analysis";
import { derivativesSectionInsight, type DerivativesInsightSection } from "@/lib/ai-derivatives-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/derivatives?symbol=AAPL
 * Options chain summary (IV, term structure, put/call OI ratio, top-OI
 * strikes, ATM Greeks) for an equity/fund underlying. Returns `{ summary:
 * null }` — not an error — when the symbol has no listed options (illiquid
 * name, non-US listing): that's a legitimate, common outcome, not a failure.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  try {
    const chain = await getOptionsChain(symbol);
    if (!chain) return NextResponse.json({ summary: null });
    return NextResponse.json({ summary: computeDerivativesSummary(chain) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Options chain lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface DerivativesInsightRequest {
  section: DerivativesInsightSection;
  underlyingName: string;
  summary: DerivativesSummary;
  /** Listing currency of the underlying — strikes/premiums are struck in it. */
  currency?: string;
}

/**
 * POST /api/derivatives — mode=insight only today, mirrors the other asset-
 * class insight routes. No news/second data source needed — the chain data
 * itself is what's being interpreted.
 */
export async function POST(request: Request) {
  let body: DerivativesInsightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.summary || !body.section) {
    return NextResponse.json({ error: "summary and section are required" }, { status: 400 });
  }

  try {
    const result = await derivativesSectionInsight({
      section: body.section,
      underlyingName: body.underlyingName ?? body.summary.underlyingSymbol,
      summary: body.summary,
      currency: typeof body.currency === "string" ? body.currency : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI derivatives insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
