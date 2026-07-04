"use client";

import Link from "next/link";
import type { GraphNode, GraphEdge, NodeType } from "@/lib/knowledge-graph";

const TYPE_LABEL: Record<NodeType, string> = {
  company: "Company",
  sector: "Sector",
  portfolio: "Portfolio",
  watchlist: "Watchlist",
  timeline_event: "Timeline Event",
  market_event: "Market Event",
  opportunity: "Opportunity",
  thesis: "Investment Thesis",
  catalyst: "Catalyst",
  risk: "Risk",
};

export function NodeDetailPanel({
  node,
  edges,
  nodesById,
  onSelectRelated,
  onStartConnect,
  connecting,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  nodesById: Map<string, GraphNode>;
  onSelectRelated: (nodeId: string) => void;
  onStartConnect: () => void;
  connecting: boolean;
}) {
  const related = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = nodesById.get(otherId);
      const direction = e.source === node.id ? "→" : "←";
      return { edge: e, other, direction };
    })
    .filter((r): r is { edge: GraphEdge; other: GraphNode; direction: string } => r.other != null)
    .sort((a, b) => b.edge.strength - a.edge.strength);

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-accent">{TYPE_LABEL[node.type]}</span>
          <h3 className="text-sm font-semibold text-foreground">{node.label}</h3>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] text-muted">
          <span>Importance {node.importance}/100</span>
          <span>Confidence {node.confidence}/100</span>
        </div>
      </div>

      <p className="text-xs leading-5 text-muted">{node.summary}</p>

      {Object.keys(node.metrics).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(node.metrics).map(([k, v]) => (
            <span key={k} className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] text-foreground">
              {k}: {String(v)}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {node.href && (
          <Link
            href={node.href}
            className="rounded-md bg-accent-strong px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity"
          >
            Open →
          </Link>
        )}
        <button
          type="button"
          onClick={onStartConnect}
          className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
            connecting ? "border-accent/50 bg-accent/10 text-accent" : "border-border text-muted hover:border-accent/40 hover:text-accent"
          }`}
        >
          {connecting ? "Pick a second node…" : "Why is this connected to…?"}
        </button>
      </div>

      {related.length > 0 && (
        <div className="border-t border-border pt-3">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted/60">
            Related Entities ({related.length})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {related.slice(0, 10).map(({ edge, other, direction }) => (
              <li key={edge.id}>
                <button
                  type="button"
                  onClick={() => onSelectRelated(other.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <span className="shrink-0 text-[10px] text-muted/60">{direction} {edge.type.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="truncate">{other.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
