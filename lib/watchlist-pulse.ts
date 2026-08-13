/**
 * Watchlist Pulse — the attention model behind the watchlist's triage layer.
 *
 * ## What this module decides
 *
 * A watchlist's real job is not to display 57 rows; it is to answer "where does
 * my attention belong right now, and why?" This module is the single place that
 * question is answered. It fuses the signals UAA already produces —
 *
 * - live price against the user's own target (`lib/watchlist-metrics.ts`)
 * - alerts that actually fired (the notification table, via `lib/alerts.ts`)
 * - company developments (persisted timeline events, via `lib/timeline.ts`)
 * - earnings proximity (`lib/calendar.ts`)
 * - thesis drift (a deterministic tally over classified events, below)
 *
 * — into one explainable verdict per name: a level (`act` / `watch` / `quiet`)
 * and the list of reasons that produced it. **The reasons are the product**; the
 * numeric score exists only to rank rows and is deliberately never displayed,
 * because "attention 63" is fake precision and "crossed your $180 target, and
 * earnings are Thursday" is not.
 *
 * ## Price changed vs. something changed
 *
 * The model distinguishes the two on purpose. A daily move only registers when
 * it is large enough to be information (≥5%), while a fired alert, a target
 * crossing, or a material filing registers at any price. "Since your last
 * visit" is measured against a *visit baseline* the server rotates when the
 * user has been away (see `touchWatchlistVisit` in lib/db.ts), not against the
 * previous close — so Monday morning shows what happened since Friday's read,
 * not since midnight.
 *
 * Pure and dependency-light (types + watchlist-metrics only), so the page can
 * run it per render against live quotes and the tests can pin every threshold.
 * Unit-tested in `tests/watchlist-pulse.test.ts`.
 */

import type { TargetDirection, TimelineImpact } from "./types";
import { distanceToTargetPercent, isTargetReached, isUsablePrice } from "./watchlist-metrics";

/* -------------------------------------------------------------------------- */
/* Wire shapes — what /api/watchlist/pulse sends the page                      */
/* -------------------------------------------------------------------------- */

/** A timeline event, compacted for the pulse payload. */
export interface PulseDevelopment {
  id: string;
  title: string;
  /** ISO timestamp of the event itself. */
  timestamp: string;
  impact: TimelineImpact;
  /** Deterministic importance, 0–100 (see lib/timeline.ts). */
  importance: number;
  category: string;
  url: string | null;
  sourceKind: string;
  /** True when the event postdates the visit baseline — i.e. it is news to the user. */
  sinceBaseline: boolean;
}

/** A delivered alert, compacted for the pulse payload. */
export interface PulseNotification {
  id: number;
  title: string;
  kind: string;
  severity: "info" | "warning";
  createdAt: string;
}

/** Deterministic thesis drift — see {@link computeThesisSignal}. */
export interface ThesisSignal {
  status: "strengthening" | "weakening" | "mixed" | "quiet";
  /** Titles of the events pulling each way, strongest first (max 3 each). */
  bullish: string[];
  bearish: string[];
  eventCount: number;
  /** How far back the tally looked, in days. */
  windowDays: number;
}

/** Everything the server knows about one symbol that the live quote does not. */
export interface SymbolPulse {
  /** Price at the visit baseline; null when this is the first recorded visit. */
  baselinePrice: number | null;
  /** Recent developments (newest first, capped), with since-baseline flags. */
  developments: PulseDevelopment[];
  /** Alerts delivered for this symbol since the baseline. */
  notifications: PulseNotification[];
  /** Next earnings date (YYYY-MM-DD), when the calendar knows one. */
  earningsDate: string | null;
  thesisSignal: ThesisSignal | null;
  /** Epoch-ms of the last news/filings check for this symbol; null = never. */
  developmentsCheckedAt: number | null;
}

export interface WatchlistPulse {
  generatedAt: number;
  /** Epoch-ms the "since your last visit" window opens at. */
  baselineAt: number;
  /** True on the very first visit — there is no baseline to diff against yet. */
  firstVisit: boolean;
  symbols: Record<string, SymbolPulse>;
  /** Symbols whose developments are being checked in the background right now. */
  checking: string[];
}

/* -------------------------------------------------------------------------- */
/* Thresholds — named, documented, pinned by tests                             */
/* -------------------------------------------------------------------------- */

/** A daily move smaller than this is routine market noise, not information. */
export const BIG_MOVE_PCT = 5;
/** A move since the last visit registers at this magnitude (multi-day drift). */
export const SINCE_VISIT_MOVE_PCT = 8;
/** "Approaching" a target means within this distance of it. */
export const TARGET_NEAR_PCT = 5;
/** Earnings inside this window are worth surfacing. */
export const EARNINGS_SOON_DAYS = 7;
/** A development below this importance never drives attention on its own. */
export const DEVELOPMENT_MIN_IMPORTANCE = 60;
/** A thesis unreviewed for this long counts as stale in the health check. */
export const STALE_REVIEW_DAYS = 90;
/** Thesis drift looks back at most this far. */
export const THESIS_WINDOW_DAYS = 60;

/* -------------------------------------------------------------------------- */
/* Attention                                                                   */
/* -------------------------------------------------------------------------- */

export type AttentionLevel = "act" | "watch" | "quiet";

export type AttentionSignalKind =
  | "target_crossed"
  | "alert_fired"
  | "target_approaching"
  | "big_move"
  | "moved_since_visit"
  | "earnings_soon"
  | "development"
  | "thesis_signal";

export interface AttentionSignal {
  kind: AttentionSignalKind;
  /** Short chip text, e.g. "Target reached", "Earnings in 2d". */
  label: string;
  /** One sentence of evidence, e.g. the alert title or the event headline. */
  detail: string | null;
  weight: number;
  tone: "positive" | "negative" | "warning" | "neutral";
}

export interface AttentionResult {
  level: AttentionLevel;
  /** Ranking key only — never displayed. */
  score: number;
  /** Strongest first. */
  signals: AttentionSignal[];
}

/**
 * The two thresholds that are genuinely a matter of taste rather than of
 * correctness, overridable from the watchlist's view settings. Everything else
 * (crossing rules, materiality bars) stays fixed — configurable correctness is
 * just a bug with a preferences UI.
 */
export interface AttentionThresholds {
  /** Overrides {@link BIG_MOVE_PCT}. */
  bigMovePct?: number;
  /** Overrides {@link EARNINGS_SOON_DAYS}. */
  earningsSoonDays?: number;
}

export interface AttentionInput {
  price: number | null;
  /** Today's move vs previous close, percent. */
  changePercent: number | null;
  targetPrice: number | null;
  direction: TargetDirection;
  /** Server-side context; null while the pulse is still loading. */
  pulse: SymbolPulse | null;
  thresholds?: AttentionThresholds;
  now?: number;
}

const QUIET: AttentionResult = { level: "quiet", score: 0, signals: [] };

/** Whole calendar days from `now` to a YYYY-MM-DD date; null when unparseable. */
export function daysUntil(date: string | null | undefined, now: number = Date.now()): number | null {
  if (!date) return null;
  const then = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(then)) return null;
  const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
  return dayOf(then) - dayOf(now);
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * The attention verdict for one row.
 *
 * Levels are driven by the strongest signal, not just the sum: one target
 * crossing outranks three routine chips, which is what keeps a busy tape from
 * promoting everything to "act". Signals are additive within a level so a name
 * with a crossed target *and* fresh developments ranks above one with only the
 * crossing.
 */
export function computeAttention(input: AttentionInput): AttentionResult {
  const { price, changePercent, targetPrice, direction, pulse } = input;
  const now = input.now ?? Date.now();
  const bigMovePct = input.thresholds?.bigMovePct ?? BIG_MOVE_PCT;
  const earningsSoonDays = input.thresholds?.earningsSoonDays ?? EARNINGS_SOON_DAYS;
  const signals: AttentionSignal[] = [];

  /* -- The user's own levels: the highest-authority signals on the page. ---- */

  if (isUsablePrice(price) && isUsablePrice(targetPrice)) {
    if (isTargetReached(price, targetPrice, direction)) {
      signals.push({
        kind: "target_crossed",
        label: "Target reached",
        detail:
          direction === "below"
            ? "Trading at or below your buy level."
            : "Trading at or above your exit level.",
        weight: 40,
        // A buy limit being hit is the moment the user was waiting for; an exit
        // target is a decision point, not necessarily good news.
        tone: direction === "below" ? "positive" : "warning",
      });
    } else {
      const dist = distanceToTargetPercent(price, targetPrice, direction);
      if (dist != null && dist <= TARGET_NEAR_PCT) {
        signals.push({
          kind: "target_approaching",
          label: `${dist.toFixed(1)}% from target`,
          detail: `Needs ${direction === "below" ? "a fall" : "a rise"} of ${dist.toFixed(1)}% to reach your level.`,
          weight: 22,
          tone: "warning",
        });
      }
    }
  }

  /* -- Alerts that actually fired (existing notification infrastructure). --- */

  const fired = pulse?.notifications ?? [];
  if (fired.length > 0) {
    signals.push({
      kind: "alert_fired",
      label: fired.length === 1 ? "Alert fired" : `${fired.length} alerts fired`,
      detail: fired[0].title,
      weight: 30,
      tone: fired.some((n) => n.severity === "warning") ? "negative" : "warning",
    });
  }

  /* -- Price as information, not noise. ------------------------------------- */

  if (changePercent != null && Math.abs(changePercent) >= bigMovePct) {
    signals.push({
      kind: "big_move",
      label: `${pct(changePercent)} today`,
      detail: null,
      weight: Math.abs(changePercent) >= bigMovePct + 3 ? 26 : 18,
      tone: changePercent > 0 ? "positive" : "negative",
    });
  }

  if (isUsablePrice(price) && isUsablePrice(pulse?.baselinePrice)) {
    const sinceVisit = ((price - pulse!.baselinePrice!) / pulse!.baselinePrice!) * 100;
    // Only reported when it is NOT just today's move wearing a second hat.
    const isRedundant =
      changePercent != null && Math.abs(sinceVisit - changePercent) < 1;
    if (Math.abs(sinceVisit) >= SINCE_VISIT_MOVE_PCT && !isRedundant) {
      signals.push({
        kind: "moved_since_visit",
        label: `${pct(sinceVisit)} since your last visit`,
        detail: null,
        weight: 15,
        tone: sinceVisit > 0 ? "positive" : "negative",
      });
    }
  }

  /* -- What changed in the company, not the ticker. -------------------------- */

  const material = (pulse?.developments ?? []).filter(
    (d) => d.sinceBaseline && d.importance >= DEVELOPMENT_MIN_IMPORTANCE,
  );
  if (material.length > 0) {
    signals.push({
      kind: "development",
      label: material.length === 1 ? "New development" : `${material.length} new developments`,
      detail: material[0].title,
      weight: Math.min(24, 10 + material.length * 4),
      tone:
        material.every((d) => d.impact === "bullish") ? "positive"
        : material.every((d) => d.impact === "bearish") ? "negative"
        : "neutral",
    });
  }

  const inDays = daysUntil(pulse?.earningsDate, now);
  if (inDays != null && inDays >= 0 && inDays <= earningsSoonDays) {
    signals.push({
      kind: "earnings_soon",
      label: inDays === 0 ? "Earnings today" : inDays === 1 ? "Earnings tomorrow" : `Earnings in ${inDays}d`,
      detail: null,
      weight: inDays <= 2 ? 20 : 12,
      tone: "warning",
    });
  }

  const drift = pulse?.thesisSignal;
  if (drift && (drift.status === "strengthening" || drift.status === "weakening")) {
    signals.push({
      kind: "thesis_signal",
      label: drift.status === "strengthening" ? "Thesis strengthening" : "Thesis weakening",
      detail: (drift.status === "strengthening" ? drift.bullish : drift.bearish)[0] ?? null,
      weight: 14,
      tone: drift.status === "strengthening" ? "positive" : "negative",
    });
  }

  if (signals.length === 0) return QUIET;

  signals.sort((a, b) => b.weight - a.weight);
  const score = signals.reduce((n, s) => n + s.weight, 0);
  const strongest = signals[0].weight;
  const level: AttentionLevel = strongest >= 30 || score >= 45 ? "act" : score >= 15 ? "watch" : "quiet";
  return { level, score, signals };
}

/* -------------------------------------------------------------------------- */
/* Thesis drift                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic thesis drift: an importance-weighted tally of classified events
 * since the user last reviewed the name (capped at {@link THESIS_WINDOW_DAYS}).
 *
 * Deliberately NOT an AI verdict, and deliberately never "invalidated": the
 * events carry deterministic impact labels from `lib/timeline.ts`, so the
 * honest claim this can make is "the recent evidence leans this way — here it
 * is", leaving the judgment to the person who wrote the thesis. One-sided
 * evidence needs at least two events and a 2:1 weight ratio to move off
 * "mixed"; anything thinner is reported as what it is.
 */
export function computeThesisSignal(
  events: Array<Pick<PulseDevelopment, "title" | "timestamp" | "impact" | "importance">>,
  sinceMs: number,
  now: number = Date.now(),
): ThesisSignal {
  const windowStart = Math.max(sinceMs, now - THESIS_WINDOW_DAYS * 86_400_000);
  const windowDays = Math.max(1, Math.round((now - windowStart) / 86_400_000));

  const relevant = events
    .filter((e) => {
      const t = Date.parse(e.timestamp);
      return Number.isFinite(t) && t >= windowStart && e.importance >= 45 && e.impact !== "neutral";
    })
    .sort((a, b) => b.importance - a.importance);

  const bullish = relevant.filter((e) => e.impact === "bullish");
  const bearish = relevant.filter((e) => e.impact === "bearish");
  const bullWeight = bullish.reduce((n, e) => n + e.importance, 0);
  const bearWeight = bearish.reduce((n, e) => n + e.importance, 0);

  const base = {
    bullish: bullish.slice(0, 3).map((e) => e.title),
    bearish: bearish.slice(0, 3).map((e) => e.title),
    eventCount: relevant.length,
    windowDays,
  };

  if (relevant.length === 0) return { status: "quiet", ...base };
  if (relevant.length >= 2 && bullWeight >= bearWeight * 2) return { status: "strengthening", ...base };
  if (relevant.length >= 2 && bearWeight >= bullWeight * 2) return { status: "weakening", ...base };
  return { status: "mixed", ...base };
}

/* -------------------------------------------------------------------------- */
/* Since-last-visit summary                                                    */
/* -------------------------------------------------------------------------- */

/** Aggregate counts for the triage header line. */
export interface SinceVisitSummary {
  act: number;
  watch: number;
  quiet: number;
  targetsCrossed: number;
  alertsFired: number;
  newDevelopments: number;
  earningsSoon: number;
}

export function summarizeSinceVisit(results: AttentionResult[]): SinceVisitSummary {
  const summary: SinceVisitSummary = {
    act: 0,
    watch: 0,
    quiet: 0,
    targetsCrossed: 0,
    alertsFired: 0,
    newDevelopments: 0,
    earningsSoon: 0,
  };
  for (const r of results) {
    summary[r.level] += 1;
    for (const s of r.signals) {
      if (s.kind === "target_crossed") summary.targetsCrossed += 1;
      else if (s.kind === "alert_fired") summary.alertsFired += 1;
      else if (s.kind === "development") summary.newDevelopments += 1;
      else if (s.kind === "earnings_soon") summary.earningsSoon += 1;
    }
  }
  return summary;
}

/* -------------------------------------------------------------------------- */
/* Watchlist health                                                            */
/* -------------------------------------------------------------------------- */

export interface WatchlistHealth {
  total: number;
  /** Names with no written thesis. */
  noThesis: number;
  /** Names with no price target — nothing for the alert engine to watch. */
  noTarget: number;
  /** Names whose thesis has not been reviewed in {@link STALE_REVIEW_DAYS}. */
  staleReview: number;
}

export interface HealthInput {
  notes: string | null;
  targetPrice: number | null;
  /** Epoch-ms of the last explicit review; null = never reviewed. */
  lastReviewedAt: number | null;
  addedAt: string;
}

/**
 * A written-up thesis whose last review is older than {@link STALE_REVIEW_DAYS}.
 * Only a thesis can go stale — an empty row is a different (noThesis) problem.
 * A name never explicitly reviewed counts from the day it was added.
 */
export function isStaleReview(item: HealthInput, now: number = Date.now()): boolean {
  const hasThesis = item.notes != null && item.notes.trim().length > 0;
  if (!hasThesis) return false;
  const reviewedAt = item.lastReviewedAt ?? Date.parse(item.addedAt);
  return Number.isFinite(reviewedAt) && reviewedAt < now - STALE_REVIEW_DAYS * 86_400_000;
}

/**
 * The list's own maintenance state. A watchlist decays silently — theses go
 * stale, targets outlive their reasoning — and the honest response is to say
 * so, not to keep rendering rows as though they were all equally considered.
 */
export function computeWatchlistHealth(items: HealthInput[], now: number = Date.now()): WatchlistHealth {
  let noThesis = 0;
  let noTarget = 0;
  let staleReview = 0;
  for (const item of items) {
    if (!(item.notes != null && item.notes.trim().length > 0)) noThesis += 1;
    if (item.targetPrice == null) noTarget += 1;
    if (isStaleReview(item, now)) staleReview += 1;
  }
  return { total: items.length, noThesis, noTarget, staleReview };
}
