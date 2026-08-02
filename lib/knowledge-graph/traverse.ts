/**
 * Investment Knowledge Graph — traversal (v2).
 *
 * Deterministic pathfinding is pure (no I/O); AI is only used to narrate an
 * already-found path (or explain why none exists), matching the
 * "AI explains, engines decide" split used throughout this codebase.
 */

import { runPrompt } from "../ai";
import { extractJsonObject } from "../json-extract";
import { JSON_SCHEMA_LEAD_IN } from "@/lib/ai/prompts";
import type { GraphNode, GraphEdge, ConnectionExplanation } from "./types";

/** Pure: BFS shortest path between two nodes, treating edges as undirected for connectivity purposes. */
export function findPath(nodes: GraphNode[], edges: GraphEdge[], fromId: string, toId: string): GraphEdge[] | null {
  if (fromId === toId) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(fromId) || !nodeIds.has(toId)) return null;

  const adjacency = buildAdjacency(edges);
  const visited = new Set<string>([fromId]);
  const queue: { nodeId: string; path: GraphEdge[] }[] = [{ nodeId: fromId, path: [] }];

  while (queue.length > 0) {
    const { nodeId, path } = queue.shift()!;
    for (const { neighbor, edge } of adjacency.get(nodeId) ?? []) {
      if (visited.has(neighbor)) continue;
      const nextPath = [...path, edge];
      if (neighbor === toId) return nextPath;
      visited.add(neighbor);
      queue.push({ nodeId: neighbor, path: nextPath });
    }
  }
  return null;
}

function buildAdjacency(edges: GraphEdge[]): Map<string, { neighbor: string; edge: GraphEdge }[]> {
  const adjacency = new Map<string, { neighbor: string; edge: GraphEdge }[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ neighbor: edge.target, edge });
    adjacency.get(edge.target)!.push({ neighbor: edge.source, edge });
  }
  return adjacency;
}

export interface RankedPath {
  edges: GraphEdge[];
  nodeIds: string[];
  /** Mean edge strength, discounted by length: strong short paths first. */
  strength: number;
}

/**
 * Pure: every simple path between two nodes up to `maxDepth` hops (capped at
 * `maxPaths`), ranked by strength. This powers "how is X exposed to Y" where
 * the shortest path alone hides the interesting second route.
 */
export function findPaths(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fromId: string,
  toId: string,
  { maxDepth = 4, maxPaths = 6 }: { maxDepth?: number; maxPaths?: number } = {},
): RankedPath[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(fromId) || !nodeIds.has(toId) || fromId === toId) return [];

  const adjacency = buildAdjacency(edges);
  const results: RankedPath[] = [];
  const HARD_CAP = 200; // explored-path guard for dense graphs

  let explored = 0;
  const stack: { nodeId: string; path: GraphEdge[]; visited: Set<string> }[] = [
    { nodeId: fromId, path: [], visited: new Set([fromId]) },
  ];
  while (stack.length > 0 && explored < HARD_CAP) {
    const { nodeId, path, visited } = stack.pop()!;
    explored += 1;
    for (const { neighbor, edge } of adjacency.get(nodeId) ?? []) {
      if (visited.has(neighbor)) continue;
      const nextPath = [...path, edge];
      if (neighbor === toId) {
        const meanStrength = nextPath.reduce((s, e) => s + e.strength, 0) / nextPath.length;
        const orderedNodeIds = pathNodeIds(fromId, nextPath);
        results.push({
          edges: nextPath,
          nodeIds: orderedNodeIds,
          strength: Math.round(meanStrength / nextPath.length),
        });
        continue;
      }
      if (nextPath.length < maxDepth) {
        stack.push({ nodeId: neighbor, path: nextPath, visited: new Set([...visited, neighbor]) });
      }
    }
  }

  return results.sort((a, b) => b.strength - a.strength || a.edges.length - b.edges.length).slice(0, maxPaths);
}

/** Pure: reconstruct the ordered node id sequence a path of edges walks through. */
export function pathNodeIds(fromId: string, path: GraphEdge[]): string[] {
  const ordered: string[] = [fromId];
  let current = fromId;
  for (const edge of path) {
    const next = edge.source === current ? edge.target : edge.source;
    ordered.push(next);
    current = next;
  }
  return ordered;
}

/** Pure: render a path of edges into a plain-English deterministic chain description. */
export function describePath(nodes: GraphNode[], path: GraphEdge[]): string {
  if (path.length === 0) return "These are the same entity.";
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const parts: string[] = [];
  for (const edge of path) {
    const source = nodeById.get(edge.source)?.label ?? edge.source;
    const target = nodeById.get(edge.target)?.label ?? edge.target;
    parts.push(`${source} → (${edge.type.replace(/_/g, " ").toLowerCase()}) → ${target}`);
  }
  return parts.join("; then ");
}

function buildExplainPrompt(fromLabel: string, toLabel: string, deterministicSummary: string): string {
  return `You are an investment analyst explaining a connection discovered in a knowledge graph built from real portfolio, sector-rotation, and event data.

CONNECTION: ${fromLabel} to ${toLabel}
DETERMINISTIC PATH (each step is a real, computed relationship; do not invent facts beyond this):
${deterministicSummary}

Explain this connection in plain English for an investor, and note how this kind of connection typically evolves over time. ${JSON_SCHEMA_LEAD_IN}
{
  "explanation": "<2-4 sentence plain-English explanation of why/how these are connected, grounded only in the path above>",
  "historicalEvolution": "<1-2 sentences on how this kind of relationship typically plays out or has played out>",
  "confidence": <0-100 integer, or null if you cannot judge>
}`;
}

/** Find paths between two nodes and explain the strongest — deterministic chain + AI narrative. */
export async function explainConnection(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fromId: string,
  toId: string,
): Promise<ConnectionExplanation> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const ranked = findPaths(nodes, edges, fromId, toId);
  const shortest = findPath(nodes, edges, fromId, toId);
  const generatedAt = new Date().toISOString();

  if (!shortest) {
    return {
      fromId,
      toId,
      pathFound: false,
      path: [],
      pathEdges: [],
      alternativePaths: [],
      deterministicSummary: "No path found in the current graph.",
      aiExplanation:
        "These entities are not connected within the currently loaded graph. Try expanding scope (e.g. load the sector or portfolio view) to surface an indirect connection.",
      confidence: null,
      generatedAt,
    };
  }

  // Present the strongest path (ranked[0]) when multi-path search found one;
  // fall back to BFS-shortest for the degenerate fromId===toId adjacency cases.
  const primary = ranked[0]?.edges ?? shortest;
  const deterministicSummary = describePath(nodes, primary);
  const orderedNodeIds = pathNodeIds(fromId, primary);
  const pathDetail = orderedNodeIds.map((id) => {
    const n = nodeById.get(id);
    return { nodeId: id, label: n?.label ?? id, type: n?.type ?? ("company" as const) };
  });
  const alternativePaths = ranked.slice(1, 4).map((p) => ({
    nodeIds: p.nodeIds,
    labels: p.nodeIds.map((id) => nodeById.get(id)?.label ?? id),
    strength: p.strength,
  }));

  let parsed = EXPLANATION_DEFAULTS;
  try {
    const raw = await runPrompt(
      "knowledge-graph-explain",
      buildExplainPrompt(nodeById.get(fromId)?.label ?? fromId, nodeById.get(toId)?.label ?? toId, deterministicSummary),
      { maxTokens: 700, json: true },
    );
    parsed = parseExplanationResponse(raw);
  } catch {
    // parsed stays at defaults
  }

  return {
    fromId,
    toId,
    pathFound: true,
    path: pathDetail,
    pathEdges: primary,
    alternativePaths,
    deterministicSummary,
    // No explanation (runPrompt failed, or the model returned unparseable/empty
    // JSON) falls back to the deterministic summary rather than showing blank text.
    aiExplanation: parsed.explanation
      ? `${parsed.explanation} ${parsed.historicalEvolution}`.trim()
      : deterministicSummary,
    confidence: parsed.confidence == null ? null : Math.max(0, Math.min(100, parsed.confidence)),
    generatedAt,
  };
}

const EXPLANATION_DEFAULTS: { explanation: string; historicalEvolution: string; confidence: number | null } = {
  explanation: "",
  historicalEvolution: "",
  confidence: null,
};

/** Exported for unit testing — pure, no I/O. */
export function parseExplanationResponse(raw: string): typeof EXPLANATION_DEFAULTS {
  const parsed = extractJsonObject(raw, EXPLANATION_DEFAULTS);
  return { ...parsed, confidence: coerceConfidence(parsed.confidence) };
}

/**
 * Models occasionally return confidence as a numeric string; anything that is
 * not a finite number becomes null (unknown), never a fabricated neutral 50.
 */
function coerceConfidence(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}
