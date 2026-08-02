"use client";

/**
 * IC Report — agents tab.
 *
 * Full narrative content is in the UI, not only bullets behind a truncation
 * affordance (Phase 5.11): consistent expand rules, expand/collapse all, and
 * per-agent failure states with a retry affordance (Phase 7.6).
 */

import { useState } from "react";
import type { AgentFinding, AgentFailure } from "@/lib/ic-agents";
import { GroundingBadge } from "@/app/_components/grounding-badge";
import { Card, ConfidenceChip, EmptyState } from "./shared";

export function AgentsTab({
  findings,
  failures,
  symbol,
  onRetried,
}: {
  findings: AgentFinding[];
  failures: AgentFailure[];
  symbol: string;
  onRetried: (finding: AgentFinding) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const allExpanded = findings.length > 0 && expanded.size >= findings.length;

  const toggle = (agent: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const retry = async (agent: string) => {
    setRetrying(agent);
    setRetryError(null);
    try {
      const res = await fetch("/api/ic-report/retry-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, agent }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Retry failed (${res.status})`);
      }
      const data = (await res.json()) as { finding: AgentFinding };
      onRetried(data.finding);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  if (findings.length === 0 && failures.length === 0) {
    return <EmptyState title="No agent findings yet" detail="Agents report in one at a time as the network runs." />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {findings.length} agent finding{findings.length === 1 ? "" : "s"}
          {failures.length > 0 && <span className="text-warning">, {failures.length} failed</span>}
        </p>
        {findings.length > 0 && (
          <button
            className="min-h-[36px] rounded-lg border border-border px-3 text-xs transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            onClick={() => setExpanded(allExpanded ? new Set() : new Set(findings.map((f) => f.agent)))}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
      </div>

      {failures.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <p className="font-medium">
            {failures.length} of {findings.length + failures.length} agents failed: the thesis was formed without their input.
          </p>
          <ul className="mt-1.5 space-y-1.5 text-xs">
            {failures.map((f) => (
              <li key={f.agent} className="flex flex-wrap items-center gap-2">
                <span>
                  <span className="font-medium">{f.agentLabel}:</span> {f.error}
                </span>
                <button
                  className="min-h-[28px] rounded-md border border-warning/40 px-2 text-label font-medium hover:bg-warning/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                  onClick={() => void retry(f.agent)}
                  disabled={retrying !== null}
                >
                  {retrying === f.agent ? "Retrying…" : "Retry this agent"}
                </button>
              </li>
            ))}
          </ul>
          {retryError && <p className="mt-1.5 text-xs">{retryError}</p>}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {findings.map((f) => {
          const isOpen = expanded.has(f.agent);
          return (
            <Card key={f.agent}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{f.agentLabel}</span>
                <ConfidenceChip confidence={f.confidence} />
              </div>
              {f.confidenceDowngraded && (
                <p className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-label text-warning">
                  Confidence downgraded: {f.confidenceDowngraded}.
                </p>
              )}
              <ul className="space-y-1.5">
                {f.keyInsights.map((ins, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted">
                    <span className="mt-0.5 shrink-0 text-brand" aria-hidden="true">→</span>
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
              <button
                className="mt-3 flex min-h-[36px] w-full items-center justify-between border-t border-border pt-2 text-left text-xs text-brand hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                onClick={() => toggle(f.agent)}
                aria-expanded={isOpen}
              >
                <span>{isOpen ? "Hide full findings" : "Read full findings"}</span>
                <span className="text-muted">
                  {f.questionsAnswered} of {f.questionsAssigned} assigned questions investigated
                </span>
              </button>
              {isOpen && (
                <div className="mt-2">
                  <p className="whitespace-pre-line text-sm leading-6 text-muted">{f.findings}</p>
                  {f.dataLimitations && (
                    <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-warning">
                      Data note: {f.dataLimitations}
                    </p>
                  )}
                  {f.grounding && <GroundingBadge grounding={f.grounding} className="mt-2" />}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
