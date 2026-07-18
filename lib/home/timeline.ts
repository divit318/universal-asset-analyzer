/**
 * Timeline & Intelligence — the two event feeds.
 *
 * One builder produces both, because they are two *views* of the same merged
 * stream rather than two independent data sources (which would be exactly the
 * redundancy the redesign asks us to collapse):
 *
 *   - **Timeline** — the full chronological record: what you did (activity
 *     visits), what fired (notifications, watchlist alerts), and what's coming
 *     (calendar events, shown with a countdown). Answers "what happened?".
 *   - **Intelligence** — the high-signal subset that still needs a decision:
 *     unread warning-severity notifications and live watchlist alerts, newest
 *     first. Answers "what should I look at right now?".
 *
 * Composition only — no scoring, no fetching. Every item is read from a source
 * that already exists in the digest build.
 *
 * Pure. Unit-tested in tests/home-timeline.test.ts.
 */

import type { Notification, WatchlistAlert } from "../types";
import type {
  ActivityEntry,
  TimelineFeed,
  TimelineItem,
  TimelineTone,
  UpcomingEventLite,
} from "./contracts";

const ACTIVITY_LABEL: Record<string, string> = {
  research: "Researched",
  screen: "Screened",
  report: "Report",
  portfolio: "Portfolio",
  watchlist: "Watchlist",
  compare: "Compared",
};

/** Classifies a notification's tone from its severity and a few word cues. */
function notificationTone(n: Notification): TimelineTone {
  if (n.severity === "warning") return "warning";
  const t = `${n.title} ${n.body}`.toLowerCase();
  if (/\b(beat|upgrade|gain|surge|rally|above|hit target)\b/.test(t)) return "positive";
  if (/\b(miss|downgrade|loss|drop|fell|below|breach)\b/.test(t)) return "negative";
  return "neutral";
}

function alertTone(a: WatchlistAlert): TimelineTone {
  return a.severity === "high" ? "negative" : a.severity === "medium" ? "warning" : "neutral";
}

/** Earnings/dividend events lean neutral; the countdown carries the urgency. */
function eventTone(type: string): TimelineTone {
  return /div/i.test(type) ? "positive" : "neutral";
}

export interface TimelineInputs {
  activity: ActivityEntry[];
  notifications: Notification[];
  watchlistAlerts: WatchlistAlert[];
  upcomingEvents: UpcomingEventLite[];
}

export function buildTimelineFeeds(inputs: TimelineInputs): { timeline: TimelineFeed; intelligence: TimelineFeed } {
  const nowMs = Date.now();
  const items: TimelineItem[] = [];

  for (const a of inputs.activity) {
    items.push({
      id: `tl-act-${a.kind}-${a.ref}`,
      kind: "activity",
      title: `${ACTIVITY_LABEL[a.kind] ?? "Opened"} ${a.label}`,
      detail: null,
      at: a.at,
      upcoming: false,
      tone: "neutral",
      symbol: a.kind === "research" ? a.ref.toUpperCase() : null,
      href: a.href,
    });
  }

  for (const n of inputs.notifications) {
    items.push({
      id: `tl-notif-${n.id}`,
      kind: "notification",
      title: n.title,
      detail: n.body || null,
      at: n.createdAt,
      upcoming: false,
      tone: notificationTone(n),
      symbol: n.symbol,
      href: n.symbol ? `/research?symbol=${encodeURIComponent(n.symbol)}` : null,
    });
  }

  // Watchlist alerts have no timestamp of their own — they describe a *current*
  // condition, so they sit at "now" in the merge.
  const nowIso = new Date(nowMs).toISOString();
  for (const a of inputs.watchlistAlerts) {
    items.push({
      id: `tl-alert-${a.symbol}-${a.type}`,
      kind: "alert",
      title: `${a.symbol}: ${a.title}`,
      detail: a.description,
      at: nowIso,
      upcoming: false,
      tone: alertTone(a),
      symbol: a.symbol,
      href: `/watchlist`,
    });
  }

  for (const e of inputs.upcomingEvents) {
    // Calendar dates are date-only; anchor to market-ish midday so a same-day
    // event doesn't read as already past.
    const at = `${e.date}T12:00:00.000Z`;
    items.push({
      id: `tl-evt-${e.id}`,
      kind: "event",
      title: e.symbol ? `${e.symbol} — ${e.name}` : e.name,
      detail: e.type,
      at,
      upcoming: Date.parse(at) > nowMs,
      tone: eventTone(e.type),
      symbol: e.symbol ?? null,
      href: "/calendar",
    });
  }

  // Chronological: upcoming events nearest-first at the top, then history newest-first.
  const sorted = items.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.upcoming
      ? Date.parse(a.at) - Date.parse(b.at) // soonest upcoming first
      : Date.parse(b.at) - Date.parse(a.at); // most recent past first
  });

  const timeline: TimelineFeed = {
    status: sorted.length > 0 ? "ok" : "empty",
    items: sorted.slice(0, 12),
  };

  // Intelligence: the decision-worthy subset. Unread warnings and live alerts,
  // most-recent first, deduped against the same ordering.
  const highSignal = sorted
    .filter((it) => it.kind === "alert" || (it.kind === "notification" && it.tone === "warning"))
    .slice(0, 8);

  const intelligence: TimelineFeed = {
    status: highSignal.length > 0 ? "ok" : "empty",
    items: highSignal,
  };

  return { timeline, intelligence };
}
