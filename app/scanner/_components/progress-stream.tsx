"use client";

import { useMemo } from "react";
import type { ScannerProgressEvent } from "@/lib/types";
import { averageHistoricalDuration, estimateRemainingMs, loadScanHistory } from "@/lib/scanner-eta";
import { TaskProgress, useElapsedMs, type TaskProgressStep } from "@/app/_components/ui";

const STAGE_LABELS: Record<string, string> = {
  init:               "Initializing…",
  collecting:         "Collecting signals from all sources",
  deduplicating:      "Clustering headlines into stories",
  classifying:        "Classifying events by category",
  causal_reasoning:   "Building cause-and-effect chains",
  theme_detection:    "Detecting emerging themes",
  sector_impact:      "Analyzing sector impact",
  company_impact:     "Identifying company opportunities",
  fundamental_gate:   "Validating against fundamentals",
  opportunity_scoring:"Scoring and ranking opportunities",
  thesis_building:    "Generating investment theses",
  assembling:         "Assembling intelligence report",
  done:               "Complete",
  error:              "Error",
};

/** The pipeline's stages, in order, minus the terminal/bootstrap ones. */
const PIPELINE_STEPS: TaskProgressStep[] = Object.entries(STAGE_LABELS)
  .filter(([k]) => k !== "done" && k !== "error" && k !== "init")
  .map(([id, label]) => ({ id, label }));

export function ProgressStream({
  event,
  startedAt,
}: {
  event: ScannerProgressEvent | null;
  startedAt: number | null;
}) {
  const elapsedMs = useElapsedMs(startedAt);

  // Recomputed once per scan (keyed on startedAt, which changes once per run) — history doesn't change mid-run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historicalAvgMs = useMemo(() => averageHistoricalDuration(loadScanHistory()), [startedAt]);

  const remainingMs = event
    ? estimateRemainingMs({ elapsedMs, pct: event.pct, historicalAvgMs })
    : null;

  if (!event) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Starting intelligence pipeline…
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-surface p-5">
        <TaskProgress
          label={STAGE_LABELS[event.stage] ?? event.stage}
          detail={event.message}
          pct={event.pct}
          elapsedMs={elapsedMs}
          remainingMs={remainingMs}
          steps={PIPELINE_STEPS}
          activeStepId={event.stage}
        />
      </div>

      {/* Skeleton cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-xl border border-border bg-surface"
            style={{ animationDelay: `${i * 0.1}s` }}
          />
        ))}
      </div>
    </div>
  );
}
