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

export interface AlertEvent {
  /** Stable identity used to avoid re-firing the same alert (see 24h dedup). */
  dedupKey: string;
  symbol: string;
  name: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
}

/** The slice of a live quote the evaluator needs. */
export interface QuoteLite {
  price: number;
  changePercent: number; // today's % change
  currency?: string | null;
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
      const verb = direction === "above" ? "rose to" : "fell to";
      out.push({
        dedupKey: crossingDedupKey(it.symbol, it.targetPrice, direction, now),
        symbol: it.symbol,
        name: it.name,
        kind: "price_target",
        severity: "info",
        title: `${it.symbol} crossed your target`,
        body: `${it.name} ${verb} ${money(crossing.to, q.currency)} from ${money(crossing.from, q.currency)}, ${
          direction === "above" ? "reaching" : "dropping to"
        } your ${money(it.targetPrice, q.currency)} target.`,
      });
    }

    // Drop alert: today's decline crossed the threshold for the first time today.
    if (
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
        title: `${it.symbol} dropped ${signed(q.changePercent)}`,
        body: `${it.name} is down ${signed(q.changePercent)} today to ${money(q.price, q.currency)} — past your ${Math.abs(it.alertPctDrop!)}% drop alert.`,
      });
    }
  }
  return { events: out, observations };
}

/** Portfolio alerts: any holding making a large move today (default ≥7%). */
export function evaluatePortfolioAlerts(
  positions: PositionAlertInput[],
  quotes: Map<string, QuoteLite>,
  opts: { bigMovePct?: number } = {},
): AlertEvent[] {
  const threshold = opts.bigMovePct ?? 7;
  const out: AlertEvent[] = [];
  for (const p of positions) {
    const q = quotes.get(p.symbol.toUpperCase());
    if (!q) continue;
    if (Math.abs(q.changePercent) >= threshold) {
      const up = q.changePercent >= 0;
      out.push({
        dedupKey: `pf:${p.symbol}:move`,
        symbol: p.symbol,
        name: p.name,
        kind: "big_move",
        severity: up ? "info" : "warning",
        title: `${p.symbol} ${up ? "up" : "down"} ${signed(q.changePercent)}`,
        body: `Your ${p.name} position moved ${signed(q.changePercent)} today to ${money(q.price, q.currency)}.`,
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
      ...evaluatePortfolioAlerts(input.positions, input.quotes, { bigMovePct: input.bigMovePct }),
    ],
    observations: watch.observations,
  };
}
