import { NextResponse } from "next/server";
import {
  getScannerCache,
  getScannerCacheAt,
  getWatchlistBaselinePrices,
  listNotificationsSince,
  listTimelineEventsForSymbols,
  listWatchlist,
  listWatchlistByGroup,
  putScannerCache,
  putWatchlistCurrentPrices,
  touchWatchlistVisit,
} from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { getCalendarEvents } from "@/lib/calendar";
import { syncTimelineEvents } from "@/lib/timeline";
import { computeThesisSignal, type PulseDevelopment, type SymbolPulse, type WatchlistPulse } from "@/lib/watchlist-pulse";
import type { TimelineEvent, WatchlistItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Developments older than this never appear in the pulse payload. */
const DEVELOPMENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** At most this many developments per symbol travel to the client. */
const DEVELOPMENTS_PER_SYMBOL = 5;
/** How stale a symbol's news/filings check may get before the pulse re-syncs it. */
const SYNC_STALE_MS = 6 * 60 * 60 * 1000;
/** How many background syncs one pulse read may kick off. */
const SYNC_BATCH = 6;
/** Earnings map cache — quoteSummary per symbol is not free on a 60-name list. */
const EARNINGS_CACHE_KEY = "watchlist-pulse:earnings";
const EARNINGS_CACHE_TTL = 30 * 60 * 1000;

function toDevelopment(e: TimelineEvent, baselineAt: number): PulseDevelopment {
  return {
    id: e.id,
    title: e.title,
    timestamp: e.timestamp,
    impact: e.impact,
    importance: e.importanceScore,
    category: e.category,
    url: e.source.url,
    sourceKind: e.source.kind,
    sinceBaseline: Date.parse(e.timestamp) >= baselineAt,
  };
}

/** Upcoming earnings dates per watchlist symbol, cached for 30 minutes. */
async function earningsBySymbol(): Promise<Record<string, string>> {
  const cached = getScannerCache(EARNINGS_CACHE_KEY, EARNINGS_CACHE_TTL);
  if (cached) {
    try { return JSON.parse(cached) as Record<string, string>; } catch { /* refetch below */ }
  }
  const today = new Date().toISOString().slice(0, 10);
  const map: Record<string, string> = {};
  const { events } = await getCalendarEvents();
  for (const ev of events) {
    if (ev.type !== "earnings" || !ev.symbol || ev.date < today) continue;
    // Keep the SOONEST upcoming date per symbol.
    if (!map[ev.symbol] || ev.date < map[ev.symbol]) map[ev.symbol] = ev.date;
  }
  putScannerCache(EARNINGS_CACHE_KEY, JSON.stringify(map), EARNINGS_CACHE_TTL);
  return map;
}

/**
 * GET /api/watchlist/pulse[?group=2] — everything the triage layer knows that a
 * live quote does not: the visit baseline, developments and delivered alerts
 * since it, earnings proximity, and the deterministic thesis-drift signal.
 *
 * One request for the whole list. Reads are all local (SQLite: timeline events,
 * notifications, snapshots); the only network work is the batch quote (15s
 * platform cache) and a 30-minute-cached earnings sweep. News/filings syncs for
 * stale symbols are kicked off in the background and reported via `checking`,
 * never awaited — the pulse answers from what is known now.
 */
export async function GET(request: Request) {
  try {
    const groupParam = new URL(request.url).searchParams.get("group");
    const groupId = groupParam != null ? Number(groupParam) : null;
    if (groupParam != null && !Number.isInteger(groupId)) {
      return NextResponse.json({ error: "`group` must be a watchlist id" }, { status: 400 });
    }

    const items: WatchlistItem[] = groupId != null ? listWatchlistByGroup(groupId) : listWatchlist();
    const symbols = items.map((i) => i.symbol.toUpperCase());
    const now = Date.now();

    const visit = touchWatchlistVisit(now);
    const baselineIso = new Date(visit.baselineAt).toISOString();

    // Quotes and earnings in parallel; both are best-effort.
    const [quotesSettled, earningsSettled] = await Promise.allSettled([
      getQuotes(symbols),
      earningsBySymbol(),
    ]);
    const quotes = quotesSettled.status === "fulfilled" ? quotesSettled.value : [];
    const earnings = earningsSettled.status === "fulfilled" ? earningsSettled.value : {};

    // Record what this read saw, so the NEXT session has a baseline to diff against.
    putWatchlistCurrentPrices(
      quotes.map((q) => ({ symbol: q.symbol, price: q.price })),
      now,
    );

    const baselines = getWatchlistBaselinePrices(symbols);
    const allEvents = listTimelineEventsForSymbols(symbols);
    const notifications = listNotificationsSince(baselineIso, symbols);

    const eventsBySymbol = new Map<string, TimelineEvent[]>();
    for (const e of allEvents) {
      const list = eventsBySymbol.get(e.symbol.toUpperCase());
      if (list) list.push(e);
      else eventsBySymbol.set(e.symbol.toUpperCase(), [e]);
    }
    const notesBySymbol = new Map<string, typeof notifications>();
    for (const n of notifications) {
      if (!n.symbol) continue;
      const key = n.symbol.toUpperCase();
      const list = notesBySymbol.get(key);
      if (list) list.push(n);
      else notesBySymbol.set(key, [n]);
    }

    const pulseSymbols: Record<string, SymbolPulse> = {};
    for (const item of items) {
      const sym = item.symbol.toUpperCase();
      const events = eventsBySymbol.get(sym) ?? [];
      const recent = events
        .filter((e) => now - Date.parse(e.timestamp) <= DEVELOPMENT_WINDOW_MS)
        .slice(0, DEVELOPMENTS_PER_SYMBOL)
        .map((e) => toDevelopment(e, visit.baselineAt));

      // Drift is measured since the user last actually re-read the thesis (or
      // since the name was added), not since the visit — a thesis does not
      // reset because the page was opened.
      const reviewedAt = item.lastReviewedAt ?? Date.parse(item.addedAt) ?? now;
      const thesisSignal =
        item.notes || item.buyTrigger || item.sellTrigger
          ? computeThesisSignal(
              events.map((e) => ({
                title: e.title,
                timestamp: e.timestamp,
                impact: e.impact,
                importance: e.importanceScore,
              })),
              reviewedAt,
              now,
            )
          : null;

      pulseSymbols[sym] = {
        baselinePrice: visit.firstVisit ? null : (baselines.get(sym)?.price ?? null),
        developments: recent,
        notifications: (notesBySymbol.get(sym) ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          kind: n.kind,
          severity: n.severity,
          createdAt: n.createdAt,
        })),
        earningsDate: earnings[sym] ?? earnings[item.symbol] ?? null,
        thesisSignal,
        developmentsCheckedAt: getScannerCacheAt(`timeline-sync:${sym}`),
      };
    }

    // Background developments refresh for the stalest names — never awaited.
    const stale = symbols.filter((s) => {
      const at = getScannerCacheAt(`timeline-sync:${s}`);
      return at == null || now - at > SYNC_STALE_MS;
    });
    const checking = stale.slice(0, SYNC_BATCH);
    if (checking.length > 0) {
      void Promise.allSettled(checking.map((s) => syncTimelineEvents(s))).catch(() => {});
    }

    const pulse: WatchlistPulse = {
      generatedAt: now,
      baselineAt: visit.baselineAt,
      firstVisit: visit.firstVisit,
      symbols: pulseSymbols,
      checking,
    };
    return NextResponse.json(pulse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute the watchlist pulse";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
