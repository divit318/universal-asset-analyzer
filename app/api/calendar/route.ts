import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/db";
import { listPositions } from "@/lib/db";
import { getQuoteSummary } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CalendarEvent {
  symbol: string;
  name: string;
  type: "earnings" | "exDividend" | "dividend";
  date: string;        // ISO date YYYY-MM-DD
  dateEnd?: string;    // for earnings windows
  isEstimate?: boolean;
  source: "watchlist" | "portfolio";
}

/** Unwrap Yahoo { raw } or Date → ISO string. */
function toIso(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); }
  if (typeof v === "object" && "raw" in (v as object)) {
    const raw = (v as { raw?: number }).raw;
    if (raw != null) return new Date(raw * 1000).toISOString().slice(0, 10);
  }
  if (typeof v === "number") return new Date(v * 1000).toISOString().slice(0, 10);
  return null;
}

/**
 * GET /api/calendar
 * Returns upcoming earnings + dividend dates for all watchlist + portfolio symbols.
 * Events are sorted ascending by date and limited to 90 days in the future.
 */
export async function GET() {
  const watchlist = listWatchlist();
  const portfolio = listPositions();

  // Deduplicate symbols, tagging whether they're from watchlist, portfolio, or both.
  const symbolMap = new Map<string, { name: string; source: "watchlist" | "portfolio" }>();
  for (const w of watchlist) symbolMap.set(w.symbol, { name: w.name, source: "watchlist" });
  for (const p of portfolio) {
    if (!symbolMap.has(p.symbol)) symbolMap.set(p.symbol, { name: p.name, source: "portfolio" });
  }

  if (symbolMap.size === 0) return NextResponse.json({ events: [] });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7); // include events from the past week
  const future = new Date();
  future.setDate(future.getDate() + 90);

  const entries = Array.from(symbolMap.entries());

  // Batch fetch calendarEvents for all symbols — best effort, ignore individual failures.
  const settled = await Promise.allSettled(
    entries.map(async ([sym]) => {
      const raw = await getQuoteSummary(sym, ["calendarEvents", "price"]) as Record<string, unknown>;
      return { sym, raw };
    }),
  );

  const events: CalendarEvent[] = [];

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === "rejected") continue;
    const { sym, raw } = result.value;
    const meta = symbolMap.get(sym)!;
    const pr = (raw.price ?? {}) as Record<string, unknown>;
    const name = (pr.longName as string | undefined) ?? (pr.shortName as string | undefined) ?? meta.name;
    const cal = (raw.calendarEvents ?? {}) as Record<string, unknown>;
    const earnings = (cal.earnings ?? {}) as Record<string, unknown>;

    // Earnings window: Yahoo returns [startDate, endDate]
    const earningsDates = (earnings.earningsDate ?? []) as unknown[];
    const earningsStart = earningsDates[0] != null ? toIso(earningsDates[0]) : null;
    const earningsEnd = earningsDates[1] != null ? toIso(earningsDates[1]) : null;
    const isEstimate = (earnings.isEarningsDateEstimate as boolean | undefined) ?? false;

    if (earningsStart) {
      const d = new Date(earningsStart);
      if (d >= cutoff && d <= future) {
        events.push({
          symbol: sym,
          name,
          type: "earnings",
          date: earningsStart,
          dateEnd: earningsEnd ?? undefined,
          isEstimate,
          source: meta.source,
        });
      }
    }

    // Ex-dividend date
    const exDiv = toIso(cal.exDividendDate);
    if (exDiv) {
      const d = new Date(exDiv);
      if (d >= cutoff && d <= future) {
        events.push({ symbol: sym, name, type: "exDividend", date: exDiv, source: meta.source });
      }
    }

    // Dividend payment date
    const divDate = toIso(cal.dividendDate);
    if (divDate) {
      const d = new Date(divDate);
      if (d >= cutoff && d <= future) {
        events.push({ symbol: sym, name, type: "dividend", date: divDate, source: meta.source });
      }
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return NextResponse.json({ events });
}
