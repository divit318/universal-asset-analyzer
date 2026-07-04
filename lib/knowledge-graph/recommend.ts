/**
 * Investment Knowledge Graph — insight surfacing.
 *
 * Pure analysis over an already-built graph: sector concentration, hidden
 * opportunities (nodes reachable but not owned), emerging risks, and
 * correlation clusters. No new scoring — reuses whatever confidence/impact
 * values the evidence-provider engines already attached to each node.
 */

import type { GraphNode, GraphEdge, GraphInsights } from "./types";

/** Pure: portfolio/watchlist sector concentration from OPERATES_IN edges off owned/watched companies. */
function computeConcentration(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["concentrationRisks"] {
  const ownedIds = new Set(edges.filter((e) => e.type === "OWNS").map((e) => e.target));
  if (ownedIds.size === 0) return [];

  const sectorOf = new Map<string, string>();
  for (const edge of edges) {
    if (edge.type === "OPERATES_IN" && ownedIds.has(edge.source)) sectorOf.set(edge.source, edge.target);
  }

  const bySector = new Map<string, string[]>();
  for (const [companyNodeId, sectorNodeId] of sectorOf) {
    const label = nodes.find((n) => n.id === companyNodeId)?.label ?? companyNodeId;
    const sectorLabel = nodes.find((n) => n.id === sectorNodeId)?.label ?? sectorNodeId;
    if (!bySector.has(sectorLabel)) bySector.set(sectorLabel, []);
    bySector.get(sectorLabel)!.push(label);
  }

  return [...bySector.entries()]
    .filter(([, symbols]) => symbols.length >= 2)
    .map(([sector, symbols]) => ({ sector, nodeCount: symbols.length, symbols }))
    .sort((a, b) => b.nodeCount - a.nodeCount);
}

/** Pure: opportunity nodes reachable in the graph that aren't already owned. */
function computeHiddenOpportunities(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["hiddenOpportunities"] {
  const ownedSymbols = new Set(
    edges.filter((e) => e.type === "OWNS").map((e) => nodes.find((n) => n.id === e.target)?.label),
  );
  return nodes
    .filter((n) => n.type === "opportunity")
    .filter((n) => {
      // An opportunity's label is "<TICKER> opportunity" — find the linked company via a GENERATES edge.
      const companyEdge = edges.find((e) => e.type === "GENERATES" && e.target === n.id);
      const companyLabel = companyEdge ? nodes.find((c) => c.id === companyEdge.source)?.label : null;
      return companyLabel != null && !ownedSymbols.has(companyLabel);
    })
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((n) => ({ nodeId: n.id, label: n.label, reason: n.summary }));
}

/** Pure: high-importance bearish timeline events connected to owned/watched companies. */
function computeEmergingRisks(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights["emergingRisks"] {
  const trackedIds = new Set(edges.filter((e) => e.type === "OWNS" || e.type === "WATCHES").map((e) => e.target));
  return nodes
    .filter((n) => n.type === "timeline_event" && n.metrics.impact === "bearish" && n.importance >= 55)
    .filter((n) => edges.some((e) => e.source === n.id && trackedIds.has(e.target)))
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((n) => ({ nodeId: n.id, label: n.label, reason: `Importance ${n.importance}/100, bearish impact` }));
}

/** Pure: sectors sharing the same rotation classification — a correlated cluster in the current market regime. */
function computeCorrelationClusters(nodes: GraphNode[]): GraphInsights["correlationClusters"] {
  const bySector = nodes.filter((n) => n.type === "sector" && typeof n.metrics.classification === "string");
  const byClassification = new Map<string, string[]>();
  for (const n of bySector) {
    const cls = n.metrics.classification as string;
    if (!byClassification.has(cls)) byClassification.set(cls, []);
    byClassification.get(cls)!.push(n.label);
  }
  return [...byClassification.entries()]
    .filter(([, sectors]) => sectors.length >= 2)
    .map(([classification, sectors]) => ({ classification, sectors }));
}

export function computeGraphInsights(nodes: GraphNode[], edges: GraphEdge[]): GraphInsights {
  return {
    concentrationRisks: computeConcentration(nodes, edges),
    hiddenOpportunities: computeHiddenOpportunities(nodes, edges),
    emergingRisks: computeEmergingRisks(nodes, edges),
    correlationClusters: computeCorrelationClusters(nodes),
  };
}
