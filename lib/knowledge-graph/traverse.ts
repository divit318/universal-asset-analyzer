/**
 * Investment Knowledge Graph — traversal.
 *
 * Deterministic pathfinding is pure (no I/O); AI is only used to narrate an
 * already-found path (or explain why none exists), matching the
 * "AI explains, engines decide" split used throughout this codebase.
 */

import { runPrompt } from "../ai";
import { extractJson } from "../json-extract";
import type { GraphNode, GraphEdge, ConnectionExplanation } from "./types";

/** Pure: BFS shortest path between two nodes, treating edges as undirected for connectivity purposes. */
export function findPath(nodes: GraphNode[], edges: GraphEdge[], fromId: string, toId: string): GraphEdge[] | null {
  if (fromId === toId) return [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(fromId) || !nodeIds.has(toId)) return null;

  const adjacency = new Map<string, { neighbor: string; edge: GraphEdge }[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
    adjacency.get(edge.source)!.push({ neighbor: edge.target, edge });
    adjacency.get(edge.target)!.push({ neighbor: edge.source, edge });
  }

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

interface RawExplanationResponse {
  explanation: string;
  historicalEvolution: string;
  confidence: number;
}

function buildExplainPrompt(fromLabel: string, toLabel: string, deterministicSummary: string): string {
  return `You are an investment analyst explaining a connection discovered in a knowledge graph built from real portfolio, sector-rotation, and event data.

CONNECTION: ${fromLabel} to ${toLabel}
DETERMINISTIC PATH (each step is a real, computed relationship — do not invent facts beyond this):
${deterministicSummary}

Explain this connection in plain English for an investor, and note how this kind of connection typically evolves over time. Return ONLY valid JSON:
{
  "explanation": "<2-4 sentence plain-English explanation of why/how these are connected, grounded only in the path above>",
  "historicalEvolution": "<1-2 sentences on how this kind of relationship typically plays out or has played out>",
  "confidence": <0-100 integer>
}`;
}

/** Find a path between two nodes and explain it — deterministic chain + AI narrative. */
export async function explainConnection(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fromId: string,
  toId: string,
): Promise<ConnectionExplanation> {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const path = findPath(nodes, edges, fromId, toId);
  const generatedAt = new Date().toISOString();

  if (!path) {
    return {
      fromId,
      toId,
      pathFound: false,
      path: [],
      pathEdges: [],
      deterministicSummary: "No path found in the current graph.",
      aiExplanation: "These entities are not connected within the currently loaded graph. Try expanding scope (e.g. load the sector or portfolio view) to surface an indirect connection.",
      confidence: 0,
      generatedAt,
    };
  }

  const deterministicSummary = describePath(nodes, path);

  // Walk the edge list to reconstruct the ordered node sequence from fromId to toId.
  const orderedNodeIds: string[] = [fromId];
  let current = fromId;
  for (const edge of path) {
    const next = edge.source === current ? edge.target : edge.source;
    orderedNodeIds.push(next);
    current = next;
  }
  const pathDetail = orderedNodeIds.map((id) => {
    const n = nodeById.get(id);
    return { nodeId: id, label: n?.label ?? id, type: n?.type ?? ("company" as const) };
  });

  let parsed: RawExplanationResponse | null = null;
  try {
    const raw = await runPrompt(
      buildExplainPrompt(nodeById.get(fromId)?.label ?? fromId, nodeById.get(toId)?.label ?? toId, deterministicSummary),
      { maxTokens: 700, json: true },
    );
    parsed = extractJson<RawExplanationResponse>(raw);
  } catch {
    parsed = null;
  }

  return {
    fromId,
    toId,
    pathFound: true,
    path: pathDetail,
    pathEdges: path,
    deterministicSummary,
    aiExplanation: parsed
      ? `${parsed.explanation} ${parsed.historicalEvolution}`.trim()
      : deterministicSummary,
    confidence: Math.max(0, Math.min(100, parsed?.confidence ?? 50)),
    generatedAt,
  };
}
