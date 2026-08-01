/**
 * Label policy for the knowledge graph. Pure, testable.
 *
 * v1 had no policy: filings rendered as "10-Q: 10-Q" (SEC descriptions are
 * frequently the form name again), event nodes carried 60-char prose while
 * companies carried bare tickers, and nothing distinguished the short label
 * the canvas draws from the full label the inspector needs.
 *
 * Policy:
 * - Asset nodes: short = display ticker, full = "TICKER (Name)".
 * - Filing events: short = "SYM 10-Q, filed 01 Aug 2025" (form deduped),
 *   full adds the SEC description only when it says something new.
 * - Other events: short = first clause of the title, clipped on a word
 *   boundary; full = the whole title.
 */

import type { TimelineEvent } from "../types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-08-01T…" -> "01 Aug 2025"; passthrough for unparseable input. */
export function formatEventDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Clip on a word boundary with a real ellipsis character, never mid-word. */
export function clipLabel(text: string, max = 44): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

const FILING_TITLE_RE = /^([A-Z0-9-]{1,10}(?:\/A)?|DEF 14A|SC 13[DG](?:\/A)?)\s*:\s*(.*)$/i;

/**
 * Detect the "<form>: <description>" shape lib/timeline.ts gives SEC filings
 * and rebuild it without the duplication. Returns null for non-filing titles.
 */
export function formatFilingLabel(event: TimelineEvent): { short: string; full: string } | null {
  if (event.source.kind !== "filing") return null;
  const match = event.title.match(FILING_TITLE_RE);
  const form = match ? match[1].toUpperCase() : event.source.description.replace(/^SEC\s+/i, "").toUpperCase();
  const description = match ? match[2].trim() : event.title.trim();
  const date = formatEventDate(event.timestamp);
  const short = `${event.symbol} ${form}, filed ${date}`;
  // Keep the description only when it is not just the form name restated.
  const redundant =
    description.length === 0 ||
    description.toUpperCase() === form ||
    description.toUpperCase() === `FORM ${form}`;
  const full = redundant ? short : `${short} - ${description}`;
  return { short, full };
}

/** Short + full label for any timeline event, applying the policy above. */
export function eventLabels(event: TimelineEvent): { short: string; full: string } {
  const filing = formatFilingLabel(event);
  if (filing) return filing;
  return { short: clipLabel(event.title), full: event.title.trim() };
}
