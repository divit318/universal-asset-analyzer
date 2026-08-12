import {
  listWatchlist,
  listPortfolio,
  createNotifications,
  unreadNotificationCount,
  backfillTargetDirection,
  getPriceAlertStates,
  putPriceAlertStates,
} from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { categorizeIndianDevelopment, getIndianFilings } from "@/lib/india-news";
import { getResultsDaySnapshot } from "@/lib/india-results";
import { ownershipTrends, readIndiaOwnership } from "@/lib/india-ownership";
import { isOwnershipCurrent, ownershipContextLine } from "@/lib/india-ownership-trends";
import { evaluateAlerts, type AlertEvent, type QuoteLite } from "@/lib/alerts";
import { dayChange, isCurrentSession } from "@/lib/day-change";
import { resolveTargetDirection } from "@/lib/watchlist-metrics";

export interface MonitorRunResult {
  created: number;
  unread: number;
  checked: number;
}

/**
 * Evaluate every watchlist and portfolio alert against live quotes and
 * persist any that fired (24h-deduped). Shared by the API route, the
 * in-process scheduler (instrumentation.ts), and scripts/monitor.mjs.
 */
export async function runMonitor(): Promise<MonitorRunResult> {
  const watchlist = listWatchlist();
  const positions = listPortfolio();

  const symbols = [...new Set([...watchlist.map((w) => w.symbol), ...positions.map((p) => p.symbol)])];
  if (symbols.length === 0) {
    return { created: 0, unread: unreadNotificationCount(), checked: 0 };
  }

  const quotes = await getQuotes(symbols);
  // Session metadata rides along so the evaluator can refuse to re-announce a
  // finished session's move as news (the F-22 weekend re-alert bug), and so
  // alert prose can date itself honestly at render time.
  const quoteMap = new Map<string, QuoteLite>(
    quotes.map((q) => {
      const dc = dayChange(q);
      return [
        q.symbol.toUpperCase(),
        {
          price: q.price,
          changePercent: q.changePercent,
          currency: q.currency,
          sessionDate: dc.sessionDate,
          observedAt: dc.asOf != null ? new Date(dc.asOf).toISOString() : null,
          // Only gate when we positively know the session is over; missing
          // metadata must not silence alerts.
          isCurrentSession: dc.sessionDate == null ? undefined : isCurrentSession(dc, q.exchangeTimezone),
        },
      ];
    }),
  );

  /**
   * Backfill the trigger direction for targets that predate the column.
   *
   * The inference itself is only sound at one moment — "the direction the price
   * would have to travel to reach a target it has not reached yet" — so it has to
   * be *recorded* rather than re-derived. Left unrecorded, a target that later
   * crosses looks retroactively like a target in the other direction and silently
   * stops firing. This is the one place in the app that holds both live prices and
   * the database, so it is where the backfill belongs. Idempotent: after the first
   * pass there is nothing left to write.
   */
  for (const w of watchlist) {
    if (w.targetPrice == null || w.targetDirection != null) continue;
    const q = quoteMap.get(w.symbol.toUpperCase());
    if (!q) continue;
    try {
      // The low-level writer, NOT updateWatchlistItem: this is the system filling
      // in a column that was never populated, not a person changing their mind,
      // so it must not log a target revision or re-arm crossing detection.
      backfillTargetDirection(w.symbol, resolveTargetDirection(null, w.targetPrice, q.price));
    } catch {
      /* a failed backfill just retries on the next tick */
    }
  }

  /* The previous observation per symbol — the other half of every crossing test.
     Read before evaluation, written after, so a crossing that happened while
     this process was down is still detected against the older observation. */
  const previous = getPriceAlertStates(watchlist.map((w) => w.symbol));

  const { events, observations } = evaluateAlerts({
    watchlist: watchlist.map((w) => ({
      symbol: w.symbol,
      name: w.name,
      targetPrice: w.targetPrice,
      targetDirection:
        w.targetDirection ??
        resolveTargetDirection(
          null,
          w.targetPrice,
          // Prefer the previously-observed price: inferring a legacy row's
          // direction from today's price flips it the moment it crosses.
          previous.get(w.symbol.toUpperCase())?.lastPrice ?? quoteMap.get(w.symbol.toUpperCase())?.price ?? null,
        ),
      alertPctDrop: w.alertPctDrop,
    })),
    positions: positions.map((p) => ({ symbol: p.symbol, name: p.name })),
    quotes: quoteMap,
    previous: new Map(
      [...previous].map(([sym, s]) => [sym, { lastPrice: s.lastPrice, lastChangePercent: s.lastChangePercent }]),
    ),
  });

  // Indian watchlist names additionally get a results-released alert: NSE
  // results filings are the "earnings hit the tape" moment for these stocks.
  // The announcements feed is cached (30min TTL) and the notification table's
  // 24h dedup makes re-observing the same filing a no-op, so this stays cheap.
  const indiaEvents = await indianResultsEvents(
    watchlist.filter((w) => /\.(NS|BO)$/i.test(w.symbol)).map((w) => ({ symbol: w.symbol, name: w.name })),
  );

  const created = createNotifications([...events, ...indiaEvents]);

  // Persist last, and unconditionally: skipping the write on a tick that fired
  // nothing would leave the baseline stale and re-report the same crossing.
  try {
    putPriceAlertStates(observations);
  } catch {
    /* a failed write just means the next tick compares against an older price */
  }

  return { created, unread: unreadNotificationCount(), checked: symbols.length };
}

/** Results filings published in the last 24h for Indian watchlist symbols. */
async function indianResultsEvents(
  items: { symbol: string; name: string }[],
): Promise<AlertEvent[]> {
  if (items.length === 0) return [];
  const out: AlertEvent[] = [];
  const cutoff = Date.now() - 24 * 3_600_000;
  // Bounded and sequential: each call is served from the 30-min announcements
  // cache after the first tick, and a watchlist rarely has >20 Indian names.
  for (const item of items.slice(0, 25)) {
    try {
      const filings = await getIndianFilings(item.symbol, 15);
      // The precise category test (not a bare /result/i, which also matches
      // "results of postal ballot" style announcements).
      const results = filings.find(
        (f) =>
          categorizeIndianDevelopment(`${f.form} ${f.description}`) === "results" &&
          Date.parse(f.filedAt) > cutoff,
      );
      if (!results) continue;
      const day = results.filedAt.slice(0, 10);
      // Results-day context (deterministic; every field optional) — the
      // notification composes only from what actually resolved.
      const snapshot = await getResultsDaySnapshot(item.symbol, results.filedAt).catch(() => null);
      // Ownership context: cache-only, period-gated, descriptive (never causal).
      const own = readIndiaOwnership(item.symbol);
      const ownershipNote =
        own && isOwnershipCurrent(own.period) ? ownershipContextLine(ownershipTrends(own)) : null;
      out.push({
        dedupKey: `results_released:${item.symbol.toUpperCase()}:${day}`,
        symbol: item.symbol.toUpperCase(),
        name: item.name,
        kind: "results_released",
        severity: "info",
        facts: {
          kind: "results_released",
          symbol: item.symbol.toUpperCase(),
          name: item.name,
          reportedAt: results.filedAt,
          quarterLabel: snapshot?.quarterLabel ?? undefined,
          netProfitYoY: snapshot?.netProfitYoY ?? undefined,
          revenueYoY: snapshot?.revenueYoY ?? undefined,
          dayMovePct: snapshot?.dayMovePct ?? undefined,
          ownershipNote: ownershipNote ?? undefined,
          observedAt: new Date().toISOString(),
          sessionDate: day,
        },
      });
    } catch {
      /* announcements feed hiccup — next tick retries */
    }
  }
  return out;
}

const TICK_KEY = Symbol.for("uaa.monitor.interval");

/** exported for tests */
export function resolveIntervalMs(rawEnv: string | undefined): number {
  const DEFAULT = 5 * 60_000;
  if (rawEnv == null || rawEnv === "") return DEFAULT;
  const n = Number(rawEnv);
  if (!Number.isFinite(n) || n < 0) return DEFAULT;
  if (n === 0) return 0; // 0 disables
  return Math.max(n, 60_000); // floor 60s — protect Yahoo from misconfig
}

/** Start the in-process alert monitor. Idempotent across dev hot-reloads. */
export function startMonitorScheduler(): void {
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (g[TICK_KEY]) return; // already scheduled (hot reload / double register)

  const intervalMs = resolveIntervalMs(process.env.UAA_MONITOR_INTERVAL_MS);
  if (intervalMs === 0) return; // explicitly disabled

  const tick = async () => {
    try {
      const r = await runMonitor();
      if (r.created > 0) console.log(`[monitor] ${r.created} new alert(s), ${r.unread} unread`);
    } catch (err) {
      console.warn("[monitor] tick failed:", err instanceof Error ? err.message : err);
    }
  };

  const t = setInterval(() => void tick(), intervalMs);
  t.unref?.(); // never keep the process alive just for the timer
  g[TICK_KEY] = t;
  // First run after a short warm-up, not immediately — Yahoo at boot is wasteful
  // when the bell will also fire on first page load.
  const warmup = setTimeout(() => void tick(), 30_000);
  warmup.unref?.();
}
