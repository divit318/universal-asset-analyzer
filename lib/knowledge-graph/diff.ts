/**
 * Investment Knowledge Graph — change detection.
 *
 * Pure diff between the previous stored snapshot of a scope and the freshly
 * built graph: new/removed nodes and edges, labeled for display. The snapshot
 * store lives in lib/db.ts (kg_snapshot); index.ts owns the read/write cadence.
 */

import type { GraphNode, GraphEdge, GraphChanges, ChangeEntry, ChangeFeed } from "./types";

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

/** Grouping key so one loud asset cannot flood the feed: leading "SYM ·" prefix, else the id's entity part. */
function entityKey(label: string, id: string): string {
  const prefix = label.match(/^([A-Z0-9.=-]{1,12})\s*[·:]/);
  if (prefix) return prefix[1];
  const idPart = id.split("::")[0];
  return idPart.includes(":") ? idPart : label.slice(0, 12);
}

const PER_ENTITY_CAP = 2;
const FEED_CAP = 8;

/**
 * Pure: raw diff -> the display-ready feed (see ChangeEntry).
 *
 * Reconciliation rule: an added/removed EDGE whose source or target node was
 * itself added/removed in the same diff is subsumed by the node entry — the
 * node's arrival already implies its edges, and rendering both is exactly the
 * "same headline three times" defect (KG-014).
 */
export function summarizeChanges(changes: GraphChanges, currentNodes: GraphNode[]): ChangeFeed {
  const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
  const addedNodeIds = new Set(changes.addedNodes.map((n) => n.id));
  const removedNodeIds = new Set(changes.removedNodes.map((n) => n.id));

  const entries: ChangeEntry[] = [];

  for (const n of changes.addedNodes) {
    const live = nodeById.get(n.id);
    entries.push({
      key: `+n:${n.id}`,
      kind: "added",
      nodeId: live ? n.id : null,
      label: n.label,
      fullLabel: live?.fullLabel ?? n.label,
      at: live?.provenance.asOf ?? null,
      materiality: live?.importance ?? 50,
    });
  }
  for (const n of changes.removedNodes) {
    entries.push({
      key: `-n:${n.id}`,
      kind: "removed",
      nodeId: null,
      label: n.label,
      fullLabel: n.label,
      at: null,
      materiality: 40,
    });
  }
  for (const e of changes.addedEdges) {
    const [source, , target] = e.id.split("::");
    if (addedNodeIds.has(source) || addedNodeIds.has(target)) continue; // subsumed by the node entry
    const focusable = nodeById.has(source) ? source : nodeById.has(target) ? target : null;
    entries.push({
      key: `+e:${e.id}`,
      kind: "added",
      nodeId: focusable,
      label: `${e.sourceLabel} ${e.label} ${e.targetLabel}`,
      fullLabel: `New connection: ${e.sourceLabel} ${e.label} ${e.targetLabel}`,
      at: null,
      materiality: 45,
    });
  }
  for (const e of changes.removedEdges) {
    const [source, , target] = e.id.split("::");
    if (removedNodeIds.has(source) || removedNodeIds.has(target)) continue;
    const focusable = nodeById.has(source) ? source : nodeById.has(target) ? target : null;
    entries.push({
      key: `-e:${e.id}`,
      kind: "removed",
      nodeId: focusable,
      label: `${e.sourceLabel} ${e.label} ${e.targetLabel}`,
      fullLabel: `Removed connection: ${e.sourceLabel} ${e.label} ${e.targetLabel}`,
      at: null,
      materiality: 35,
    });
  }

  entries.sort((a, b) => b.materiality - a.materiality || a.key.localeCompare(b.key));

  const perEntity = new Map<string, number>();
  const kept: ChangeEntry[] = [];
  let hiddenCount = 0;
  for (const entry of entries) {
    const key = entityKey(entry.label, entry.key.slice(3));
    const seen = perEntity.get(key) ?? 0;
    if (seen >= PER_ENTITY_CAP || kept.length >= FEED_CAP) {
      hiddenCount += 1;
      continue;
    }
    perEntity.set(key, seen + 1);
    kept.push(entry);
  }

  return { previousAt: changes.previousAt, entries: kept, hiddenCount };
}
