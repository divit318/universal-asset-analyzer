/**
 * Module 7 — Watchlist Intelligence.
 *
 * Buckets are derived from the watchlist alerts that `gatherContext()` has
 * *already computed* for the action queue, plus the calendar events the digest
 * has *already fetched*. Nothing here re-scores anything.
 *
 * That constraint is deliberate and it is the whole design of this module. The
 * obvious implementation — call `summariseOne()` per symbol to get a fresh
 * fundamental score and bucket on that — costs three provider round-trips per
 * watchlist entry (quote + fundamentals + 420 days of history). On a 25-symbol
 * watchlist that is 75 fetches standing between the user and a homepage paint,
 * to produce a bucket label that the alert engine has already effectively
 * decided. So we read the alerts instead: same signal, zero marginal cost.
 *
 * The trade-off is honest and worth stating: a symbol with no alert lands in no
 * bucket. That is correct — "nothing has changed about this name" is the most
 * common true state of a watchlist entry, and inventing a bucket for it would
 * be noise.
 *
 * Pure — no I/O. Unit-tested in tests/home-watchlist-intel.test.ts.
 */

import type { WatchlistAlert, WatchlistItem } from "../types";
import type { UpcomingEventLite } from "../mission-control";
import type { WatchlistBucket, WatchlistIntelligence } from "./contracts";

export function buildWatchlistIntelligence(
  items: WatchlistItem[],
  alerts: WatchlistAlert[],
  events: UpcomingEventLite[],
): WatchlistIntelligence {
  if (items.length === 0) {
    return { status: "empty", total: 0, buckets: [], alerts: [], upcomingEarnings: [] };
  }

  const watched = new Set(items.map((i) => i.symbol.toUpperCase()));
  const mine = alerts.filter((a) => watched.has(a.symbol.toUpperCase()));

  const bucketed = (predicate: (a: WatchlistAlert) => boolean): string[] =>
    [...new Set(mine.filter(predicate).map((a) => a.symbol.toUpperCase()))];

  const buckets: WatchlistBucket[] = ([
    {
      id: "buy",
      label: "Buy candidates",
      // The alert engine raises `new_opportunity` when a name has *become*
      // attractive, and `valuation` when it is cheap on multiples. Both are the
      // "this is actionable now" signal.
      symbols: bucketed((a) => a.type === "new_opportunity" || a.type === "valuation"),
    },
    {
      id: "near-buy",
      label: "Building momentum",
      symbols: bucketed((a) => a.type === "breakout" || a.type === "sector_leadership"),
    },
    {
      id: "high-risk",
      label: "Deteriorating",
      symbols: bucketed((a) => a.type === "deteriorating" || a.severity === "high"),
    },
  ] satisfies WatchlistBucket[]).filter((b) => b.symbols.length > 0);

  const upcomingEarnings = events
    .filter((e) => e.type === "earnings" && e.symbol && watched.has(e.symbol.toUpperCase()))
    .map((e) => ({ symbol: (e.symbol as string).toUpperCase(), date: e.date }))
    .slice(0, 5);

  return {
    status: "ok",
    total: items.length,
    buckets,
    alerts: mine.slice(0, 5),
    upcomingEarnings,
  };
}
