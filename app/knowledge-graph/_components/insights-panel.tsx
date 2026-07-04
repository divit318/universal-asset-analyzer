"use client";

import type { GraphInsights } from "@/lib/knowledge-graph";

export function InsightsPanel({ insights, onSelectNode }: { insights: GraphInsights; onSelectNode: (nodeId: string) => void }) {
  const hasAny =
    insights.concentrationRisks.length > 0 ||
    insights.hiddenOpportunities.length > 0 ||
    insights.emergingRisks.length > 0 ||
    insights.correlationClusters.length > 0;

  if (!hasAny) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {insights.concentrationRisks.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-warning">Sector Concentration</h4>
          <ul className="flex flex-col gap-1.5">
            {insights.concentrationRisks.map((c) => (
              <li key={c.sector} className="text-xs text-muted">
                <span className="font-medium text-foreground">{c.sector}</span> — {c.nodeCount} holdings ({c.symbols.join(", ")})
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.hiddenOpportunities.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-positive">Hidden Opportunities</h4>
          <ul className="flex flex-col gap-1.5">
            {insights.hiddenOpportunities.map((o) => (
              <li key={o.nodeId}>
                <button
                  type="button"
                  onClick={() => onSelectNode(o.nodeId)}
                  className="text-left text-xs text-muted hover:text-accent transition-colors"
                >
                  <span className="font-medium text-foreground">{o.label}</span> — {o.reason}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.emergingRisks.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-negative">Emerging Risks</h4>
          <ul className="flex flex-col gap-1.5">
            {insights.emergingRisks.map((r) => (
              <li key={r.nodeId}>
                <button
                  type="button"
                  onClick={() => onSelectNode(r.nodeId)}
                  className="text-left text-xs text-muted hover:text-accent transition-colors"
                >
                  <span className="font-medium text-foreground">{r.label}</span> — {r.reason}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {insights.correlationClusters.length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">Correlation Clusters</h4>
          <ul className="flex flex-col gap-1.5">
            {insights.correlationClusters.map((c) => (
              <li key={c.classification} className="text-xs text-muted">
                <span className="font-medium capitalize text-foreground">{c.classification}</span> together: {c.sectors.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
