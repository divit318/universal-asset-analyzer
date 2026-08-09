/**
 * Alert evaluation engine — turns the thresholds users already set (watchlist
 * price targets and drop alerts) plus portfolio big moves into concrete alert
 * events.
 *
 * Until now those thresholds were stored and never acted on: there was no
 * evaluator and no delivery. This is the evaluator half — pure and testable.
 * The monitor route (app/api/monitor/run) feeds it live quotes on a schedule,
 * persists the results (lib/db.ts notifications), and the header bell delivers
 * them.
 *
 * Pure and deterministic — no DB, no network.
 */

import { resolveTargetDirection } from "./watchlist-metrics";
import {
  crossingDedupKey,
  detectCrossing,
  detectDropBreach,
  dropDedupKey,
} from "./price-crossing";
import type { TargetDirection } from "./types";

export type AlertKind = "price_target" | "drop_alert" | "big_move";
export type AlertSeverity = "info" | "warning";

/**
 * The facts an alert is made of — persisted instead of prose (audit F-22c).
 *
 * The old shape froze rendered strings ("moved -8.7% today to $304.34") into
 * the notification table, where "today" stayed true forever. Events now carry
 * the numbers plus the session they describe; prose is produced at *read* time
 * by {@link renderAlertText}, which only says "today" when the session date is
 * actually today.
 */
export interface AlertFacts {
  kind: AlertKind;
  symbol: string;
  name: string;
  /** Day move % (drop/big-move alerts). */
  pct?: number;
  price?: number;
  currency?: string | null;
  /** Crossing facts (price_target). */
  fromPrice?: number;
  toPrice?: number;
  targetPrice?: number;
  direction?: TargetDirection;
  /** The user's drop threshold, absolute % (drop_alert). */
  thresholdPct?: number;
  /** ISO time of the quote observation this alert describes. */
  observedAt: string;
  /** Calendar day (exchange TZ) of the session it describes; null = unknown. */
  sessionDate: string | null;
}

export interface AlertEvent {
  /** Stable identity used to avoid re-firing the same alert (see 24h dedup). */
  dedupKey: string;
  symbol: string;
  name: string;
  kind: AlertKind;
  severity: AlertSeverity;
  facts: AlertFacts;
}

/** The slice of a live quote the evaluator needs. */
export interface QuoteLite {
  price: number;
  changePercent: number; // % change vs previous close, for the quote's session
  currency?: string | null;
  /**
   * Calendar day (exchange TZ) of the session this quote describes, from
   * lib/day-change. Undefined = caller has no session metadata (legacy).
   */
  sessionDate?: string | null;
  /** ISO of the quote's last trade; falls back to evaluation time. */
  observedAt?: string | null;
  /**
   * Whether the quote describes the CURRENT session (lib/day-change
   * isCurrentSession). When explicitly false, session-bound alerts (big moves,
   * drop alerts) are skipped — a Saturday run must not re-announce Friday's
   * close as news (the F-22 weekend bug). Undefined = unknown = allowed, so
   * callers without session metadata keep working.
   */
  isCurrentSession?: boolean;
}

/**
 * What was observed last time, per symbol — the second half of every transition
 * test. Absent means "not armed yet", which is never an event.
 *
 * Supplied by the caller (`runMonitor` reads it from `price_alert_state`) rather
 * than looked up here, so this module stays pure and testable.
 */
export interface PriceObservation {
  lastPrice: number | null;
  lastChangePercent?: number | null;
}

/** Symbols whose observation should be written back after evaluation. */
export interface AlertEvaluation {
  events: AlertEvent[];
  /** Every symbol that produced a usable quote, with the value to persist. */
  observations: { symbol: string; price: number; changePercent: number | null }[];
}

export interface WatchlistAlertInput {
  symbol: string;
  name: string;
  targetPrice: number | null;
  /**
   * Which way the price must move for the target to count as reached. Null for
   * rows saved before the column existed, and resolved from the live price at
   * evaluation time — see {@link resolveTargetDirection}.
   *
   * Before this field existed, this evaluator fired on `price <= target` (a buy
   * limit) while the Watchlist page and the CSV export fired on `price >= target`
   * (a valuation target). For any target a user actually set, one of the two was
   * therefore firing permanently. The direction is now recorded rather than
   * assumed, and both surfaces call {@link isTargetReached}.
   */
  targetDirection?: TargetDirection | null;
  alertPctDrop: number | null;
}

export interface PositionAlertInput {
  symbol: string;
  name: string;
}

const money = (v: number, ccy?: string | null) =>
  `${ccy === "INR" ? "₹" : "$"}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** YYYY-MM-DD of `now` in the runtime's local timezone. */
function localDate(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * "today" only when the session IS today; otherwise the dated session
 * ("on Fri, Jul 31"); "as of last close" when the session is unknown.
 */
function sessionPhrase(sessionDate: string | null, now: number): string {
  if (!sessionDate) return "as of last close";
  if (sessionDate === localDate(now)) return "today";
  const t = Date.parse(`${sessionDate}T12:00:00Z`);
  if (Number.isNaN(t)) return "as of last close";
  const label = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t));
  return `on ${label}`;
}

/**
 * Render an alert's title/body from its facts, honestly tensed for `now`.
 * This is the ONLY producer of alert prose — read paths call it per render,
 * so a five-day-old alert says "on Fri, Jul 31", not "today", forever.
 */
export function renderAlertText(f: AlertFacts, now: number = Date.now()): { title: string; body: string } {
  const when = sessionPhrase(f.sessionDate, now);
  switch (f.kind) {
    case "price_target": {
      const verb = f.direction === "above" ? "rose to" : "fell to";
      const goal = f.direction === "above" ? "reaching" : "dropping to";
      return {
        title: `${f.symbol} crossed your target`,
        body: `${f.name} ${verb} ${money(f.toPrice ?? f.price ?? 0, f.currency)} from ${money(f.fromPrice ?? 0, f.currency)} ${when}, ${goal} your ${money(f.targetPrice ?? 0, f.currency)} target.`,
      };
    }
    case "drop_alert": {
      const pct = f.pct ?? 0;
      return {
        title: `${f.symbol} dropped ${signed(pct)}`,
        body: `${f.name} fell ${signed(pct)} ${when} to ${money(f.price ?? 0, f.currency)} — past your ${Math.abs(f.thresholdPct ?? 0)}% drop alert.`,
      };
    }
    case "big_move": {
      const pct = f.pct ?? 0;
      const up = pct >= 0;
      // Magnitude only — "down -8.7%" was double-signed prose (audit F-14/F-22).
      const mag = `${Math.abs(pct).toFixed(1)}%`;
      return {
        title: `${f.symbol} ${up ? "up" : "down"} ${mag}`,
        body: `Your ${f.name} position moved ${signed(pct)} ${when} to ${money(f.price ?? 0, f.currency)}.`,
      };
    }
  }
}

/**
 * Watchlist alerts — fired on a *transition*, not on a state.
 *
 * A target that has been satisfied for a month is not news, and the previous
 * implementation announced it daily (a 24h dedup window was the only thing
 * throttling it) while simultaneously suppressing a genuine second crossing on
 * the same day. Both are fixed by comparing against the last observed price:
 * see `lib/price-crossing.ts`.
 *
 * Returns the observations to persist alongside the events, so the caller writes
 * back exactly what this evaluation compared against.
 */
export function evaluateWatchlistAlerts(
  items: WatchlistAlertInput[],
  quotes: Map<string, QuoteLite>,
  previous: Map<string, PriceObservation> = new Map(),
  now: number = Date.now(),
): AlertEvaluation {
  const out: AlertEvent[] = [];
  const observations: AlertEvaluation["observations"] = [];

  for (const it of items) {
    const key = it.symbol.toUpperCase();
    const q = quotes.get(key);
    if (!q) continue;

    const prev = previous.get(key);
    const prevPrice = prev?.lastPrice ?? null;

    if (Number.isFinite(q.price) && q.price > 0) {
      observations.push({
        symbol: key,
        price: q.price,
        changePercent: Number.isFinite(q.changePercent) ? q.changePercent : null,
      });
    }

    // Price target: `above` is a valuation/exit level, `below` a buy limit.
    // Resolved against the PREVIOUS price where one exists — resolving against
    // today's price would flip the direction of a legacy target the instant it
    // crossed, which is the bug the direction column exists to prevent.
    const direction = resolveTargetDirection(it.targetDirection, it.targetPrice, prevPrice ?? q.price);
    const crossing = detectCrossing({
      previousPrice: prevPrice,
      currentPrice: q.price,
      threshold: it.targetPrice,
      direction,
    });

    if (crossing.kind === "crossed" && it.targetPrice != null) {
      out.push({
        dedupKey: crossingDedupKey(it.symbol, it.targetPrice, direction, now),
        symbol: it.symbol,
        name: it.name,
        kind: "price_target",
        severity: "info",
        facts: {
          kind: "price_target",
          symbol: it.symbol,
          name: it.name,
          fromPrice: crossing.from,
          toPrice: crossing.to,
          price: q.price,
          targetPrice: it.targetPrice,
          direction,
          currency: q.currency ?? null,
          observedAt: q.observedAt ?? new Date(now).toISOString(),
          sessionDate: q.sessionDate ?? null,
        },
      });
    }

    // Drop alert: the day's decline crossed the threshold for the first time.
    // Session-gated: a stale quote (weekend/holiday run) is not a new decline.
    if (
      q.isCurrentSession !== false &&
      detectDropBreach({
        previousChangePercent: prev?.lastChangePercent ?? null,
        currentChangePercent: q.changePercent,
        thresholdPct: it.alertPctDrop,
      })
    ) {
      out.push({
        dedupKey: dropDedupKey(it.symbol, now),
        symbol: it.symbol,
        name: it.name,
        kind: "drop_alert",
        severity: "warning",
        facts: {
          kind: "drop_alert",
          symbol: it.symbol,
          name: it.name,
          pct: q.changePercent,
          price: q.price,
          thresholdPct: Math.abs(it.alertPctDrop!),
          currency: q.currency ?? null,
          observedAt: q.observedAt ?? new Date(now).toISOString(),
          sessionDate: q.sessionDate ?? null,
        },
      });
    }
  }
  return { events: out, observations };
}

/**
 * Portfolio alerts: any holding making a large move in the CURRENT session
 * (default ≥7%). Session-gated: on 2026-08-01/02 (a weekend) the monitor
 * re-announced Friday's AAPL close two more times because Yahoo kept serving
 * the same stale change — a quote from a finished session is never a new move.
 */
export function evaluatePortfolioAlerts(
  positions: PositionAlertInput[],
  quotes: Map<string, QuoteLite>,
  opts: { bigMovePct?: number; now?: number } = {},
): AlertEvent[] {
  const threshold = opts.bigMovePct ?? 7;
  const now = opts.now ?? Date.now();
  const out: AlertEvent[] = [];
  for (const p of positions) {
    const q = quotes.get(p.symbol.toUpperCase());
    if (!q) continue;
    if (q.isCurrentSession === false) continue;
    if (Math.abs(q.changePercent) >= threshold) {
      const up = q.changePercent >= 0;
      out.push({
        dedupKey: `pf:${p.symbol}:move`,
        symbol: p.symbol,
        name: p.name,
        kind: "big_move",
        severity: up ? "info" : "warning",
        facts: {
          kind: "big_move",
          symbol: p.symbol,
          name: p.name,
          pct: q.changePercent,
          price: q.price,
          currency: q.currency ?? null,
          observedAt: q.observedAt ?? new Date(now).toISOString(),
          sessionDate: q.sessionDate ?? null,
        },
      });
    }
  }
  return out;
}

/** Evaluate every alert source at once, returning the observations to persist. */
export function evaluateAlerts(input: {
  watchlist: WatchlistAlertInput[];
  positions: PositionAlertInput[];
  quotes: Map<string, QuoteLite>;
  /** Last observed price/change per symbol; omit on a cold start. */
  previous?: Map<string, PriceObservation>;
  bigMovePct?: number;
  now?: number;
}): AlertEvaluation {
  const watch = evaluateWatchlistAlerts(input.watchlist, input.quotes, input.previous, input.now);
  return {
    events: [
      ...watch.events,
      ...evaluatePortfolioAlerts(input.positions, input.quotes, { bigMovePct: input.bigMovePct, now: input.now }),
    ],
    observations: watch.observations,
  };
}
