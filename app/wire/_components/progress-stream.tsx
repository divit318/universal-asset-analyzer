"use client";

import type { ScannerProgressEvent } from "@/lib/types";

export const STAGE_LABELS: Record<string, string> = {
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
 * Scan status as a single slim strip inside the sticky command bar — not a
 * mid-page block. Sections below render progressively as their own data
 * streams in (see the partial-message handling in page.tsx's runScan()), so
 * all this owes the user is which stage is running and how far along it is.
 */
export function InlineScanProgress({ event }: { event: ScannerProgressEvent | null }) {
  const label = event ? STAGE_LABELS[event.stage] ?? event.stage : "Starting intelligence pipeline…";
  const pct = event?.pct ?? 0;

  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="truncate text-xs text-muted">
        <span className="font-medium text-foreground">{label}</span>
        {event?.message && event.message !== label && (
          <span className="hidden sm:inline"> — {event.message}</span>
        )}
      </span>
      <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3 sm:w-40">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-xs text-muted/60">{pct}%</span>
    </div>
  );
}
