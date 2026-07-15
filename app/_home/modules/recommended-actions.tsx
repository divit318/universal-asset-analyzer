"use client";

/**
 * Module 3 — Top Recommended Actions. The centerpiece.
 *
 * Renders what the decision engine measured. Where a field is absent — a queue
 * item has no decision score, an unscoreable position has no confidence — the
 * card omits it rather than showing a placeholder number. A fabricated 50 next
 * to a "Buy" button is worse than a blank.
 *
 * Dismissal is local to the session: the homepage is a view over engine output,
 * and persisting a dismissal would mean writing state that the engine would
 * immediately recompute. A dismissed action returns on refresh, which is
 * correct — the underlying reason for it has not gone away just because the
 * user closed the card.
 */

import { useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { Badge } from "@/app/_components/ui";
import { getHomeModule } from "@/lib/home/registry";
import type { RecommendedAction, RecommendedActions } from "@/lib/home/contracts";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("recommended-actions");

const SEVERITY: Record<RecommendedAction["severity"], "negative" | "warning" | "neutral"> = {
  high: "negative",
  medium: "warning",
  low: "neutral",
};

function ScoreDial({ score }: { score: number }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-0.5">
      <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{Math.round(score)}</span>
      <span className="text-micro uppercase tracking-wide text-muted">score</span>
    </div>
  );
}

function ActionCard({ action, onDismiss }: { action: RecommendedAction; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-4 rounded-control border border-border bg-surface-2 p-4">
      {action.decisionScore != null ? <ScoreDial score={action.decisionScore} /> : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={SEVERITY[action.severity]}>{action.action}</Badge>
          {action.symbol ? (
            <span className="font-mono text-sm font-semibold text-foreground">{action.symbol}</span>
          ) : null}
          <span className="text-xs text-muted">Priority {action.priority}</span>
          {action.confidence != null ? (
            <span className="text-xs text-muted">· {Math.round(action.confidence * 100)}% confidence</span>
          ) : null}
        </div>

        <p className="text-sm font-medium leading-6 text-foreground">{action.title}</p>
        <p className="text-sm leading-6 text-muted">{action.reason}</p>

        {(action.expectedImpact || action.expectedImprovement) && (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
            {action.expectedImprovement ? (
              <div className="flex flex-col">
                <dt className="text-micro uppercase tracking-wide text-muted">Expected improvement</dt>
                <dd className="text-xs text-foreground/85">{action.expectedImprovement}</dd>
              </div>
            ) : null}
            {action.expectedImpact ? (
              <div className="flex flex-col">
                <dt className="text-micro uppercase tracking-wide text-muted">Return impact</dt>
                <dd className="text-xs text-foreground/85">{action.expectedImpact}</dd>
              </div>
            ) : null}
          </dl>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href={action.href}
            className="rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Open research
          </Link>
          <Link
            href="/portfolio?tab=decisions"
            className="rounded-control border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:border-brand/40 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Open portfolio
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss ${action.title}`}
        className="shrink-0 rounded-control p-1 text-muted outline-none transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}

export function RecommendedActionsModule() {
  const state = useHomeSlice("recommendedActions");
  const { refreshDigest } = useHome();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = (data: RecommendedActions) => data.actions.filter((a) => !dismissed.has(a.id));

  return (
    <ModuleShell
      definition={definition}
      state={state}
      minHeight={180}
      onRefresh={refreshDigest}
      isEmpty={(d) => visible(d).length === 0}
      emptyMessage="Nothing needs your attention right now."
    >
      {(data) => (
        <div className="flex flex-col gap-3">
          {!data.fromDecisionEngine ? (
            <p className="text-xs text-muted">
              {data.hasPortfolio
                ? "The decision engine found no trade worth making right now — a good sign. These are open alerts instead, which aren't scored."
                : "These are alerts, not scored decisions. Add holdings to get ranked recommendations from the decision engine."}
            </p>
          ) : null}

          {visible(data).map((action) => (
            <ActionCard
              key={action.id}
              action={action}
              onDismiss={() => setDismissed((prev) => new Set(prev).add(action.id))}
            />
          ))}
        </div>
      )}
    </ModuleShell>
  );
}
