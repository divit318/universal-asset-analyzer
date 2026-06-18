import { NextResponse } from "next/server";
import { getHistory, getQuote, getQuoteSummary, getSectorEtf } from "@/lib/yahoo";
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

  // Fetch 5 years of history, SPY benchmark, sector profile, and filings in parallel.
  const [history, spyHistory, profileResult, filingsResult] = await Promise.all([
    getHistory(symbol, 1825),
    getHistory("SPY", 1825),
    getQuoteSummary(symbol, ["assetProfile"]).catch(() => null),
    getRecentFilings(symbol).then(
      (filings) => ({ filings, error: null as string | null }),
      (err: unknown) => ({
        filings: [],
        error: err instanceof Error ? err.message : "EDGAR lookup failed",
      }),
    ),
  ]);

  // Resolve sector ETF then fetch its history (best-effort).
  const sector = (profileResult as Record<string, unknown> | null)?.assetProfile != null
    ? ((profileResult as Record<string, Record<string, unknown>>).assetProfile?.sector as string | null) ?? null
    : null;
  const sectorEtf = getSectorEtf(sector);
  const sectorHistory = sectorEtf
    ? await getHistory(sectorEtf, 1825).catch(() => [] as typeof spyHistory)
    : [];

  const payload: ResearchData = {
    quote,
    history,
    filings: filingsResult.filings,
    edgarError: filingsResult.error,
    benchmarks: {
      spy: spyHistory,
      sectorEtf,
      sector: sectorHistory,
    },
  };
  return NextResponse.json(payload);
}
