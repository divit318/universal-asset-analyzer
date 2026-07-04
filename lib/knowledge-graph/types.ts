/**
 * Investment Knowledge Graph — type system.
 *
 * The graph is computed on-demand from existing UAA stores (portfolio,
 * watchlist, sector rotation, timeline events, cached scanner output) — it
 * is not a new source of truth. See build.ts for the "evidence provider"
 * composition and ARCHITECTURE.md's "Investment Knowledge Graph" section.
 */

export type GraphScope = "symbol" | "portfolio" | "watchlist" | "sector";

export type NodeType =
  | "company"
  | "sector"
  | "portfolio"
  | "watchlist"
  | "timeline_event"
  | "market_event"
  | "opportunity"
  | "thesis"
  | "catalyst"
  | "risk";

export type EdgeType =
  | "OWNS"
  | "WATCHES"
  | "OPERATES_IN"
  | "IMPACTS"
  | "GENERATES"
  | "SUPPORTED_BY"
  | "CONTRADICTED_BY"
  | "TRIGGERED"
  | "ROTATES_TO"
  | "ROTATES_FROM"
  | "DRIVES";

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  summary: string;
  /** 0-100, drives node size in the visualization. */
  importance: number;
  /** 0-100, deterministic confidence in this node's evidence. */
  confidence: number;
  metrics: Record<string, string | number | null>;
  /** Deep link into the existing page that owns this entity (Research, Timeline, Scanner, etc). */
  href: string | null;
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  type: EdgeType;
  label: string;
  confidence: number; // 0-100, deterministic
  strength: number; // 0-100, drives edge thickness
  evidence: string;
  timestamp: string | null;
}

export interface KnowledgeGraph {
  scope: GraphScope;
  id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  insights: GraphInsights;
  generatedAt: string;
}

export interface GraphInsights {
  concentrationRisks: { sector: string; nodeCount: number; symbols: string[] }[];
  hiddenOpportunities: { nodeId: string; label: string; reason: string }[];
  emergingRisks: { nodeId: string; label: string; reason: string }[];
  correlationClusters: { classification: string; sectors: string[] }[];
}

export interface ConnectionExplanation {
  fromId: string;
  toId: string;
  pathFound: boolean;
  path: { nodeId: string; label: string; type: NodeType }[];
  pathEdges: GraphEdge[];
  deterministicSummary: string;
  aiExplanation: string;
  confidence: number;
  generatedAt: string;
}
