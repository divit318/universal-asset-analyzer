/**
 * Refresh scheduling for live prices.
 *
 * There is no streaming price feed anywhere in this stack — `lib/yahoo.ts` is a
 * request/response wrapper and `/api/quote` is a batch endpoint — so the honest
 * best available architecture is polling. The engineering that matters is
 * therefore in *when not to poll*, because a naive `setInterval` against a
 * 57-symbol batch is both useless and rude: it hammers the provider overnight
 * when no price can change, keeps running in a background tab nobody is looking
 * at, and retries at full speed into an outage.
 *
 * Four rules, all pure and tested here so the React hook stays trivial:
 *
 * 1. **A hidden tab does not poll at all.** Whatever is on screen is stale
 *    anyway, and it is re-fetched the moment the tab is looked at again.
 * 2. **Closed markets poll slowly.** Prices do still settle after the bell, so
 *    the interval lengthens rather than stopping — but by an order of magnitude.
 * 3. **Errors back off exponentially**, capped, so an outage costs a handful of
 *    requests instead of one every 30 seconds until it is fixed.
 * 4. **Crypto is always open**, which the region check handles for free.
 *
 * Kept separate from the hook (and free of React) so the schedule can be
 * reasoned about and unit-tested without a DOM — see
 * `tests/live-quotes.test.ts`.
 */

import { estimateMarketStatus } from "./market-hours";
import type { MarketRegion } from "./market";

/** Poll cadence while at least one tracked market is open. */
export const OPEN_INTERVAL_MS = 30_000;
/** Poll cadence when every tracked market is closed — prices still settle. */
export const CLOSED_INTERVAL_MS = 300_000;
/** Ceiling for the error backoff, so a long outage never stops retrying entirely. */
export const MAX_BACKOFF_MS = 600_000;

export interface ScheduleInput {
  /** Listing regions of the symbols on screen. Empty means nothing to poll. */
  regions: MarketRegion[];
  /** Whether the document is currently visible. */
  visible: boolean;
  /** Consecutive failed attempts; 0 when healthy. */
  consecutiveErrors: number;
  /** Injected for testability. */
  now?: Date;
}

/**
 * Milliseconds until the next poll, or `null` for "do not poll".
 *
 * `null` is deliberately distinct from a very long interval: the caller clears
 * its timer entirely rather than scheduling a wake-up it does not want.
 */
export function resolvePollInterval(input: ScheduleInput): number | null {
  const { regions, visible, consecutiveErrors, now = new Date() } = input;
  if (!visible) return null;
  if (regions.length === 0) return null;

  const anyOpen = regions.some((r) => estimateMarketStatus(r, now) === "open");
  const base = anyOpen ? OPEN_INTERVAL_MS : CLOSED_INTERVAL_MS;
  if (consecutiveErrors === 0) return base;

  // 2^n with a cap. The cap is applied to the backoff itself, not to the base,
  // so a closed-market interval is never *shortened* by an error.
  const backoff = base * 2 ** Math.min(consecutiveErrors, 8);
  return Math.min(Math.max(backoff, base), MAX_BACKOFF_MS);
}

/** Human-readable "as of" for the freshness indicator. Stable, no locale drift. */
export function formatAsOf(at: number | null, now: number = Date.now()): string {
  if (at == null) return "never";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

/**
 * Which price fields actually changed between two quote snapshots.
 *
 * Used to flash only the cells that moved. Comparing the rendered string rather
 * than the raw number on purpose: a change from 190.001 to 190.004 is not a
 * change the user can see, and flashing it is noise.
 */
export function changedSymbols(
  previous: Record<string, { price: number }>,
  next: Record<string, { price: number }>,
): { symbol: string; direction: "up" | "down" }[] {
  const out: { symbol: string; direction: "up" | "down" }[] = [];
  for (const [symbol, q] of Object.entries(next)) {
    const before = previous[symbol];
    if (!before) continue;
    if (before.price.toFixed(2) === q.price.toFixed(2)) continue;
    out.push({ symbol, direction: q.price > before.price ? "up" : "down" });
  }
  return out;
}
