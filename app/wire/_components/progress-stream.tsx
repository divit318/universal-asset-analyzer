"use client";

import type { ScannerProgressEvent, ScannerStageEvent } from "@/lib/types";

export const STAGE_LABELS: Record<string, string> = {
  init:               "Initializing…",
  collecting:         "Collecting signals from all sources",
  deduplicating:      "Clustering headlines into stories",
  classifying:        "Classifying events by category",
  theme_detection:    "Detecting emerging themes",
  causal_reasoning:   "Building cause-and-effect chains",
  risk_alerts:        "Extracting risk alerts",
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
 * all this owes the user is which stage is running, how far along it is
 * (real work units, not a stage index — lib/platform/runner.ts), what item
 * is in flight, and — when nothing has moved for a while — that the scan is
 * still alive and how to cancel it. A bar that sits at one number for
 * minutes with no explanation reads as a hang even when the model is
 * working (measured 2026-07-31: 7.8 silent minutes at "62%").
 */
export function InlineScanProgress({
  event,
  stall,
  onCancel,
  degradedCount = 0,
}: {
  event: ScannerProgressEvent | null;
  /** Latest stall notice; cleared by the caller on any progress. */
  stall?: Extract<ScannerStageEvent, { type: "stall" }> | null;
  onCancel?: () => void;
  /** Stages that have degraded so far this scan. */
  degradedCount?: number;
}) {
  const label = event ? STAGE_LABELS[event.stage] ?? event.stage : "Starting intelligence pipeline…";
  const pct = event?.pct ?? 0;
  const detail = event?.currentItem ?? (event?.message !== label ? event?.message : null);

  return (
    <div className="flex items-center gap-3 min-w-0" role="status" aria-live="polite">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
      </span>
      <span className="truncate text-xs text-muted">
        <span className="font-medium text-foreground">{label}</span>
        {detail && <span className="hidden sm:inline"> — {detail}</span>}
        {stall && (
          <span className="text-warning">
            {" "}
            · still working ({Math.round(stall.stalledMs / 1000)}s since last progress)
          </span>
        )}
        {degradedCount > 0 && (
          <span className="text-warning"> · {degradedCount} stage{degradedCount === 1 ? "" : "s"} degraded</span>
        )}
      </span>
      <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-surface-3 sm:w-40">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 font-mono text-xs text-muted/60">{pct}%</span>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-negative/40 hover:text-negative"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
