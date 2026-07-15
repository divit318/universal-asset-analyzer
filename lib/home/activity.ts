/**
 * Module 10 — Continue Where You Left Off.
 *
 * The /intelligence "recent activity" card this replaces showed *timeline
 * events* — market news about your holdings — which is a different thing from
 * where you personally left off. It answered "what happened to my stocks" (a
 * question three other modules already answer) rather than "what was I doing".
 *
 * This is backed by a real visit log (the `activity` table, upserted per
 * kind+ref), so it can honestly say "you were researching NVDA on Tuesday".
 * Pages record their own visits via `POST /api/home/activity`, fire-and-forget.
 */

import { listActivity } from "../db";
import type { ActivityEntry, ActivityKind, RecentActivity } from "./contracts";

const VALID_KINDS: ActivityKind[] = ["research", "screen", "report", "portfolio", "watchlist", "compare"];

export function isActivityKind(v: string): v is ActivityKind {
  return (VALID_KINDS as string[]).includes(v);
}

export function buildRecentActivity(limit = 6): RecentActivity {
  let rows;
  try {
    rows = listActivity(limit);
  } catch {
    return { status: "degraded", entries: [] };
  }

  const entries: ActivityEntry[] = rows
    .filter((r) => isActivityKind(r.kind))
    .map((r, i) => ({
      id: i,
      kind: r.kind as ActivityKind,
      ref: r.ref,
      label: r.label,
      href: r.href,
      at: r.at,
    }));

  return { status: entries.length > 0 ? "ok" : "empty", entries };
}
