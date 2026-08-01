/**
 * Investment Knowledge Graph — change detection.
 *
 * Pure diff between the previous stored snapshot of a scope and the freshly
 * built graph: new/removed nodes and edges, labeled for display. The snapshot
 * store lives in lib/db.ts (kg_snapshot); index.ts owns the read/write cadence.
 */

import type { GraphNode, GraphEdge, GraphChanges } from "./types";

interface Snapshotable {
  nodes: Pick<GraphNode, "id" | "label" | "type">[];
  edges: Pick<GraphEdge, "id" | "label" | "source" | "target">[];
}

/** Pure: what changed from `prev` to `next`. */
export function diffGraphs(prev: Snapshotable, next: Snapshotable, previousAt: string): GraphChanges {
  const prevNodeIds = new Set(prev.nodes.map((n) => n.id));
  const nextNodeIds = new Set(next.nodes.map((n) => n.id));
  const prevEdgeIds = new Set(prev.edges.map((e) => e.id));
  const nextEdgeIds = new Set(next.edges.map((e) => e.id));

  const labelOf = (list: Snapshotable["nodes"], id: string) => list.find((n) => n.id === id)?.label ?? id;

  const edgeSummary = (edge: Snapshotable["edges"][number], nodes: Snapshotable["nodes"]) => ({
    id: edge.id,
    label: edge.label,
    sourceLabel: labelOf(nodes, edge.source),
    targetLabel: labelOf(nodes, edge.target),
  });

  return {
    previousAt,
    addedNodes: next.nodes
      .filter((n) => !prevNodeIds.has(n.id))
      .map((n) => ({ id: n.id, label: n.label, type: n.type })),
    removedNodes: prev.nodes
      .filter((n) => !nextNodeIds.has(n.id))
      .map((n) => ({ id: n.id, label: n.label, type: n.type })),
    addedEdges: next.edges.filter((e) => !prevEdgeIds.has(e.id)).map((e) => edgeSummary(e, next.nodes)),
    removedEdges: prev.edges.filter((e) => !nextEdgeIds.has(e.id)).map((e) => edgeSummary(e, prev.nodes)),
  };
}

/** True when the diff contains nothing worth surfacing. */
export function isEmptyChanges(changes: GraphChanges): boolean {
  return (
    changes.addedNodes.length === 0 &&
    changes.removedNodes.length === 0 &&
    changes.addedEdges.length === 0 &&
    changes.removedEdges.length === 0
  );
}
