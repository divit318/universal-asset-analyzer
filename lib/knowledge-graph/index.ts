/**
 * Investment Knowledge Graph — public entry point (v2).
 *
 * Composes build.ts (deterministic node/edge assembly from existing engines)
 * with recommend.ts (pure insight surfacing) and diff.ts (what changed since
 * the last visit). Results are cached briefly (building a graph does several
 * platform-cached fetches per symbol) and snapshotted daily so a fresh build
 * can honestly answer "what is new here".
 */

import { buildGraph, ROTATION_WINDOW_LABEL } from "./build";
import { computeGraphInsights } from "./recommend";
import { diffGraphs } from "./diff";
import { getScannerCache, putScannerCache, getKgSnapshot, putKgSnapshot } from "../db";
import type { GraphScope, GraphChanges, KnowledgeGraph } from "./types";

/** Snapshot cadence: diffs mean "since yesterday", not "since 15 minutes ago". */
const SNAPSHOT_MIN_AGE_MS = 18 * 60 * 60 * 1000;

function scopeKey(scope: GraphScope, id: string): string {
  // Singleton scopes ignore the id entirely; symbol ids are canonical uppercase.
  if (scope === "portfolio" || scope === "watchlist") return scope;
  return `${scope}:${scope === "symbol" ? id.toUpperCase() : id}`;
}

interface StoredSnapshot {
  nodes: KnowledgeGraph["nodes"];
  edges: KnowledgeGraph["edges"];
  generatedAt: string;
}

function computeChanges(key: string, graph: Pick<KnowledgeGraph, "nodes" | "edges" | "generatedAt">): GraphChanges | null {
  const previous = getKgSnapshot(key);
  let changes: GraphChanges | null = null;
  if (previous) {
    try {
      const prev = JSON.parse(previous.graph) as StoredSnapshot;
      changes = diffGraphs(prev, graph, previous.generatedAt);
    } catch {
      changes = null;
    }
  }
  const age = previous ? Date.now() - Date.parse(previous.generatedAt) : Infinity;
  if (!previous || age >= SNAPSHOT_MIN_AGE_MS) {
    const stored: StoredSnapshot = { nodes: graph.nodes, edges: graph.edges, generatedAt: graph.generatedAt };
    putKgSnapshot(key, JSON.stringify(stored), graph.generatedAt);
  }
  return changes;
}

export async function getKnowledgeGraph(scope: GraphScope, id: string): Promise<KnowledgeGraph> {
  const key = scopeKey(scope, id);
  // "kg2:" so stale v1-shaped cache rows can never be served as a v2 graph.
  const cacheKey = `kg2:${key}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as KnowledgeGraph;
    } catch {
      // fall through and rebuild
    }
  }

  const { nodes, edges, meta } = await buildGraph(scope, id);
  const insights = computeGraphInsights(nodes, edges, ROTATION_WINDOW_LABEL);
  const generatedAt = new Date().toISOString();
  const changes = computeChanges(key, { nodes, edges, generatedAt });
  const graph: KnowledgeGraph = { scope, id, nodes, edges, insights, meta, changes, generatedAt };
  putScannerCache(cacheKey, JSON.stringify(graph));
  return graph;
}

export type {
  GraphScope,
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  GraphInsights,
  GraphStats,
  GraphMeta,
  GraphChanges,
  ConnectionExplanation,
  GraphNarrative,
  NarrativeObservation,
  NodeType,
  EdgeType,
  InstrumentType,
  Provenance,
} from "./types";
export { INSTRUMENT_LABEL } from "./types";
export { findPath, findPaths, describePath, explainConnection } from "./traverse";
export { narrateGraph } from "./narrate";
export { buildGraph, ROTATION_WINDOW_LABEL } from "./build";
