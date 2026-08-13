"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { TimelineEvent, TimelineImpact } from "@/lib/types";
import { LoadingPanel } from "@/app/_components/loading-panel";
import { Reveal } from "@/app/_components/reveal";

/**
 * Investment Timeline, embedded as a compact preview (top milestones) rather
 * than the full VisualTimeline — reuses /api/timeline as-is (same feed the
 * /intelligence Timeline view reads) and links out for the full history.
 */

const IMPACT_DOT: Record<TimelineImpact, string> = {
  bullish: "bg-positive",
  bearish: "bg-negative",
  neutral: "bg-muted/50",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function TimelinePreviewCard({
  symbol,
  onLoaded,
}: {
  symbol: string;
  /** Lets WhyNowCard reuse the most recent milestone's headline without a second fetch. */
  onLoaded?: (mostRecent: TimelineEvent | null) => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    void fetch(`/api/timeline?scope=symbol&id=${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const evts: TimelineEvent[] = data?.events ?? [];
        setEvents(evts);
        const mostRecent = [...evts].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0] ?? null;
        onLoaded?.(mostRecent);
      })
      .catch(() => { if (!cancelled) { setEvents([]); onLoaded?.(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  if (loading) return <LoadingPanel height="h-24" markSize={18} />;
  if (events.length === 0) return null;

  const topEvents = [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  return (
    <div className="card-lift flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Investment Timeline</h3>
        <Link
          href={`/journal?symbol=${encodeURIComponent(symbol)}`}
          className="text-xs text-accent hover:underline"
        >
          Open in Journal →
        </Link>
      </div>
      <ul className="flex flex-col gap-2.5">
        {topEvents.map((e, i) => (
          <Reveal key={e.id} as="li" index={i} className="flex items-start gap-2.5">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${IMPACT_DOT[e.impact]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium leading-5 text-foreground">{e.title}</p>
              <p className="text-[10px] text-muted">{formatDate(e.timestamp)} · {e.category.replace(/_/g, " ")}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </div>
  );
}
