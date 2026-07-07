import { NextResponse } from "next/server";
import {
  listWatchlist,
  listPortfolio,
  createNotifications,
  unreadNotificationCount,
} from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { evaluateAlerts, type QuoteLite } from "@/lib/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST/GET /api/monitor/run — evaluate every watchlist and portfolio alert
 * against live quotes and persist any that fired (24h-deduped).
 *
 * The header bell polls this while the app is open; the same endpoint can be
 * hit by cron/launchd to deliver alerts even when no tab is — the app being a
 * local server means "background monitoring" is just a scheduled curl.
 */
async function run() {
  const watchlist = listWatchlist();
  const positions = listPortfolio();

  const symbols = [...new Set([...watchlist.map((w) => w.symbol), ...positions.map((p) => p.symbol)])];
  if (symbols.length === 0) {
    return NextResponse.json({ created: 0, unread: unreadNotificationCount(), checked: 0 });
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
  return NextResponse.json({ created, unread: unreadNotificationCount(), checked: symbols.length });
}

export async function POST() {
  return run();
}

export async function GET() {
  return run();
}
