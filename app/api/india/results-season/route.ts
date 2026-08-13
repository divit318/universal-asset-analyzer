import { NextResponse } from "next/server";
import { getIndiaUniverse } from "@/lib/universe";
import { fetchNseCorporateAnnouncements, getMarketResultsCalendar } from "@/lib/india-news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ResultsSeasonPayload {
  /** Universe names with an NSE-scheduled results board meeting (~1wk horizon). */
  upcoming: { symbol: string; nsSymbol: string; name: string; date: string }[];
  /** Universe names whose results filing appears in NSE's latest market-wide
   *  announcements feed (a rolling window of the most recent filings, NOT a
   *  complete week — labeled accordingly in the UI). */
  reported: { symbol: string; nsSymbol: string; name: string; reportedAt: string }[];
}

/**
 * GET /api/india/results-season — the India screener's earnings-season strip.
 * Two cached market-wide calls total (event calendar 12h TTL, announcements
 * 30min TTL), intersected with the cached 500-name universe. Never fans out
 * per symbol.
 */
export async function GET() {
  const universe = await getIndiaUniverse();
  const byBase = new Map(universe.map((e) => [e.symbol.replace(/\.NS$/, "").toUpperCase(), e]));

  const [calendar, announcements] = await Promise.all([
    getMarketResultsCalendar(),
    fetchNseCorporateAnnouncements(undefined, 60),
  ]);

  const seenUpcoming = new Set<string>();
  const upcoming: ResultsSeasonPayload["upcoming"] = [];
  for (const e of calendar) {
    // NSE occasionally lists the same meeting twice (e.g. amended purposes).
    if (!byBase.has(e.symbol) || seenUpcoming.has(e.symbol)) continue;
    seenUpcoming.add(e.symbol);
    const u = byBase.get(e.symbol)!;
    upcoming.push({ symbol: e.symbol, nsSymbol: u.symbol, name: u.name, date: e.date });
    if (upcoming.length >= 40) break;
  }

  const seen = new Set<string>();
  const reported: ResultsSeasonPayload["reported"] = [];
  for (const a of announcements) {
    const sym = a.symbol?.toUpperCase() ?? "";
    if (!byBase.has(sym) || seen.has(sym)) continue;
    if (a.category !== "results") continue;
    seen.add(sym);
    const u = byBase.get(sym)!;
    reported.push({ symbol: sym, nsSymbol: u.symbol, name: u.name, reportedAt: a.publishedAt });
    if (reported.length >= 20) break;
  }

  return NextResponse.json({ upcoming, reported } satisfies ResultsSeasonPayload);
}
