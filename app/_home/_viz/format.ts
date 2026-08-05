/**
 * Home-dashboard formatting helpers, layered over lib/format.
 *
 * These are the signed/compact/relative-time variants the dense dashboard cards
 * lean on. They delegate to lib/format for the base rules so there is still one
 * source of truth for how a percent or a currency renders.
 */

import { formatPercent, formatCompact } from "@/lib/format";

/**
 * Signed percent, e.g. +1.2% / −0.5%. Uses a true minus sign for alignment.
 *
 * RESTRICTED (audit F-22b): for NON-SESSION quantities only — XIRR, total
 * return on cost, contribution shares, and animated count-up interpolations.
 * Anything that describes a market session ("today's move", a quote change)
 * must render through `MetricDelta` (../_viz/stamped.tsx), which carries the
 * as-of stamp and staleness treatment. New bare-number day-change call sites
 * are a regression.
 */
export function fmtSignedPct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return formatPercent(value, digits).replace("-", "−");
}

/** Signed, compact currency: +$2.3K / −$1.5K. */
export function fmtSignedMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${formatCompact(Math.abs(value))}`;
}

/** Compact currency without a forced sign: $455.3K. */
export function fmtMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `$${formatCompact(value)}`;
}

/** "2m ago", "3h ago", "5d ago" — compact relative past. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const wks = Math.round(days / 7);
  return `${wks}w ago`;
}

/** "in 3h", "in 2d", "Today" — compact countdown to a future time. */
export function countdown(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const secs = Math.round((then - Date.now()) / 1000);
  if (secs <= 0) return "now";
  const hrs = Math.round(secs / 3600);
  if (hrs < 24) return hrs <= 1 ? "Today" : `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "Tomorrow";
  if (days < 14) return `in ${days}d`;
  return `in ${Math.round(days / 7)}w`;
}
