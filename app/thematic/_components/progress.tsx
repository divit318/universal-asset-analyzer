"use client";

import { Check } from "lucide-react";
import type { ThematicProgressEvent } from "@/lib/thematic-engine";
import { Card } from "@/app/_components/ui";
import { LoadingMark } from "@/app/_components/loading-mark";

/**
 * The pipeline, in order, with its real stage numbers.
 *
 * Previously STAGE_META claimed stage 9 was "Company Quality" while the
 * progress list skipped straight from 8 to 10 — because no stage 9 existed.
 * The engine now emits `company_quality` for real, and this array is the only
 * place the order and numbering live.
 */
export const PIPELINE = [
  { id: "future_state", label: "Future state" },
  { id: "dependency_chain", label: "Dependency chain" },
  { id: "bottleneck", label: "Bottleneck" },
  { id: "supply_demand", label: "Supply / demand cycle" },
  { id: "commodity", label: "Commodity framework" },
  { id: "policy", label: "Policy & geopolitics" },
  { id: "global_structural_advantage", label: "Structural advantage" },
  { id: "company_mapping", label: "Company tier mapping" },
  { id: "company_quality", label: "Company quality" },
  { id: "opportunity_score", label: "Opportunity score" },
] as const;

function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * Live pipeline progress.
 *
 * The previous version marked a stage complete as soon as *any* event carrying
 * its name arrived — but every stage emits twice (once on entry, once with its
 * result), so each stage showed a green tick and "Done" the instant it started
 * and the panel told the user the run was finished nine times over. Completion
 * is now defined as the arrival of that stage's data-bearing event, which is the
 * only event that means the work actually happened.
 */
export function ProgressView({ events, elapsed }: { events: ThematicProgressEvent[]; elapsed: number }) {
  const completed = new Set(events.filter((e) => e.data !== undefined).map((e) => e.stage));
  // The current stage is the first not-yet-complete one, which is robust to a
  // stage that emits no entry event at all.
  const currentIndex = PIPELINE.findIndex((s) => !completed.has(s.id));
  const current = currentIndex === -1 ? null : PIPELINE[currentIndex];
  const latest = events[events.length - 1];
  const detail = latest && latest.stage === current?.id ? latest.message : null;
  const done = completed.size;

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <LoadingMark size={20} label="Running thematic analysis" />
          <div>
            <p className="text-sm font-semibold">
              {current ? current.label : "Assembling the report"}
            </p>
            <p className="text-xs text-muted">{detail ?? "Working…"}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs tabular-nums text-muted">
          <span>
            {done}/{PIPELINE.length} stages
          </span>
          <span className="font-mono">{formatDuration(elapsed * 1000)}</span>
        </div>
      </div>

      {/* A width transition, deliberately not the shared `.animate-bar-fill`
          keyframe: that animates from 0 on every render, so each completed
          stage would restart the whole bar instead of extending it. */}
      <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-700 ease-out"
          style={{ width: `${(done / PIPELINE.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 flex flex-col gap-0.5">
        {PIPELINE.map((s, i) => {
          const isDone = completed.has(s.id);
          const isCurrent = current?.id === s.id;
          // Result messages carry the finding, e.g. "Bottleneck score: 8/10" —
          // showing it inline turns a progress list into a live summary.
          const result = [...events].reverse().find((e) => e.stage === s.id && e.data !== undefined)?.message;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-control px-2.5 py-2 transition-colors duration-300 ${
                isCurrent ? "bg-brand/5" : ""
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-micro font-bold transition-colors duration-300 ${
                  isDone
                    ? "bg-positive/15 text-positive"
                    : isCurrent
                      ? "bg-brand/15 text-brand"
                      : "bg-surface-3 text-muted/60"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className={`shrink-0 text-sm ${isDone || isCurrent ? "text-foreground" : "text-muted/60"}`}>
                {s.label}
              </span>
              {isDone && result && (
                <span className="ml-auto truncate pl-4 text-xs text-muted">{result}</span>
              )}
              {isCurrent && <span className="ml-auto shrink-0 text-xs text-brand">Running…</span>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
