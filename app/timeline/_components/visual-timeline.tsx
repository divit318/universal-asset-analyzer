"use client";

import type { TimelineEvent } from "@/lib/types";
import { EventCard } from "./event-card";

function groupByMonth(events: TimelineEvent[]): { label: string; items: TimelineEvent[] }[] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const key = event.timestamp.slice(0, 7); // YYYY-MM
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(event);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => {
      const [year, month] = key.split("-");
      const label = new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
      return { label, items };
    });
}

export function VisualTimeline({
  events,
  showSymbol,
  onSelect,
}: {
  events: TimelineEvent[];
  showSymbol?: boolean;
  onSelect: (event: TimelineEvent) => void;
}) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
        <span className="text-2xl">◇</span>
        <p className="text-sm text-muted">No events match the current filters.</p>
        <p className="text-xs text-muted/60">Try widening the date range or clearing a filter.</p>
      </div>
    );
  }

  const groups = groupByMonth(events);

  return (
    <div className="relative flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.label} className="relative flex flex-col gap-3">
          <div className="sticky top-16 z-10 -mx-1 flex items-center gap-3 bg-background/90 px-1 py-1 backdrop-blur-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">{group.label}</h2>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
          <div className="relative flex flex-col gap-3 border-l border-border pl-5 sm:pl-6">
            {group.items.map((event) => (
              <div key={event.id} className="relative">
                <span
                  className="absolute -left-[26px] top-5 h-2 w-2 rounded-full border-2 border-background bg-border sm:-left-[30px]"
                  aria-hidden="true"
                />
                <EventCard event={event} showSymbol={showSymbol} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
