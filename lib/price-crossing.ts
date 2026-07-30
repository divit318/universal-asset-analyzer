/**
 * Crossing detection — the difference between a condition being true and
 * something having happened.
 *
 * ## The problem
 *
 * `evaluateWatchlistAlerts` tested state: "is the price at or past the target?"
 * A state test is true continuously once satisfied, so the only thing preventing
 * a notification on every 5-minute tick was a 24-hour dedup window in
 * `createNotifications`. That produces two distinct wrong behaviours:
 *
 * - **False repeats.** A target reached in January re-announces itself every
 *   single day for as long as the price stays there. Nothing happened; the alert
 *   is describing the weather, not an event.
 * - **Missed repeats.** A price that crosses the level, retreats, and crosses
 *   again within the same 24 hours — exactly the case a trader cares most about —
 *   is silently suppressed, because the dedup key had already fired.
 *
 * A threshold alert is inherently about a *transition*. This module models it as
 * one: given the previous observed price and the current one, did the value move
 * from one side of the level to the other?
 *
 * ## Arming
 *
 * A transition needs two observations. The first time a symbol is seen there is
 * no previous price, so nothing can have crossed — the evaluator *arms* instead
 * of firing. This is also what makes "already past the level when you set it"
 * behave correctly: it never announces a crossing that predates the target.
 *
 * The baseline is deliberately reset whenever the user edits a target
 * (`resetPriceAlertState`), because a baseline captured under the old level says
 * nothing about the new one.
 *
 * ## Downtime
 *
 * Because the previous price is persisted in SQLite rather than held in memory,
 * a crossing that happens while the process is down is still detected on the
 * next run: the comparison is simply against an older observation. That is the
 * "historical crossing detection" this design supports — it cannot reconstruct
 * intra-gap round trips (for that you would need to replay the price history),
 * but it never misses a net crossing.
 *
 * Pure and dependency-light so it is unit-testable in isolation
 * (`tests/price-crossing.test.ts`).
 */

import { isUsablePrice } from "./watchlist-metrics";
import type { TargetDirection } from "./types";

/** Which side of a threshold a price sits on. */
export type Side = "below" | "at_or_beyond";

export interface CrossingInput {
  /** Last price this evaluator observed, or null when the symbol is unarmed. */
  previousPrice: number | null | undefined;
  currentPrice: number | null | undefined;
  threshold: number | null | undefined;
  direction: TargetDirection;
}

export type CrossingResult =
  /** Two usable observations and the price moved through the level. */
  | { kind: "crossed"; from: number; to: number }
  /** Nothing to compare against yet; the caller should persist the price. */
  | { kind: "armed" }
  /** Comparable, but no transition this tick. */
  | { kind: "no_change"; satisfied: boolean }
  /** Missing or unusable input — never an event. */
  | { kind: "unavailable" };

/**
 * Whether `price` has reached the level, in the direction that was recorded.
 * The same inclusive test the table's state badge uses, so the two can never
 * disagree about *whether* a level is satisfied — only about whether it is news.
 */
export function satisfiesThreshold(
  price: number,
  threshold: number,
  direction: TargetDirection,
): boolean {
  return direction === "above" ? price >= threshold : price <= threshold;
}

/**
 * Detect a threshold crossing between two observations.
 *
 * A crossing requires the previous observation to be strictly *not* satisfied and
 * the current one to be satisfied. The strictness matters: with `>=` on both
 * sides, a price that merely stayed put at exactly the target would re-fire every
 * tick, which is the original bug in a new place.
 */
export function detectCrossing(input: CrossingInput): CrossingResult {
  const { previousPrice, currentPrice, threshold, direction } = input;
  if (!isUsablePrice(currentPrice) || !isUsablePrice(threshold)) return { kind: "unavailable" };
  if (!isUsablePrice(previousPrice)) return { kind: "armed" };

  const was = satisfiesThreshold(previousPrice, threshold, direction);
  const is = satisfiesThreshold(currentPrice, threshold, direction);

  if (!was && is) return { kind: "crossed", from: previousPrice, to: currentPrice };
  return { kind: "no_change", satisfied: is };
}

/**
 * A stable identity for one crossing event.
 *
 * Includes the threshold and its direction, so re-targeting a name is a
 * genuinely new alert rather than a suppressed duplicate of the old one, and the
 * UTC date, so a level crossed on two different days reports twice while
 * repeated ticks within a day cannot. `createNotifications`' time-window dedup
 * then acts only as a backstop, not as the primary mechanism.
 */
export function crossingDedupKey(
  symbol: string,
  threshold: number,
  direction: TargetDirection,
  at: number = Date.now(),
): string {
  const day = new Date(at).toISOString().slice(0, 10);
  // Two decimals: the same level typed as 200 and 200.001 is the same level.
  return `wt:${symbol.toUpperCase()}:target:${direction}:${threshold.toFixed(2)}:${day}`;
}

/**
 * Identity for a single-day drop alert.
 *
 * Keyed by UTC date rather than by a rolling window, which is what makes the
 * reset behaviour correct: one alert per symbol per session, and a fresh one
 * tomorrow. A 24-hour rolling window straddles two trading days, so a stock that
 * fell 6% on consecutive days announced only the first.
 */
export function dropDedupKey(symbol: string, at: number = Date.now()): string {
  return `wt:${symbol.toUpperCase()}:drop:${new Date(at).toISOString().slice(0, 10)}`;
}

/**
 * Did today's decline breach the threshold *for the first time* this tick?
 *
 * `changePercent` is a same-day measure that resets itself overnight, so the
 * transition test is against the previously observed change rather than against
 * a price. When no previous change is known the alert is allowed to fire — unlike
 * a price level, a drop that is already -8% when first observed genuinely did
 * happen today, and suppressing it would mean a restart silently swallows the
 * day's worst move.
 */
export function detectDropBreach(input: {
  previousChangePercent: number | null | undefined;
  currentChangePercent: number | null | undefined;
  thresholdPct: number | null | undefined;
}): boolean {
  const { previousChangePercent, currentChangePercent, thresholdPct } = input;
  // The threshold is a MAGNITUDE, and is treated as one even if stored signed.
  // Rows written before `updateWatchlistItem` normalized this could hold -5;
  // reading that as "no threshold" would silently stop alerting on them, whereas
  // reading it as 5% is what the user plainly meant.
  if (thresholdPct == null || !Number.isFinite(thresholdPct)) return false;
  const limit = -Math.abs(thresholdPct);
  if (limit === 0) return false; // a 0% "drop" would fire on every flat tick
  if (currentChangePercent == null || !Number.isFinite(currentChangePercent)) return false;
  if (currentChangePercent > limit) return false;
  if (previousChangePercent == null || !Number.isFinite(previousChangePercent)) return true;
  return previousChangePercent > limit;
}
