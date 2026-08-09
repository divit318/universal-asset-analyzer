/**
 * Home telemetry: the event vocabulary and the pure calibration read view
 * (audit 13, IN-05 step 5).
 *
 * Mirrors how lib/ai/telemetry.ts aggregates over listAiCalls: lib/db.ts owns
 * the rows, this module owns the math, and everything here is a pure function
 * over already-fetched events so it unit-tests without a database.
 *
 * The one that matters is computeQueueCalibration: the priority score has had
 * zero ground truth since it shipped (IN-02), so the SCORE_EXPONENTS in
 * lib/home/attention.ts are untunable in principle. Acted-vs-suppressed rates
 * per score decile ARE that ground truth; a future re-fit of the exponents or
 * a re-anchoring of the priority bands consumes this output directly without
 * re-reading raw events.
 */

import type { HomeEventRecord } from "@/lib/db";

/**
 * The full event vocabulary, shared by the route's allowlist and the client
 * hook's types. Anything not listed here is dropped at the route, so a typo'd
 * emitter fails visibly in review, not silently in the ledger.
 */
export const HOME_EVENT_NAMES = [
  /** Once per page load. The denominator for every per-visit rate. */
  "page_visit",
  /** A queue row's primary link was followed (click or Enter). */
  "queue_item_acted",
  /** A queue row was suppressed: mode is dismiss, snooze, done, or mute. */
  "queue_item_suppressed",
  /** A suppression was undone from its toast. */
  "queue_undo",
  /** The Log decision popover saved a journal entry (AG-09). */
  "decision_logged",
  /** The Morning note disclosure opened (whats-changed.tsx). */
  "brief_note_expanded",
  /** The delta details disclosure opened (whats-changed.tsx). */
  "changes_expanded",
] as const;

export type HomeEventName = (typeof HOME_EVENT_NAMES)[number];

export function isHomeEventName(value: unknown): value is HomeEventName {
  return typeof value === "string" && (HOME_EVENT_NAMES as readonly string[]).includes(value);
}

/** One score decile of outcomes. actedRate is null when the decile is empty: an
 *  unmeasured band must never read as a measured 0%. */
export interface DecileCalibration {
  /** 0..9 - floor(score / 10), scores of 100 clamp into decile 9. */
  decile: number;
  n: number;
  acted: number;
  suppressed: number;
  actedRate: number | null;
}

export interface KindCalibration {
  kind: string;
  n: number;
  acted: number;
  suppressed: number;
  actedRate: number | null;
}

export interface QueueCalibration {
  deciles: DecileCalibration[];
  kinds: KindCalibration[];
  totals: { n: number; acted: number; suppressed: number };
}

function numberProp(props: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = props?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringProp(props: Record<string, unknown> | null | undefined, key: string): string | null {
  const v = props?.[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Acted-vs-suppressed rates per score decile and per kind, from raw
 * queue_item_acted / queue_item_suppressed events (any other event in the
 * input is ignored, so callers can pass an unfiltered listHomeEvents() page).
 *
 * "Acted" and "suppressed" are treated as the two OUTCOMES of a surfaced item:
 * an undo does not subtract here because the item then re-enters the queue and
 * its eventual outcome is a later event. Rows without a finite score are
 * skipped rather than guessed into decile 0.
 */
export function computeQueueCalibration(events: HomeEventRecord[]): QueueCalibration {
  const deciles: DecileCalibration[] = Array.from({ length: 10 }, (_, decile) => ({
    decile,
    n: 0,
    acted: 0,
    suppressed: 0,
    actedRate: null,
  }));
  const byKind = new Map<string, KindCalibration>();
  let acted = 0;
  let suppressed = 0;

  for (const e of events) {
    const isActed = e.event === "queue_item_acted";
    const isSuppressed = e.event === "queue_item_suppressed";
    if (!isActed && !isSuppressed) continue;

    const score = numberProp(e.props, "score");
    if (score != null) {
      const d = deciles[Math.max(0, Math.min(9, Math.floor(score / 10)))];
      d.n += 1;
      if (isActed) d.acted += 1;
      else d.suppressed += 1;
    }

    const kind = stringProp(e.props, "kind");
    if (kind != null) {
      let k = byKind.get(kind);
      if (!k) {
        k = { kind, n: 0, acted: 0, suppressed: 0, actedRate: null };
        byKind.set(kind, k);
      }
      k.n += 1;
      if (isActed) k.acted += 1;
      else k.suppressed += 1;
    }

    if (isActed) acted += 1;
    else suppressed += 1;
  }

  for (const d of deciles) d.actedRate = d.n > 0 ? d.acted / d.n : null;
  const kinds = [...byKind.values()]
    .map((k) => ({ ...k, actedRate: k.n > 0 ? k.acted / k.n : null }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return { deciles, kinds, totals: { n: acted + suppressed, acted, suppressed } };
}
