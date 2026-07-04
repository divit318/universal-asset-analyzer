"use client";

import type { TimelineEvent } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { categoryLabel } from "./category-label";

const IMPACT_STYLE = {
  bullish: { badge: "bg-positive/15 text-positive border-positive/30", arrow: "↑" },
  bearish: { badge: "bg-negative/15 text-negative border-negative/30", arrow: "↓" },
  neutral: { badge: "bg-muted/15 text-muted border-muted/30", arrow: "→" },
};

const THESIS_STYLE = {
  strengthened: { label: "Thesis strengthened", cls: "text-positive" },
  weakened: { label: "Thesis weakened", cls: "text-negative" },
  unchanged: { label: "Thesis unchanged", cls: "text-muted" },
};

const CATALYST_STYLE = {
  pending: { label: "Pending catalyst", cls: "border-warning/30 bg-warning/10 text-warning" },
  realized: { label: "Realized", cls: "border-accent/30 bg-accent/10 text-accent" },
  invalidated: { label: "Invalidated", cls: "border-negative/30 bg-negative/10 text-negative" },
  not_catalyst: null,
};

export function EventCard({
  event,
  showSymbol,
  onSelect,
}: {
  event: TimelineEvent;
  showSymbol?: boolean;
  onSelect: (event: TimelineEvent) => void;
}) {
  const impact = IMPACT_STYLE[event.impact];
  const catalyst = CATALYST_STYLE[event.catalystStatus];
  const milestone = event.importanceScore >= 75;

  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={`group flex w-full flex-col gap-2 rounded-xl border bg-surface p-4 text-left transition-all hover:bg-surface-2 ${
        milestone ? "border-accent/25 shadow-[0_0_0_1px_rgba(74,222,128,0.06)]" : "border-border hover:border-border/80"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {showSymbol && (
              <span className="font-mono text-xs font-semibold text-accent">{event.symbol}</span>
            )}
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted/60">
              {formatDate(event.timestamp)}
            </span>
            {milestone && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent">
                Milestone
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium leading-5 text-foreground line-clamp-2">{event.title}</h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${impact.badge}`}>
          {impact.arrow} {event.impact}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-foreground">
          {categoryLabel(event.category)}
        </span>
        {event.affectedSegment && (
          <span className="rounded-md border border-border px-2 py-0.5 text-[10px] text-muted">
            {event.affectedSegment}
          </span>
        )}
        {catalyst && (
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${catalyst.cls}`}>
            {catalyst.label}
          </span>
        )}
        {event.thesisImpact && (
          <span className={`text-[10px] font-medium ${THESIS_STYLE[event.thesisImpact].cls}`}>
            {THESIS_STYLE[event.thesisImpact].label}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2 text-[10px] text-muted">
        <span>Importance {event.importanceScore}/100 · Confidence {event.confidenceScore}/100</span>
        <span className="text-muted/60 group-hover:text-accent">Details →</span>
      </div>
    </button>
  );
}
