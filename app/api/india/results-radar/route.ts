import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/db";
import { categorizeIndianDevelopment, getIndianFilings, getMarketResultsCalendar } from "@/lib/india-news";
import { getResultsDaySnapshot, type ResultsDaySnapshot } from "@/lib/india-results";
import { readIndiaOwnership, ownershipTrends } from "@/lib/india-ownership";
import { isOwnershipCurrent, ownershipContextLine } from "@/lib/india-ownership-trends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ResultsRadarPayload {
  /** NSE-scheduled results board meetings for watchlist symbols (~1wk horizon). */
  upcoming: {
    symbol: string; nsSymbol: string; name: string; date: string;
    /** Deterministic ownership context ("FII selling for 3 consecutive quarters")
     *  with its disclosure quarter; null when history is missing/stale. */
    ownershipNote: string | null;
    ownershipAsOf: string | null;
  }[];
  /** Results filings published in the last 7 days for watchlist symbols,
   *  with the deterministic results-day snapshot (lib/india-results.ts). */
  recent: (ResultsDaySnapshot & {
    nsSymbol: string; name: string; url: string;
    ownershipNote: string | null;
    ownershipAsOf: string | null;
  })[];
}

/** Cache-only ownership context — never fetches; null unless the latest
 *  disclosure is recent enough to accompany a current event. */
function ownershipContext(symbol: string): { ownershipNote: string | null; ownershipAsOf: string | null } {
  const own = readIndiaOwnership(symbol);
  if (!own || !isOwnershipCurrent(own.period)) return { ownershipNote: null, ownershipAsOf: null };
  const note = ownershipContextLine(ownershipTrends(own));
  return { ownershipNote: note, ownershipAsOf: note ? own.period : null };
}

/**
 * GET /api/india/results-radar — results-season view of the user's OWN
 * watchlist. Upcoming dates come from ONE market-wide NSE calendar call
 * (never per-symbol fan-out); recent filings reuse the per-symbol
 * announcements cache the news system already maintains (30-min TTL).
 */
export async function GET() {
  const indian = listWatchlist().filter((w) => /\.(NS|BO)$/i.test(w.symbol));
  if (indian.length === 0) {
    return NextResponse.json({ upcoming: [], recent: [] } satisfies ResultsRadarPayload);
  }

  const byBase = new Map(indian.map((w) => [w.symbol.replace(/\.(NS|BO)$/i, "").toUpperCase(), w]));

  const calendar = await getMarketResultsCalendar();
  const upcoming = calendar
    .filter((e) => byBase.has(e.symbol))
    .map((e) => {
      const w = byBase.get(e.symbol)!;
      return { symbol: e.symbol, nsSymbol: w.symbol, name: w.name || e.company, date: e.date, ...ownershipContext(e.symbol) };
    });

  const cutoff = Date.now() - 7 * 24 * 3_600_000;
  const recent: ResultsRadarPayload["recent"] = [];
  // Bounded sequential loop over the user's Indian names (cached per symbol).
  for (const w of indian.slice(0, 25)) {
    const filings = await getIndianFilings(w.symbol, 15).catch(() => []);
    const filing = filings.find(
      (f) =>
        categorizeIndianDevelopment(`${f.form} ${f.description}`) === "results" &&
        Date.parse(f.filedAt) > cutoff,
    );
    if (filing) {
      const snapshot = await getResultsDaySnapshot(w.symbol, filing.filedAt);
      recent.push({
        ...snapshot,
        nsSymbol: w.symbol,
        name: w.name,
        url: filing.documentUrl,
        ...ownershipContext(snapshot.symbol),
      });
    }
  }
  recent.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));

  return NextResponse.json({ upcoming, recent } satisfies ResultsRadarPayload);
}
