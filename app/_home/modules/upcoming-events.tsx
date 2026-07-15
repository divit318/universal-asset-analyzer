"use client";

/**
 * Module 8 — Upcoming Events. The next 14 days from the unified calendar
 * (earnings, dividends, economic releases) across holdings and watchlist.
 */

import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("upcoming-events");

const TYPE_TONE: Record<string, "brand" | "positive" | "warning" | "neutral"> = {
  earnings: "brand",
  dividend: "positive",
  economic: "warning",
};

function relativeDay(date: string): string {
  const days = Math.round((Date.parse(`${date}T00:00:00`) - Date.now()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function UpcomingEventsModule() {
  const state = useHomeSlice("upcomingEvents");
  const { refreshDigest } = useHome();

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={180}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.events.length === 0}
      emptyMessage="Nothing scheduled in the next two weeks."
    >
      {(d) => (
        <ul className="flex flex-col gap-2">
          {d.events.map((e) => (
            <li
              key={e.id}
              className="flex items-start justify-between gap-3 rounded-control border border-border bg-surface-2 p-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Badge variant={TYPE_TONE[e.type] ?? "neutral"}>{e.type}</Badge>
                  {e.symbol ? (
                    <Link
                      href={`/research?symbol=${encodeURIComponent(e.symbol)}`}
                      className="font-mono text-xs font-semibold text-foreground hover:text-brand"
                    >
                      {e.symbol}
                    </Link>
                  ) : null}
                </div>
                <span className="truncate text-xs text-muted">{e.name}</span>
              </div>

              <div className="flex shrink-0 flex-col items-end">
                <span className="font-mono text-xs tabular-nums text-foreground">{e.date}</span>
                <span className="text-micro text-muted">{relativeDay(e.date)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ModuleShell>
  );
}
