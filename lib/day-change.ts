/**
 * The ONE definition of "how much did this move today" — F-22's fix.
 *
 * Before this module, four codepaths each answered that question differently:
 * lib/yahoo.ts computed quote change, lib/alerts.ts froze it into persisted
 * prose, lib/home/pulse.ts relabelled *since-cost* return as a daily move, and
 * lib/movement-explainer.ts derived it from lagging history bars. The result
 * was three different "AAPL today" figures in a single homepage payload
 * (audit F-22). Every daily-change consumer now goes through `dayChange()`,
 * which — critically — never says "today": it reports the change *of a dated
 * session*, and callers must compare `sessionDate` against their own "today"
 * before using that word.
 *
 * Definitions:
 * - reference close = Yahoo's `previousClose` (last completed session's
 *   official close; never re-derived from history bars)
 * - price           = latest regular-session trade
 * - pre-open        = Yahoo's regular fields still describe the previous
 *   session; `session: "pre"` + a yesterday `sessionDate` make that explicit
 * - non-trading day = `sessionDate` is simply the last session's date; the
 *   word "today" becomes unavailable to honest callers
 *
 * Pure, zero-dependency, client-safe. Tested in tests/day-change.test.ts.
 */

import type { Quote } from "./types";

export type SessionState = "pre" | "regular" | "post" | "closed";

export interface DayChange {
  /** Percent move vs the reference close, e.g. -8.7. */
  pct: number;
  /** Absolute move in quote currency. */
  abs: number;
  price: number;
  previousClose: number;
  /** Epoch ms of the last trade this change describes; null when Yahoo omitted it. */
  asOf: number | null;
  /**
   * Calendar day (YYYY-MM-DD) of that trade **in the exchange's timezone**.
   * Null when the trade time or timezone is unknown — callers must then treat
   * the session as undated and never claim "today".
   */
  sessionDate: string | null;
  session: SessionState;
}

function toSessionState(marketState: string | null | undefined): SessionState {
  switch (marketState) {
    case "REGULAR":
      return "regular";
    case "PRE":
    case "PREPRE":
      return "pre";
    case "POST":
    case "POSTPOST":
      return "post";
    default:
      return "closed";
  }
}

/** YYYY-MM-DD of `epochMs` in `timeZone` (falls back to UTC when unknown). */
export function dateInZone(epochMs: number, timeZone: string | null | undefined): string {
  try {
    // en-CA reliably formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(epochMs));
  } catch {
    return new Date(epochMs).toISOString().slice(0, 10);
  }
}

/** The canonical daily change for a quote. */
export function dayChange(q: Quote): DayChange {
  const price = q.price;
  const previousClose = q.previousClose;
  const abs = q.change ?? price - previousClose;
  const pct = q.changePercent ?? (previousClose ? (abs / previousClose) * 100 : 0);

  const asOf = q.regularMarketTime ? Date.parse(q.regularMarketTime) : NaN;
  const hasTime = Number.isFinite(asOf);

  return {
    pct,
    abs,
    price,
    previousClose,
    asOf: hasTime ? asOf : null,
    sessionDate: hasTime ? dateInZone(asOf, q.exchangeTimezone) : null,
    session: toSessionState(q.marketState),
  };
}

/**
 * May this change honestly be called "today's move"? True only when the trade
 * it describes happened on the current calendar day in the exchange's own
 * timezone. Unknown session dates are never "today".
 */
export function isCurrentSession(
  dc: Pick<DayChange, "sessionDate">,
  exchangeTimezone: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!dc.sessionDate) return false;
  return dc.sessionDate === dateInZone(now, exchangeTimezone);
}

/**
 * Human label for the session a change describes: "today" when current,
 * otherwise the dated session ("Fri, Aug 1"). This is the ONLY place that is
 * allowed to produce the word "today" for a daily change.
 */
export function sessionLabel(
  dc: Pick<DayChange, "sessionDate">,
  exchangeTimezone: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!dc.sessionDate) return "as of last close";
  if (isCurrentSession(dc, exchangeTimezone, now)) return "today";
  const parsed = Date.parse(`${dc.sessionDate}T12:00:00Z`);
  return `on ${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(parsed))}`;
}
