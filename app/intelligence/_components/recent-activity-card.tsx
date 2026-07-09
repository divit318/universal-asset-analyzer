"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, SectionHeader } from "@/app/_components/ui";
import type { MissionControlDigest } from "@/lib/mission-control";
import type { TimelineEvent, TimelineImpact } from "@/lib/types";

const IMPACT_DOT: Record<TimelineImpact, string> = {
  bullish: "bg-positive",
  bearish: "bg-negative",
  neutral: "bg-muted/50",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Compact Timeline preview scoped to the user's portfolio or watchlist — same feed as the full Timeline view. */
export function RecentActivityCard({ scope }: { scope: MissionControlDigest["recentActivityScope"] }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(scope.scope !== "none");

  useEffect(() => {
    if (scope.scope === "none") return;
    let cancelled = false;
    fetch(`/api/timeline?scope=${scope.scope}&id=${encodeURIComponent(scope.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setEvents(data?.events ?? []); })
      .catch(() => { if (!cancelled) setEvents([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope.scope, scope.id]);

  const topEvents = [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  return (
    <Card padding="lg" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Recent Activity" />
        {scope.scope !== "none" && (
          <Link
            href={`/intelligence?view=timeline&scope=${scope.scope}&id=${encodeURIComponent(scope.id)}`}
            className="shrink-0 text-xs text-brand hover:underline"
          >
            Full timeline →
          </Link>
        )}
      </div>
      {scope.scope === "none" ? (
        <p className="text-sm text-muted">Add a holding or watchlist symbol to see relevant market activity.</p>
      ) : loading ? (
        <div className="h-20 animate-pulse rounded-lg bg-surface-2" />
      ) : topEvents.length === 0 ? (
        <p className="text-sm text-muted">No recent events tracked yet.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {topEvents.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${IMPACT_DOT[e.impact]}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium leading-5 text-foreground">{e.title}</p>
                <p className="text-[10px] text-muted">{formatDate(e.timestamp)} · {e.category.replace(/_/g, " ")}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
