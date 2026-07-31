"use client";

import { useMemo } from "react";
import type { ThematicProgressEvent } from "@/lib/thematic-engine";
import { Card, TaskProgress, type TaskProgressStep } from "@/app/_components/ui";
import { readStageEstimates } from "./storage";

/**
 * The pipeline, in order, with its real stage numbers.
 *
 * Previously STAGE_META claimed stage 9 was "Company Quality" while the
 * progress list skipped straight from 8 to 10 — because no stage 9 existed.
 * The engine now emits `company_quality` for real, and this array is the only
 * place the order and numbering live.
 *
 * `timing` names the stage as the engine's stageTimings records it; the two
 * screener stages take milliseconds and carry no timing entry.
 */
export const PIPELINE = [
  { id: "future_state", label: "Future state", timing: "Future State" },
  { id: "dependency_chain", label: "Dependency chain", timing: "Dependency Chain" },
  { id: "bottleneck", label: "Bottleneck", timing: "Bottleneck" },
  { id: "supply_demand", label: "Supply / demand cycle", timing: "Supply/Demand" },
  { id: "commodity", label: "Commodity framework", timing: "Commodity Framework" },
  { id: "policy", label: "Policy & geopolitics", timing: "Policy" },
  { id: "global_structural_advantage", label: "Structural advantage", timing: "Global Structural Advantage" },
  { id: "company_mapping", label: "Company tier mapping", timing: "Company Mapping" },
  { id: "company_quality", label: "Company quality", timing: null },
  { id: "opportunity_score", label: "Opportunity score", timing: null },
] as const;

/**
 * Live pipeline progress, on the shared TaskProgress primitive.
 *
 * The page used to carry a private progress panel that had drifted from the
 * shared one in exactly the ways that matter over a multi-minute wait: no
 * aria-live (a screen reader was never told a stage finished) and no
 * remaining-time estimate, while the engine measured per-stage timings into
 * every report that nothing then read. TaskProgress supplies the announce
 * and the ETA discipline; the per-stage findings ("Bottleneck score: 8/10")
 * ride on its checklist as step results, so the list stays a live summary.
 *
 * Completion is defined as the arrival of a stage's data-bearing event —
 * every stage emits twice (entry, then result), and only the result event
 * means the work actually happened.
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

  const steps: TaskProgressStep[] = PIPELINE.map((s) => ({
    id: s.id,
    label: s.label,
    // Result messages carry the finding, e.g. "Bottleneck score: 8/10" —
    // showing it inline turns a progress list into a live summary.
    result: completed.has(s.id)
      ? [...events].reverse().find((e) => e.stage === s.id && e.data !== undefined)?.message
      : undefined,
  }));

  // Expected total wall time, learned from previous runs on this machine
  // (see storage.recordStageTimings). Null on a first run: no basis, no ETA.
  const totalEstimateMs = useMemo(() => {
    const est = readStageEstimates();
    if (!est) return null;
    const sum = PIPELINE.reduce((s, p) => s + (p.timing ? est[p.timing] ?? 0 : 0), 0);
    return sum > 0 ? sum : null;
  }, []);
  const elapsedMs = elapsed * 1000;
  // Once the estimate is exhausted the honest statement is "longer than last
  // time", not a countdown pinned at zero — drop the ETA rather than lie.
  const remainingMs =
    totalEstimateMs != null && totalEstimateMs - elapsedMs > 5_000 ? totalEstimateMs - elapsedMs : null;

  return (
    <Card padding="md">
      <TaskProgress
        label={current ? current.label : "Assembling the report"}
        detail={detail ?? "Working…"}
        pct={(done / PIPELINE.length) * 100}
        elapsedMs={elapsedMs}
        remainingMs={remainingMs}
        steps={steps}
        activeStepId={current?.id ?? null}
        stepLayout="checklist"
      />
    </Card>
  );
}
