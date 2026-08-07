"use client";

/**
 * Accessible table rendering of the knowledge graph — a first-class
 * alternative to the SVG canvas, not an afterthought. It renders the SAME
 * filtered node/edge set the canvas shows (legend filters, min strength,
 * focus mode, hidden nodes all apply — KG-046), adds sortable columns, and
 * shows the evidence and timestamps a screen-reader user would otherwise
 * only reach through the inspector.
 */

import { useMemo, useState } from "react";
import type { KnowledgeGraph, GraphNode, GraphEdge } from "@/lib/knowledge-graph";
import { NODE_VISUAL, EDGE_VISUAL } from "./graph-model";

type NodeSortKey = "label" | "type" | "sector" | "weight" | "degree";
type EdgeSortKey = "from" | "relation" | "to" | "strength" | "when";

function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th scope="col" aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"} className={`py-1.5 pr-3 ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={onClick} className="uppercase tracking-wider hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent">
        {label}
        {active ? (direction === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export function GraphTable({
  graph,
  nodes,
  edges,
  onSelectNode,
  onSelectEdge,
}: {
  graph: KnowledgeGraph;
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const [nodeSort, setNodeSort] = useState<{ key: NodeSortKey; dir: "asc" | "desc" }>({ key: "degree", dir: "desc" });
  const [edgeSort, setEdgeSort] = useState<{ key: EdgeSortKey; dir: "asc" | "desc" }>({ key: "strength", dir: "desc" });

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of edges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [edges]);

  const sortedNodes = useMemo(() => {
    const dir = nodeSort.dir === "asc" ? 1 : -1;
    const value = (n: GraphNode): string | number => {
      switch (nodeSort.key) {
        case "label": return n.fullLabel.toLowerCase();
        case "type": return `${NODE_VISUAL[n.type].label} ${n.metrics.instrument ?? ""}`.toLowerCase();
        case "sector": return (n.sector ?? "").toLowerCase();
        case "weight": return n.weight ?? -1;
        case "degree": return degree.get(n.id) ?? 0;
      }
    };
    return [...nodes].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }, [nodes, nodeSort, degree]);

  const sortedEdges = useMemo(() => {
    const dir = edgeSort.dir === "asc" ? 1 : -1;
    const value = (e: GraphEdge): string | number => {
      switch (edgeSort.key) {
        case "from": return (nodeById.get(e.source)?.label ?? e.source).toLowerCase();
        case "relation": return EDGE_VISUAL[e.type].label;
        case "to": return (nodeById.get(e.target)?.label ?? e.target).toLowerCase();
        case "strength": return e.strength;
        case "when": return e.timestamp ?? "";
      }
    };
    return [...edges].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }, [edges, edgeSort, nodeById]);

  const toggleNodeSort = (key: NodeSortKey) =>
    setNodeSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const toggleEdgeSort = (key: EdgeSortKey) =>
    setEdgeSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const filteredOut = graph.nodes.length - nodes.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto rounded-xl border border-border bg-surface p-4">
      <section aria-labelledby="kg-nodes-heading">
        <h3 id="kg-nodes-heading" className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
          Nodes ({nodes.length}{filteredOut > 0 ? ` of ${graph.nodes.length}; ${filteredOut} filtered out` : ""})
        </h3>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] text-muted">
              <SortHeader label="Name" active={nodeSort.key === "label"} direction={nodeSort.dir} onClick={() => toggleNodeSort("label")} />
              <SortHeader label="Type" active={nodeSort.key === "type"} direction={nodeSort.dir} onClick={() => toggleNodeSort("type")} />
              <SortHeader label="Sector" active={nodeSort.key === "sector"} direction={nodeSort.dir} onClick={() => toggleNodeSort("sector")} />
              <SortHeader label="Weight" active={nodeSort.key === "weight"} direction={nodeSort.dir} onClick={() => toggleNodeSort("weight")} align="right" />
              <SortHeader label="Links" active={nodeSort.key === "degree"} direction={nodeSort.dir} onClick={() => toggleNodeSort("degree")} align="right" />
            </tr>
          </thead>
          <tbody>
            {sortedNodes.map((n) => (
              <tr key={n.id} className="border-b border-border/50">
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectNode(n.id)}
                    title={n.fullLabel}
                    className="max-w-[260px] truncate text-left font-medium text-foreground hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {n.fullLabel}
                  </button>
                </td>
                <td className="py-1.5 pr-3 text-muted">
                  {NODE_VISUAL[n.type].label}
                  {n.metrics.instrument && n.type === "company" ? ` (${n.metrics.instrument})` : ""}
                </td>
                <td className="py-1.5 pr-3 text-muted">{n.sector ?? (n.type === "company" && n.instrument !== "cash" ? "Unclassified" : "")}</td>
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
          Connections ({edges.length})
        </h3>
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] text-muted">
              <SortHeader label="From" active={edgeSort.key === "from"} direction={edgeSort.dir} onClick={() => toggleEdgeSort("from")} />
              <SortHeader label="Relation" active={edgeSort.key === "relation"} direction={edgeSort.dir} onClick={() => toggleEdgeSort("relation")} />
              <SortHeader label="To" active={edgeSort.key === "to"} direction={edgeSort.dir} onClick={() => toggleEdgeSort("to")} />
              <SortHeader label="When" active={edgeSort.key === "when"} direction={edgeSort.dir} onClick={() => toggleEdgeSort("when")} />
              <SortHeader label="Strength" active={edgeSort.key === "strength"} direction={edgeSort.dir} onClick={() => toggleEdgeSort("strength")} align="right" />
            </tr>
          </thead>
          <tbody>
            {sortedEdges.map((e) => (
              <tr key={e.id} className="border-b border-border/50">
                <td className="max-w-[200px] truncate py-1.5 pr-3 text-foreground" title={nodeById.get(e.source)?.fullLabel}>
                  {nodeById.get(e.source)?.label ?? e.source}
                </td>
                <td className="py-1.5 pr-3">
                  <button
                    type="button"
                    onClick={() => onSelectEdge(e.id)}
                    title={e.evidence}
                    className="text-left text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {EDGE_VISUAL[e.type].label}
                    {e.directed ? " →" : ""}
                  </button>
                </td>
                <td className="max-w-[200px] truncate py-1.5 pr-3 text-foreground" title={nodeById.get(e.target)?.fullLabel}>
                  {nodeById.get(e.target)?.label ?? e.target}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[11px] text-muted">{e.timestamp ? e.timestamp.slice(0, 10) : ""}</td>
                <td className="py-1.5 text-right font-mono text-muted">{e.strength}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
