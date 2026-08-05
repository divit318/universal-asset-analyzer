/**
 * A number that knows where it came from and when — the type-level half of
 * audit F-22's fix.
 *
 * The homepage once showed three different "AAPL today" figures because bare
 * numbers carry no as-of time and no basis: a since-cost return, a five-day-old
 * intraday print, and a stale Friday close all rendered identically. A `Metric`
 * cannot lose that context, and the stamped display primitives
 * (app/_home/_viz/) accept ONLY Metrics — so a figure without a timestamp is a
 * compile error at the render boundary, not a discipline problem.
 *
 * `basis` is a type parameter so a surface can demand the right quantity:
 * a function typed `(m: Metric<"day">)` will not accept a since-cost return.
 *
 * Pure, zero-dependency, client-safe.
 */

import type { DataSourceId } from "./provenance";

/** What a metric measures against. Distinct bases are NOT interchangeable. */
export type MetricBasis =
  /** vs the previous official close — "today's move" (only when current session). */
  | "day"
  /** vs the position's average cost — P&L, not a daily move. */
  | "sinceCost"
  /** vs a dated earlier close — an N-session window return. */
  | "window"
  /** a point-in-time level (price, score, ratio) rather than a change. */
  | "level";

export interface Metric<B extends MetricBasis = MetricBasis> {
  value: number;
  basis: B;
  /** Epoch ms of the source data this value was computed from. */
  asOf: number;
  /** Where the underlying data came from (lib/provenance registry). */
  source: DataSourceId;
  /**
   * Calendar day (exchange TZ) of the session this value describes, when it
   * describes one — lets the UI say "today" vs "Fri, Aug 1" honestly.
   * Undefined for non-session quantities (sinceCost, level).
   */
  sessionDate?: string | null;
}

/** Construct a Metric. Throws on a non-finite value — a NaN with a timestamp is still a lie. */
export function metric<B extends MetricBasis>(
  value: number,
  basis: B,
  asOf: number,
  source: DataSourceId,
  sessionDate?: string | null,
): Metric<B> {
  if (!Number.isFinite(value)) throw new Error(`metric(): non-finite value for ${basis}`);
  return { value, basis, asOf, source, ...(sessionDate !== undefined ? { sessionDate } : {}) };
}

/** Nullable convenience: null in, null out. */
export function maybeMetric<B extends MetricBasis>(
  value: number | null | undefined,
  basis: B,
  asOf: number,
  source: DataSourceId,
  sessionDate?: string | null,
): Metric<B> | null {
  if (value == null || !Number.isFinite(value)) return null;
  return metric(value, basis, asOf, source, sessionDate);
}

/* ------------------------------------------------------------------ */
/* Staleness — audit F-22(d)'s policy, computed from the stamp         */
/* ------------------------------------------------------------------ */

/**
 * How a session-based metric relates to the viewer's calendar day:
 * - "current"  — describes today's session; may be called "today"
 * - "previous" — the immediately preceding session (incl. across a weekend);
 *   shown normally but labelled with its date
 * - "stale"    — older than that; greyed, date label mandatory, and
 *   disqualified from any "today" superlative
 * - null       — not a session quantity (sinceCost, level); no freshness dot
 */
export type MetricSessionState = "current" | "previous" | "stale" | null;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Session state from the metric's stamped session date. The comparison uses
 * the viewer's calendar day; a ≤3-day gap counts as "previous" so a Friday
 * close reads as the previous session throughout the weekend rather than
 * flapping to stale on Saturday.
 */
/** YYYY-MM-DD of `now` in the runtime's local timezone. */
function localDate(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function metricSessionState(
  m: Pick<Metric, "basis" | "sessionDate" | "asOf">,
  now: number = Date.now(),
): MetricSessionState {
  if (m.basis === "sinceCost" || m.basis === "level") return null;
  const session = m.sessionDate;
  if (!session) return "stale"; // undated session data is untrusted by policy
  const gapDays = Math.round((Date.parse(localDate(now)) - Date.parse(session)) / DAY_MS);
  if (gapDays <= 0) return "current";
  if (gapDays <= 3) return "previous";
  return "stale";
}
