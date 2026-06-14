import { NextResponse } from "next/server";
import { getHistory, getQuote } from "@/lib/yahoo";
import { getRecentFilings } from "@/lib/edgar";
import type { ResearchData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research?symbol=AAPL
 * Combines a Yahoo Finance quote + price history with recent SEC filings.
 * EDGAR failures are non-fatal: the quote still returns with `edgarError` set.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json(
      { error: "A `symbol` query parameter is required" },
      { status: 400 },
    );
  }

  let quote;
  try {
    quote = await getQuote(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const [history, filingsResult] = await Promise.all([
    getHistory(symbol),
    getRecentFilings(symbol).then(
      (filings) => ({ filings, error: null as string | null }),
      (err: unknown) => ({
        filings: [],
        error: err instanceof Error ? err.message : "EDGAR lookup failed",
      }),
    ),
  ]);

  const payload: ResearchData = {
    quote,
    history,
    filings: filingsResult.filings,
    edgarError: filingsResult.error,
  };
  return NextResponse.json(payload);
}
