/**
 * Stamped display atoms — the render boundary of audit F-22's as-of contract.
 *
 * These accept ONLY `Metric` values (lib/metric.ts), never bare numbers, so a
 * figure cannot reach the screen without its timestamp and basis. They exist
 * alongside the legacy primitives during the staged migration; the final F-22
 * commit deletes the bare-number variants.
 *
 * Visual language (deliberately visible, not tooltip-buried):
 * - current session  → plain figure ("today" is implicit)
 * - previous session → figure + its session date ("Fri Aug 1"), normal tone
 * - stale            → greyed figure + mandatory date, never in superlatives
 * - sinceCost/level  → no session treatment; sinceCost renders its own
 *   "since cost" suffix so P&L can never impersonate a daily move.
 */

import type { Metric } from "@/lib/metric";
import { metricSessionState } from "@/lib/metric";
import { formatPercent } from "@/lib/format";

const MINUS = "−";

function signedPct(value: number, digits = 1): string {
  const s = formatPercent(value, digits).replace("-", MINUS);
  return value > 0 ? `+${s}` : s;
}

/** "Fri, Aug 1" from a YYYY-MM-DD session date. */
export function shortSessionDate(sessionDate: string): string {
  const t = Date.parse(`${sessionDate}T12:00:00Z`);
  if (Number.isNaN(t)) return sessionDate;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t));
}

/** Compact "10:33 PM" for an as-of stamp in the viewer's local time. */
export function shortTime(asOf: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(asOf));
}

/**
 * A signed, tone-coloured percent that carries its own as-of. The stamped
 * successor to `Delta`. `digits` exists because the brief and the chips must
 * agree on precision — one default, overridden nowhere without a reason.
 */
export function MetricDelta({
  metric: m,
  digits = 1,
  className = "",
  now,
  suppressSessionLabel = false,
}: {
  metric: Metric | null;
  digits?: number;
  className?: string;
  /** Injectable for tests/screenshots; defaults to render time. */
  now?: number;
  /**
   * True when the surrounding module already carries ONE session note for all
   * its figures ("Markets closed · Fri Aug 1 close") — per-figure date labels
   * would then be noise. Stale figures keep their label regardless: a module
   * note never excuses a figure older than the note describes.
   */
  suppressSessionLabel?: boolean;
}) {
  if (m == null) return <span className={`font-mono tabular-nums text-muted ${className}`}>—</span>;

  const state = metricSessionState(m, now);
  const stale = state === "stale";
  const tone = stale
    ? "text-muted"
    : m.value > 0
      ? "text-positive"
      : m.value < 0
        ? "text-negative"
        : "text-muted";

  return (
    <span className={`inline-flex items-baseline gap-1 font-mono tabular-nums ${tone} ${className}`}>
      {signedPct(m.value, digits)}
      {m.basis === "sinceCost" ? (
        <span className="text-[0.72em] font-sans font-normal text-muted">since cost</span>
      ) : state === "previous" && m.sessionDate && !suppressSessionLabel ? (
        <span className="text-[0.72em] font-sans font-normal text-muted">{shortSessionDate(m.sessionDate)}</span>
      ) : stale ? (
        <span className="text-[0.72em] font-sans font-normal text-muted">
          {m.sessionDate ? shortSessionDate(m.sessionDate) : "undated"}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Module-header line: "Data as of 10:33 PM · Yahoo" (+ closed-market note when
 * the figures describe a finished session). Rendered once per module whose
 * figures share a snapshot; per-figure stamps then collapse to session labels.
 */
export function AsOfLine({
  asOf,
  source,
  sessionNote,
  className = "",
}: {
  asOf: number;
  source: string;
  /** e.g. "US markets closed · showing Fri Aug 1 close" */
  sessionNote?: string | null;
  className?: string;
}) {
  return (
    <span className={`text-[10px] uppercase tracking-wide text-muted ${className}`}>
      {sessionNote ? `${sessionNote} · ` : ""}as of {shortTime(asOf)} · {source}
    </span>
  );
}
