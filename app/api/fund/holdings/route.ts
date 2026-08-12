import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getFundProfile } from "@/lib/yahoo";
import type { FundHolding } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fund/holdings?symbols=VOO,QQQM
 *
 * Disclosed holdings for several funds at once — the look-through input for the
 * Research Hub's portfolio-overlap analysis, which needs to see the names a user
 * owns *inside* the ETFs they hold, not just the ones they hold directly.
 *
 * Deliberately holdings-only. The obvious implementation was to have the client
 * call /api/fund per held fund, but that route also pulls 730 days of history and
 * runs the full scorer for each symbol — several seconds of work to answer a
 * question that needs one field. This reads the same platform-cached
 * `fundProfile` dataset getFundProfile already owns (so a fund the user has
 * researched recently costs nothing) and returns nothing else.
 *
 * A symbol that fails resolves to an empty list rather than failing the batch:
 * the caller reports funds it couldn't see through as a stated blind spot, and
 * one dead ticker must not erase the overlap analysis for the rest.
 */

/** Bounded so a large portfolio can't fan out into an unbounded provider burst. */
const MAX_SYMBOLS = 8;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";
  const symbols = [
    ...new Set(
      raw
        .split(",")
        .map((s) => normalizeSymbol(s))
        .filter((s): s is string => !!s),
    ),
  ].slice(0, MAX_SYMBOLS);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "A comma-separated `symbols` query parameter is required" }, { status: 400 });
  }

  const results = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const fund = await getFundProfile(symbol);
        return [symbol, fund.holdings] as const;
      } catch {
        return [symbol, [] as FundHolding[]] as const;
      }
    }),
  );

  const holdings: Record<string, FundHolding[]> = {};
  for (const [symbol, list] of results) holdings[symbol] = list;

  return NextResponse.json({ holdings });
}
