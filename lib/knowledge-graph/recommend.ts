/**
 * Investment Knowledge Graph — insight surfacing (v2).
 *
 * Pure analysis over an already-built graph: sector concentration (position-
 * weighted when weights are known), hidden opportunities, emerging risks,
 * correlation clusters, and graph-level stats. No new scoring — reuses
 * whatever confidence/impact values the evidence-provider engines already
 * attached to each node.
 *
 * Everything here is scope-aware by construction: v2 graphs only contain
 * connected nodes, so "the sectors in this graph" now means "the sectors this
 * scope actually touches" rather than the seeded 11-sector universe that made
 * v1's correlation clusters byte-identical across scopes.
 */

import type { GraphNode, GraphEdge, GraphInsights, GraphStats, LookThroughResult } from "./types";

/**
 * Portfolio/watchlist sector concentration from classification edges off
 * owned companies. Weighted when the nodes carry position weights; flagged at
 * 2+ names in one sector, or any single sector above 25% of book value.
 */
function computeConcentration(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["concentrationRisks"] {
  const ownedIds = new Set(edges.filter((e) => e.type === "OWNS").map((e) => e.target));
  if (ownedIds.size === 0) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const bySector = new Map<string, { symbols: string[]; weight: number; weightKnown: boolean }>();
  for (const id of ownedIds) {
    const node = nodeById.get(id);
    if (!node?.sector) continue;
    const entry = bySector.get(node.sector) ?? { symbols: [], weight: 0, weightKnown: false };
    entry.symbols.push(node.label);
    if (node.weight != null) {
      entry.weight += node.weight;
      entry.weightKnown = true;
    }
    bySector.set(node.sector, entry);
  }

  return [...bySector.entries()]
    .filter(([, v]) => v.symbols.length >= 2 || (v.weightKnown && v.weight >= 0.25))
    .map(([sector, v]) => ({
      sector,
      nodeCount: v.symbols.length,
      symbols: v.symbols,
      weight: v.weightKnown ? Math.round(v.weight * 1000) / 1000 : null,
    }))
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0) || b.nodeCount - a.nodeCount);
}

/** Opportunity nodes reachable in the graph that aren't already owned. */
function computeHiddenOpportunities(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["hiddenOpportunities"] {
  const ownedSymbols = new Set(
    edges.filter((e) => e.type === "OWNS").map((e) => nodes.find((n) => n.id === e.target)?.label),
  );
  return nodes
    .filter((n) => n.type === "opportunity")
    .filter((n) => {
      // An opportunity is linked to its company via a GENERATES edge.
      const companyEdge = edges.find((e) => e.type === "GENERATES" && e.target === n.id);
      const companyLabel = companyEdge ? nodes.find((c) => c.id === companyEdge.source)?.label : null;
      return companyLabel != null && !ownedSymbols.has(companyLabel);
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((n) => ({ nodeId: n.id, label: n.label, reason: n.summary }));
}

/** High-importance bearish timeline events connected to owned/watched companies. */
function computeEmergingRisks(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["emergingRisks"] {
  const trackedIds = new Set(edges.filter((e) => e.type === "OWNS" || e.type === "WATCHES").map((e) => e.target));
  return nodes
    .filter((n) => n.type === "timeline_event" && n.metrics.impact === "bearish" && n.importance >= 55)
    .filter((n) => edges.some((e) => e.source === n.id && trackedIds.has(e.target)))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((n) => ({ nodeId: n.id, label: n.label, reason: `Importance ${n.importance}/100, bearish impact` }));
}

/**
 * Sectors in THIS graph sharing the same rotation classification — a
 * correlated cluster in the current market regime. The window label is
 * attached so the UI never shows a bare "leading" with no definition.
 */
function computeCorrelationClusters(nodes: GraphNode[], windowLabel: string): GraphInsights["correlationClusters"] {
  const bySector = nodes.filter((n) => n.type === "sector" && typeof n.metrics.classification === "string");
  const byClassification = new Map<string, string[]>();
  for (const n of bySector) {
    const cls = n.metrics.classification as string;
    if (!byClassification.has(cls)) byClassification.set(cls, []);
    byClassification.get(cls)!.push(n.label);
  }
  return [...byClassification.entries()]
    .filter(([, sectors]) => sectors.length >= 2)
    .map(([classification, sectors]) => ({ classification, sectors, window: windowLabel }));
}

export function computeGraphStats(nodes: GraphNode[], edges: GraphEdge[]): GraphStats {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const n = nodes.length;
  const possible = (n * (n - 1)) / 2;
  const mostConnected = [...degree.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([nodeId, deg]) => ({
      nodeId,
      label: nodes.find((node) => node.id === nodeId)?.label ?? nodeId,
      degree: deg,
    }));
  return {
    nodes: n,
    edges: edges.length,
    density: possible > 0 ? Math.round((edges.length / possible) * 1000) / 1000 : 0,
    mostConnected,
  };
}

export function computeGraphInsights(
  nodes: GraphNode[],
  edges: GraphEdge[],
  windowLabel: string,
  lookThrough: LookThroughResult | null = null,
): GraphInsights {
  return {
    lookThrough,
    concentrationRisks: computeConcentration(nodes, edges),
    hiddenOpportunities: computeHiddenOpportunities(nodes, edges),
    emergingRisks: computeEmergingRisks(nodes, edges),
    correlationClusters: computeCorrelationClusters(nodes, windowLabel),
    stats: computeGraphStats(nodes, edges),
  };
}
