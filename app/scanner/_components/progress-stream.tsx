"use client";

import { useEffect, useMemo, useState } from "react";
import type { ScannerProgressEvent } from "@/lib/types";
import { averageHistoricalDuration, estimateRemainingMs, loadScanHistory } from "@/lib/scanner-eta";

function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

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

export function ProgressStream({
  event,
  startedAt,
}: {
  event: ScannerProgressEvent | null;
  startedAt: number | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt == null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Recomputed once per scan (keyed on startedAt, which changes once per run) — history doesn't change mid-run.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const historicalAvgMs = useMemo(() => averageHistoricalDuration(loadScanHistory()), [startedAt]);

  const elapsedMs = startedAt != null ? Math.max(0, now - startedAt) : 0;
  const remainingMs = event
    ? estimateRemainingMs({ elapsedMs, pct: event.pct, historicalAvgMs })
    : null;
  const completionTime = remainingMs != null
    ? new Date(now + remainingMs).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
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
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
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

        {/* Timing: elapsed / remaining / ETA */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted/70">
          <span>Elapsed <span className="font-mono text-foreground/80">{formatClock(elapsedMs)}</span></span>
          {remainingMs != null && (
            <span>~<span className="font-mono text-foreground/80">{formatClock(remainingMs)}</span> remaining</span>
          )}
          {completionTime && (
            <span>Est. completion <span className="font-mono text-foreground/80">{completionTime}</span></span>
          )}
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
