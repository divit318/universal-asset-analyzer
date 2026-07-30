/**
 * Watchlist math — the single source of truth for every number the watchlist
 * shows and every threshold its alerts fire on.
 *
 * ## Why this module exists
 *
 * The same three quantities were being computed in three places with three
 * different answers:
 *
 * 1. **Upside.** `app/watchlist/page.tsx` computed `(price − target) / target`
 *    and coloured negative values green. Everywhere else in UAA — the analyst
 *    card, `/dcf`, `/compare`, `/ic-report` — upside is `(target − price) / price`
 *    and positive is green. So the watchlist reported a name trading 23% below
 *    the level the user was waiting for as a green "−23.08%", with the wrong
 *    denominator on top of the wrong sign.
 *
 * 2. **"Target reached".** `lib/alerts.ts` (the notification bell) fired when
 *    `price <= target`, treating the target as a buy limit. The watchlist page
 *    fired when `price >= target`, treating it as a valuation target. The CSV
 *    export agreed with the page. One of the two was therefore always firing for
 *    any target a user set, forever, and the bell and the page could never agree.
 *    Resolved by storing the direction explicitly rather than by guessing which
 *    of the two intents the user had — see {@link resolveTargetDirection}.
 *
 * 3. **Age.** `daysAgo` divided raw milliseconds by 86.4e6, so a name added at
 *    23:00 yesterday read "today" at 10:00 the next morning, and an unparseable
 *    timestamp rendered "NaNd ago".
 *
 * Pure, dependency-free and client-safe, so the page, the alert evaluator and
 * the CSV export can all import it. Unit-tested in `tests/watchlist-metrics.test.ts`.
 */

import type { TargetDirection } from "./types";

/* -------------------------------------------------------------------------- */
/* Guards                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A price is usable only if it is a finite, strictly-positive number.
 *
 * Zero matters: a target of 0 was storable (the old modal's `targetPrice ? … : null`
 * check passes the string `"0"`, which is truthy) and it divided straight into
 * the upside formula, rendering `+Infinity%`. A zero or negative price is not a
 * price, so it is treated as absent rather than as a very cheap stock.
 */
export function isUsablePrice(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/* -------------------------------------------------------------------------- */
/* Upside                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Return from today's price to a target, in percent: `(target − price) / price`.
 *
 * Signed the way the rest of UAA signs it — positive means the target is above
 * today's price, so positive is green. Returns null (never 0, never Infinity)
 * when either leg is missing or unusable, so a missing target sinks in a sort
 * instead of ranking as a flat 0%.
 *
 * Sign is independent of {@link TargetDirection}: a buy-limit target set below
 * the market correctly reports negative upside, which is the honest reading —
 * the price has to fall to get there.
 */
export function upsidePercent(
  price: number | null | undefined,
  target: number | null | undefined,
): number | null {
  if (!isUsablePrice(price) || !isUsablePrice(target)) return null;
  return ((target - price) / price) * 100;
}

/* -------------------------------------------------------------------------- */
/* Target direction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Which way the price has to move for a target to be "reached".
 *
 * `above` is a valuation/exit target ("tell me when it gets there").
 * `below` is a buy limit ("tell me when it comes back to my price").
 *
 * Stored explicitly per row because it cannot be recovered from the numbers
 * afterwards: once the price crosses an `above` target, `target < price` looks
 * exactly like a `below` target that has not been hit yet, and any heuristic
 * that reads the direction off today's prices will therefore silently stop
 * firing an alert the moment it becomes true.
 *
 * `direction` is null only for rows that predate the column. For those the
 * price at read time is the best available evidence, and it is unambiguous in
 * the one case that matters: a target the price has not yet reached is a target
 * in the direction the price would have to travel.
 */
export function resolveTargetDirection(
  direction: TargetDirection | null | undefined,
  target: number | null | undefined,
  referencePrice: number | null | undefined,
): TargetDirection {
  if (direction === "above" || direction === "below") return direction;
  if (!isUsablePrice(target) || !isUsablePrice(referencePrice)) return "above";
  return target >= referencePrice ? "above" : "below";
}

/**
 * The direction to pre-select when a user types a target, given the live price.
 * A target above the market is an exit level; below it is a buy limit. This is a
 * default for the form, not an inference used at evaluation time.
 */
export function suggestTargetDirection(
  target: number | null | undefined,
  price: number | null | undefined,
): TargetDirection {
  if (!isUsablePrice(target) || !isUsablePrice(price)) return "above";
  return target >= price ? "above" : "below";
}

/** True when the price has reached the target in the direction the user meant. */
export function isTargetReached(
  price: number | null | undefined,
  target: number | null | undefined,
  direction: TargetDirection,
): boolean {
  if (!isUsablePrice(price) || !isUsablePrice(target)) return false;
  return direction === "above" ? price >= target : price <= target;
}

/**
 * How far the price still has to travel to reach the target, in percent, always
 * expressed as a non-negative distance. Null when there is no target, and 0 once
 * the target is reached. Used for "closest to my target first" ranking, which
 * `upsidePercent` cannot express because it mixes both directions on one axis.
 */
export function distanceToTargetPercent(
  price: number | null | undefined,
  target: number | null | undefined,
  direction: TargetDirection,
): number | null {
  const upside = upsidePercent(price, target);
  if (upside == null) return null;
  if (isTargetReached(price, target, direction)) return 0;
  return Math.abs(upside);
}

/* -------------------------------------------------------------------------- */
/* 52-week range                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Today's price as a percentage below the 52-week high — always ≤ 0, so it reads
 * as a drawdown and sorts "most beaten-up last" on a descending sort.
 *
 * Clamped at 0 on purpose: a live intraday print frequently exceeds the
 * provider's cached 52-week high by a few cents, and "+0.14% from the high" is a
 * data artefact being reported as a finding.
 */
export function percentFrom52WeekHigh(
  price: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (!isUsablePrice(price) || !isUsablePrice(high)) return null;
  return Math.min(0, ((price - high) / high) * 100);
}

/**
 * Where the price sits in its 52-week range, 0 (at the low) to 100 (at the high).
 * Null when the range is missing or degenerate — a stock whose high equals its
 * low has no position within a range, and the division would be by zero.
 */
export function rangePosition52Week(
  price: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (!isUsablePrice(price) || !isUsablePrice(low) || !isUsablePrice(high)) return null;
  if (high <= low) return null;
  const pct = ((price - low) / (high - low)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/* -------------------------------------------------------------------------- */
/* Age                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Whole calendar days since an ISO timestamp, by UTC date rather than by
 * 24-hour windows, so "yesterday" means the previous date and not "between 24
 * and 48 hours ago". Null for an unparseable timestamp; clamped at 0 so a clock
 * skew never renders "-1d ago".
 */
export function daysSince(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
  return Math.max(0, dayOf(now) - dayOf(then));
}

/**
 * Compact age for a table cell. Days stay days while the precision is useful,
 * then roll up: a name held for two years reading "731d ago" is precision the
 * reader has to divide by 365 themselves.
 */
export function formatAge(iso: string | null | undefined, now: number = Date.now()): string {
  const d = daysSince(iso, now);
  if (d == null) return "—";
  if (d === 0) return "today";
  if (d === 1) return "1d";
  if (d < 90) return `${d}d`;
  if (d < 730) return `${Math.round(d / 30.44)}mo`;
  return `${(d / 365.25).toFixed(1)}y`;
}
