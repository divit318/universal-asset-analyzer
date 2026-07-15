import {
  listWatchlist,
  listPortfolio,
  createNotifications,
  unreadNotificationCount,
} from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { evaluateAlerts, type QuoteLite } from "@/lib/alerts";

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
  const quoteMap = new Map<string, QuoteLite>(
    quotes.map((q) => [q.symbol.toUpperCase(), { price: q.price, changePercent: q.changePercent, currency: q.currency }]),
  );

  const events = evaluateAlerts({
    watchlist: watchlist.map((w) => ({
      symbol: w.symbol,
      name: w.name,
      targetPrice: w.targetPrice,
      alertPctDrop: w.alertPctDrop,
    })),
    positions: positions.map((p) => ({ symbol: p.symbol, name: p.name })),
    quotes: quoteMap,
  });

  const created = createNotifications(events);
  return { created, unread: unreadNotificationCount(), checked: symbols.length };
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
