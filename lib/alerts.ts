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

export interface WatchlistAlertInput {
  symbol: string;
  name: string;
  targetPrice: number | null;
  alertPctDrop: number | null;
}

export interface PositionAlertInput {
  symbol: string;
  name: string;
}

const money = (v: number, ccy?: string | null) =>
  `${ccy === "INR" ? "₹" : "$"}${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** Watchlist alerts: buy-target reached, or a defined daily drop breached. */
export function evaluateWatchlistAlerts(
  items: WatchlistAlertInput[],
  quotes: Map<string, QuoteLite>,
): AlertEvent[] {
  const out: AlertEvent[] = [];
  for (const it of items) {
    const q = quotes.get(it.symbol.toUpperCase());
    if (!q) continue;

    // Buy target: the price has fallen to (or below) the level the user is waiting for.
    if (it.targetPrice != null && q.price <= it.targetPrice) {
      out.push({
        dedupKey: `wt:${it.symbol}:target`,
        symbol: it.symbol,
        name: it.name,
        kind: "price_target",
        severity: "info",
        title: `${it.symbol} hit your target`,
        body: `${it.name} is ${money(q.price, q.currency)}, at or below your ${money(it.targetPrice, q.currency)} target.`,
      });
    }

    // Drop alert: today's move is down by at least the user's threshold.
    if (it.alertPctDrop != null && q.changePercent <= -Math.abs(it.alertPctDrop)) {
      out.push({
        dedupKey: `wt:${it.symbol}:drop`,
        symbol: it.symbol,
        name: it.name,
        kind: "drop_alert",
        severity: "warning",
        title: `${it.symbol} dropped ${signed(q.changePercent)}`,
        body: `${it.name} is down ${signed(q.changePercent)} today to ${money(q.price, q.currency)} — past your ${Math.abs(it.alertPctDrop)}% drop alert.`,
      });
    }
  }
  return out;
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

/** Evaluate every alert source at once. */
export function evaluateAlerts(input: {
  watchlist: WatchlistAlertInput[];
  positions: PositionAlertInput[];
  quotes: Map<string, QuoteLite>;
  bigMovePct?: number;
}): AlertEvent[] {
  return [
    ...evaluateWatchlistAlerts(input.watchlist, input.quotes),
    ...evaluatePortfolioAlerts(input.positions, input.quotes, { bigMovePct: input.bigMovePct }),
  ];
}
