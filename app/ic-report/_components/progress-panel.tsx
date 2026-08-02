"use client";

/**
 * IC Report — running-state panel (Phase 5.2).
 *
 * Per-stage progress with elapsed time, an animated active state, per-agent
 * status, timestamped update feed in a live region (Phase 8.5), and an
 * explicit statement of what Stop does: the server run continues; Stop only
 * detaches this view.
 */

import { useEffect, useRef, useState } from "react";
import type { ICProgressEvent, ICReportStage } from "@/lib/ic-report";
import { AGENT_COUNT } from "@/lib/ic-questions";
import { Card } from "./shared";

const STAGE_LABELS: Record<ICReportStage, string> = {
  signals: "Signal Detection",
  questions: "Question Generation",
  valuation: "Valuation Engine",
  agents: "Investigation Agents",
  agent_complete: "Agent Network",
  synthesis: "Synthesis",
  thesis: "Thesis Formation",
  done: "Complete",
  error: "Error",
};

const STAGE_ORDER: ICReportStage[] = ["signals", "questions", "valuation", "agents", "synthesis", "thesis", "done"];

export { STAGE_LABELS };

export function ProgressPanel({
  running,
  stage,
  events,
  completedAgents,
  failedAgents,
  startedAt,
}: {
  running: boolean;
  stage: ICReportStage | null;
  events: ICProgressEvent[];
  completedAgents: number;
  failedAgents: number;
  startedAt: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || startedAt == null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running, startedAt]);

  const feedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [events.length]);

  const activeIdx = stage ? STAGE_ORDER.indexOf(stage) : -1;
  const agentsSettled = completedAgents + failedAgents;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        {running && (
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-mono tabular-nums">
              {String(Math.floor(elapsed / 60)).padStart(2, "0")}:{String(elapsed % 60).padStart(2, "0")} elapsed
            </span>
            <span>typical run: 3 to 15 min</span>
          </div>
        )}

        {STAGE_ORDER.map((s, i) => {
          const isDone = activeIdx > i || stage === "done";
          const isActive = activeIdx === i && running;
          const isAgents = s === "agents";
          const agentsShort = isAgents && isDone && failedAgents > 0;
          const agentsAllFailed = agentsShort && completedAgents === 0;

          return (
            <div key={s} className="flex items-center gap-3">
              <div
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                  agentsAllFailed
                    ? "border-negative bg-negative/20 text-negative"
                    : agentsShort
                      ? "border-warning bg-warning/20 text-warning"
                      : isDone
                        ? "border-positive bg-positive/20 text-positive"
                        : isActive
                          ? "animate-pulse border-brand bg-brand/20 text-brand"
                          : "border-border text-muted"
                }`}
                aria-hidden="true"
              >
                {agentsShort ? "!" : isDone ? "✓" : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${isActive ? "text-foreground" : isDone ? "text-muted" : "text-muted"}`}>
                    {STAGE_LABELS[s]}
                  </span>
                  {isAgents && agentsSettled > 0 && (
                    <span className="whitespace-nowrap text-xs text-muted">
                      {completedAgents}/{AGENT_COUNT}
                      {failedAgents > 0 && <span className="text-warning"> ({failedAgents} failed)</span>}
                    </span>
                  )}
                </div>
                {isAgents && (isActive || agentsSettled > 0) && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${(agentsSettled / AGENT_COUNT) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Timestamped live feed — announced to assistive tech (Phase 8.5). */}
        {events.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium">Live updates</div>
            <div
              ref={feedRef}
              className="max-h-56 space-y-1 overflow-y-auto text-xs text-muted"
              role="log"
              aria-live="polite"
              aria-label="Report generation updates"
            >
              {events.slice(-30).map((e, i) => (
                <div key={`${e.at}-${i}`} className="flex gap-2 leading-4">
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    {e.at.slice(11, 19)}
                  </span>
                  <span className="min-w-0">
                    <span className="text-brand">{STAGE_LABELS[e.stage]}: </span>
                    {e.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {running && (
          <p className="border-t border-border pt-2 text-label leading-4 text-muted">
            Stop detaches this view only: the run continues on the server and the finished report is saved to history.
          </p>
        )}
      </div>
    </Card>
  );
}
