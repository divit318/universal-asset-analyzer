"use client";

/**
 * Accessible table rendering of the knowledge graph — a first-class
 * alternative to the SVG canvas, not an afterthought. Everything the canvas
 * shows (nodes with type/instrument/sector/weight, edges with relation,
 * strength, evidence) is reachable here with a screen reader or keyboard.
 */

import type { KnowledgeGraph } from "@/lib/knowledge-graph";
import { NODE_VISUAL, EDGE_VISUAL } from "./graph-model";

export function GraphTable({
  graph,
  onSelectNode,
  onSelectEdge,
}: {
  graph: KnowledgeGraph;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const nodes = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto rounded-xl border border-border bg-surface p-4">
      <section aria-labelledby="kg-nodes-heading">
        <h3 id="kg-nodes-heading" className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Nodes ({graph.nodes.length})
        </h3>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <th scope="col" className="py-1.5 pr-3">Name</th>
              <th scope="col" className="py-1.5 pr-3">Type</th>
              <th scope="col" className="py-1.5 pr-3">Sector</th>
              <th scope="col" className="py-1.5 pr-3 text-right">Weight</th>
              <th scope="col" className="py-1.5 text-right">Links</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id} className="border-b border-border/50">
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectNode(n.id)}
                    className="max-w-[260px] truncate text-left font-medium text-foreground hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {n.fullLabel}
                  </button>
                </td>
                <td className="py-1.5 pr-3 text-muted">
                  {NODE_VISUAL[n.type].label}
                  {n.metrics.instrument && n.type === "company" ? ` (${n.metrics.instrument})` : ""}
                </td>
                <td className="py-1.5 pr-3 text-muted">{n.sector ?? (n.type === "company" ? "Unclassified" : "")}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-muted">
                  {n.weight != null ? `${(n.weight * 100).toFixed(1)}%` : ""}
                </td>
                <td className="py-1.5 text-right font-mono text-muted">{degree.get(n.id) ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="kg-edges-heading">
        <h3 id="kg-edges-heading" className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Connections ({graph.edges.length})
        </h3>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <th scope="col" className="py-1.5 pr-3">From</th>
              <th scope="col" className="py-1.5 pr-3">Relation</th>
              <th scope="col" className="py-1.5 pr-3">To</th>
              <th scope="col" className="py-1.5 text-right">Strength</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e) => (
              <tr key={e.id} className="border-b border-border/50">
                <td className="max-w-[200px] truncate py-1.5 pr-3 text-foreground">{nodeById.get(e.source)?.label ?? e.source}</td>
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectEdge(e.id)}
                    className="text-left text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {EDGE_VISUAL[e.type].label}
                    {e.directed ? " →" : ""}
                  </button>
                </td>
                <td className="max-w-[200px] truncate py-1.5 pr-3 text-foreground">{nodeById.get(e.target)?.label ?? e.target}</td>
                <td className="py-1.5 text-right font-mono text-muted">{e.strength}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
