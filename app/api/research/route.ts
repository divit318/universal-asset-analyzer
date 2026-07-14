import { isValidSymbol, normalizeSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { getQuote } from "@/lib/yahoo";
import { buildResearchBundle } from "@/lib/research-bundle";
import type { ResearchData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research?symbol=AAPL
 *
 * The non-streaming research payload. The Research Hub itself uses
 * `/api/research/bundle` (same plan, streamed section-by-section); this route
 * stays as the plain-JSON entry point for callers that want the whole thing in
 * one response.
 *
 * It no longer has a data-assembly implementation of its own. It used to run a
 * three-stage serial pipeline right here — `await getQuote()`, then a
 * `Promise.all`, then an awaited sector-ETF fetch — which was both slower than
 * necessary and a second, drifting copy of what the bundle does. Both now
 * execute the single orchestrated plan in lib/research-bundle.ts, so they cannot
 * disagree, and this route inherits the plan's concurrency, failure isolation,
 * and cancellation for free.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json(
      { error: "A valid `symbol` query parameter is required (e.g. AAPL)" },
      { status: 400 },
    );
  }

  // The quote gates the asset: no quote, no company, honest 404. It is cached by
  // the platform, so the plan's own quote step below costs nothing extra.
  let quote;
  try {
    quote = await getQuote(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const isEquity = !quote.assetType || quote.assetType === "EQUITY";

  const bundle = await buildResearchBundle(symbol, {
    isEquity,
    signal: request.signal,
  });

  const payload: ResearchData = {
    quote: bundle.quote,
    history: bundle.history,
    filings: bundle.filings,
    edgarError: bundle.edgarError,
    benchmarks: bundle.benchmarks,
    news: bundle.news,
  };
  return NextResponse.json(payload);
}
