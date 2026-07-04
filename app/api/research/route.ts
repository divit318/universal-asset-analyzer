import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { getHistory, getQuote, getQuoteSummary, getSectorEtf } from "@/lib/yahoo";
import { getRecentFilings } from "@/lib/edgar";
import { getCompanyNews } from "@/lib/news";
import type { ResearchData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research?symbol=AAPL
 * Combines a Yahoo Finance quote + price history with recent SEC filings.
 * EDGAR failures are non-fatal: the quote still returns with `edgarError` set.
 */

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json(
      { error: "A valid `symbol` query parameter is required (e.g. AAPL)" },
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

  // Fetch 5 years of history, SPY benchmark, sector profile, filings, and news in parallel.
  const [history, spyHistory, profileResult, filingsResult, news] = await Promise.all([
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
    getCompanyNews(symbol, 8).catch(() => []),
  ]);

  // Resolve sector ETF then fetch its history (best-effort).
  const sector = (profileResult as Record<string, unknown> | null)?.assetProfile != null
    ? ((profileResult as Record<string, Record<string, unknown>>).assetProfile?.sector as string | null) ?? null
    : null;
  const sectorEtf = getSectorEtf(sector);
  const timeout = <T>(ms: number, fallback: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms));
  const sectorHistory = sectorEtf
    ? await Promise.race([
        getHistory(sectorEtf, 1825).catch(() => [] as typeof spyHistory),
        timeout(5000, [] as typeof spyHistory),
      ])
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
    news,
  };
  return NextResponse.json(payload);
}
