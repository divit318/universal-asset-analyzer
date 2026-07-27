"use client";

import type { ScannerProgressEvent } from "@/lib/types";

const STAGE_LABELS: Record<string, string> = {
  init:               "Initializing…",
  collecting:         "Collecting signals from all sources",
  deduplicating:      "Clustering headlines into stories",
  classifying:        "Classifying events by category",
  theme_detection:    "Detecting emerging themes",
  causal_reasoning:   "Building cause-and-effect chains",
  sector_impact:      "Analyzing sector impact",
  company_impact:     "Identifying company opportunities",
  fundamental_gate:   "Validating against fundamentals",
  opportunity_scoring:"Scoring and ranking opportunities",
  thesis_building:    "Generating investment theses",
  assembling:         "Assembling intelligence report",
  done:               "Complete",
  error:              "Error",
};

/**
 * A slim status line, not a waiting room. Sections in the dashboard below
 * this now render progressively as their own data streams in (see the
 * partial-message handling in page.tsx's runScan()), each with its own
 * skeleton until ready — so this component no longer owns any full-page
 * skeleton grid, and deliberately doesn't show elapsed/remaining/ETA:
 * that was time spent watching a countdown for work already visible below.
 */
export function ProgressStream({
  event,
}: {
  event: ScannerProgressEvent | null;
  startedAt?: number | null;
}) {
  const liveDot = (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
    </span>
  );

  if (!event) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        {liveDot}
        Starting intelligence pipeline…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted">
          {liveDot}
          <span>
            <span className="font-medium text-foreground">
              {STAGE_LABELS[event.stage] ?? event.stage}
            </span>
            {event.message && event.message !== STAGE_LABELS[event.stage] && (
              <span className="text-muted"> — {event.message}</span>
            )}
          </span>
        </div>
        <span className="font-mono text-xs text-muted/60">{event.pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${event.pct}%` }}
        />
      </div>

      {/* Stage steps */}
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
        {Object.entries(STAGE_LABELS)
          .filter(([k]) => k !== "done" && k !== "error" && k !== "init")
          .map(([stage, label]) => {
            const stageOrder = Object.keys(STAGE_LABELS).indexOf(stage);
            const currentOrder = Object.keys(STAGE_LABELS).indexOf(event.stage);
            const done = stageOrder < currentOrder;
            const active = stage === event.stage;
            return (
              <div
                key={stage}
                className={`h-1 rounded-full transition-all ${
                  done
                    ? "bg-accent"
                    : active
                      ? "bg-accent/60 animate-pulse"
                      : "bg-surface-3"
                }`}
                title={label}
              />
            );
          })}
      </div>
    </div>
  );
}
