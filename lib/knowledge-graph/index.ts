/**
 * Investment Knowledge Graph — public entry point.
 *
 * Composes build.ts (deterministic node/edge assembly from existing engines)
 * with recommend.ts (pure insight surfacing), and caches the result briefly
 * since building a graph does several fundamentals fetches per symbol.
 */

import { buildGraph } from "./build";
import { computeGraphInsights } from "./recommend";
import { getScannerCache, putScannerCache } from "../db";
import type { GraphScope, KnowledgeGraph } from "./types";

export async function getKnowledgeGraph(scope: GraphScope, id: string): Promise<KnowledgeGraph> {
  const cacheKey = `kg:${scope}:${id.toUpperCase()}`;
  const cached = getScannerCache(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as KnowledgeGraph;
    } catch {
      // fall through and rebuild
    }
  }

  const { nodes, edges } = await buildGraph(scope, id);
  const insights = computeGraphInsights(nodes, edges);
  const graph: KnowledgeGraph = { scope, id, nodes, edges, insights, generatedAt: new Date().toISOString() };
  putScannerCache(cacheKey, JSON.stringify(graph));
  return graph;
}

export type { GraphScope, GraphNode, GraphEdge, KnowledgeGraph, GraphInsights, ConnectionExplanation, NodeType, EdgeType } from "./types";
export { findPath, describePath, explainConnection } from "./traverse";
export { buildGraph } from "./build";
