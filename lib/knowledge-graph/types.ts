/**
 * Investment Knowledge Graph — type system (v2).
 *
 * The graph is computed on-demand from existing UAA stores (portfolio,
 * watchlist, sector rotation, timeline events, cached scanner output). It is
 * not a new source of truth. See build.ts for the "evidence provider"
 * composition.
 *
 * v2 principles:
 * - One normalized schema everywhere. Every node knows its instrument type,
 *   canonical sector, provenance, and full (untruncated) label.
 * - Confidence is `number | null`. Null means "unknown" and is a preferred,
 *   honest output; nothing in this module fabricates a confidence score.
 * - Zero orphans by construction: build.ts prunes degree-0 nodes (except the
 *   focus node) before a graph leaves the builder.
 */

import type { DataSourceId } from "../provenance";

export type GraphScope = "symbol" | "portfolio" | "watchlist" | "sector";

/**
 * `company` is the node type for any tradeable asset (kept for backward
 * compatibility with consumers that match on `company:*` ids — Research's
 * graph preview card and the AI context builder). The `instrument` field is
 * what distinguishes an FX pair from an ETF from a common stock.
 */
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

export type InstrumentType =
  | "common_equity"
  | "preferred"
  | "etf_equity"
  | "etf_bond"
  | "etf_commodity"
  | "etf_mixed"
  | "mutual_fund"
  | "fx_pair"
  | "crypto"
  | "future"
  | "index"
  /** The ledger's synthetic cash sleeve (CASH-USD lots). Face value, never quoted. */
  | "cash"
  | "unknown";

export const INSTRUMENT_LABEL: Record<InstrumentType, string> = {
  common_equity: "Common Equity",
  preferred: "Preferred Share",
  etf_equity: "Equity ETF",
  etf_bond: "Bond ETF",
  etf_commodity: "Commodity ETF",
  etf_mixed: "Mixed-Asset ETF",
  mutual_fund: "Mutual Fund",
  fx_pair: "FX Pair",
  crypto: "Digital Asset",
  future: "Futures Contract",
  index: "Index",
  cash: "Cash",
  unknown: "Unclassified Instrument",
};

export type EdgeType =
  | "OWNS"
  | "WATCHES"
  | "OPERATES_IN"
  /** Weighted fund-to-sector exposure derived from holdings composition. */
  | "EXPOSED_TO"
  /** Fund-to-underlying-security edge from the fund's disclosed top holdings. */
  | "HOLDS"
  /** Asset-to-sector edge: the asset is a disclosed top holding of the sector's SPDR ETF. */
  | "CONSTITUENT"
  | "IMPACTS"
  | "GENERATES"
  | "SUPPORTED_BY"
  | "CONTRADICTED_BY"
  | "TRIGGERED"
  | "ROTATES_TO"
  | "ROTATES_FROM"
  | "DRIVES";

/** How a node/edge came to exist, and how trustworthy it is. */
export interface Provenance {
  /** The upstream feed or engine the fact came from. */
  source: DataSourceId;
  /** "computed" = deterministic engine output; "ai" = model-generated; "user" = user-entered. */
  origin: "computed" | "ai" | "user";
  /** When the underlying fact was produced/fetched. Null = unknown. */
  asOf: string | null;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  /** Only meaningful for asset ("company") nodes; null elsewhere. */
  instrument: InstrumentType | null;
  /** Short display label (what the canvas draws). */
  label: string;
  /** Untruncated label for tooltips/inspector; never elided. */
  fullLabel: string;
  summary: string;
  /** 0-100, drives node size in the visualization. */
  importance: number;
  /** 0-100 when an engine computed one; null = unknown (never fabricated). */
  confidence: number | null;
  /** Canonical GICS-11 sector, or null = unclassified. */
  sector: string | null;
  /** Position weight in the current scope (0-1 share of book value), when known. */
  weight: number | null;
  metrics: Record<string, string | number | null>;
  provenance: Provenance;
  /** Deep link into the page that owns this entity (Research, Timeline, Wire…). */
  href: string | null;
}

export interface GraphEdge {
  id: string;
  source: string; // node id
  target: string; // node id
  type: EdgeType;
  label: string;
  /** 0-100 when an engine computed one; null = unknown. */
  confidence: number | null;
  /** 0-100, drives edge thickness. */
  strength: number;
  /** True when the relation is semantically directed source -> target. */
  directed: boolean;
  evidence: string;
  provenance: Provenance;
  timestamp: string | null;
}

/** What changed vs. the previous stored snapshot of the same scope. */
export interface GraphChanges {
  previousAt: string;
  addedNodes: { id: string; label: string; type: NodeType }[];
  removedNodes: { id: string; label: string; type: NodeType }[];
  addedEdges: { id: string; label: string; sourceLabel: string; targetLabel: string }[];
  removedEdges: { id: string; label: string; sourceLabel: string; targetLabel: string }[];
}

/**
 * One display-ready row of the "Since your last visit" feed: deduplicated
 * (an added node subsumes its own added edges), per-entity capped, ranked by
 * materiality, timestamped. Produced by summarizeChanges (diff.ts, pure).
 */
export interface ChangeEntry {
  key: string;
  kind: "added" | "removed";
  /** Node id to focus when the entry is clicked; null when the node left the graph. */
  nodeId: string | null;
  label: string;
  /** Untruncated text for the tooltip. */
  fullLabel: string;
  /** ISO timestamp of the underlying fact when known. */
  at: string | null;
  /** 0-100 ranking weight (node importance / edge strength; 50 when unknown). */
  materiality: number;
}

export interface ChangeFeed {
  previousAt: string;
  entries: ChangeEntry[];
  /** Entries hidden by the per-entity cap and the overall cap. */
  hiddenCount: number;
}

export interface GraphMeta {
  /** The node the scope centers on (framed/kept even at degree 0). */
  focusId: string;
  /** Set when the builder capped a holdings list; honest counts, not silence. */
  truncation: { shown: number; total: number } | null;
  /** Degree-0 nodes dropped during finalization (visible in the isolates toggle). */
  isolatesDropped: number;
}

export interface KnowledgeGraph {
  scope: GraphScope;
  id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  insights: GraphInsights;
  meta: GraphMeta;
  /** Null on first visit for a scope, or when the previous snapshot is unreadable. */
  changes: GraphChanges | null;
  generatedAt: string;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  /** edges / possible edges, 0-1. */
  density: number;
  mostConnected: { nodeId: string; label: string; degree: number }[];
}

/* -------------------------------------------------------------------------- */
/* Look-through overlap (see overlap.ts for the engine; types live here so    */
/* client components can import them without pulling in lib/yahoo.ts)         */
/* -------------------------------------------------------------------------- */

export interface LookThroughRoute {
  /** Fund ticker the exposure flows through. */
  via: string;
  /** Book weight of the fund position, 0-1. */
  fundWeight: number;
  /** The underlying's weight inside the fund, 0-1. */
  holdingWeight: number;
  /** fundWeight x holdingWeight, 0-1 of the whole book. */
  contribution: number;
}

export interface LookThroughExposure {
  symbol: string;
  name: string;
  /** Book weight held directly, 0-1 (0 when only reached through funds). */
  directWeight: number;
  routes: LookThroughRoute[];
  /** directWeight + all route contributions, 0-1. */
  effectiveWeight: number;
  /** Number of distinct ways the book holds this: direct counts as one. */
  routeCount: number;
}

export interface FundOverlapPair {
  fundA: string;
  fundB: string;
  sharedSymbols: string[];
  /** Mean shared disclosed weight across the two funds, 0-1. */
  sharedWeight: number;
}

export interface LookThroughResult {
  exposures: LookThroughExposure[];
  fundOverlaps: FundOverlapPair[];
  /** Rendered verbatim in the UI: the floor-not-estimate caveat travels with the data. */
  basis: string;
}

export interface GraphInsights {
  /** Portfolio scope only; null elsewhere or when the book holds no funds. */
  lookThrough: LookThroughResult | null;
  concentrationRisks: {
    sector: string;
    nodeCount: number;
    symbols: string[];
    /** Combined position weight (0-1) when position values are known; null otherwise. */
    weight: number | null;
  }[];
  hiddenOpportunities: { nodeId: string; label: string; reason: string }[];
  emergingRisks: { nodeId: string; label: string; reason: string }[];
  correlationClusters: {
    classification: string;
    sectors: string[];
    /** The lookback the rotation engine's classification is computed over. */
    window: string;
  }[];
  stats: GraphStats;
}

export interface ConnectionExplanation {
  fromId: string;
  toId: string;
  pathFound: boolean;
  path: { nodeId: string; label: string; type: NodeType }[];
  pathEdges: GraphEdge[];
  /** Alternative paths (beyond the strongest), each as an ordered edge list. */
  alternativePaths: { nodeIds: string[]; labels: string[]; strength: number }[];
  deterministicSummary: string;
  aiExplanation: string;
  /** Null when the model did not return a usable confidence. */
  confidence: number | null;
  generatedAt: string;
}

/** One claim in the AI narrative; every claim must cite nodes in the graph. */
export interface NarrativeObservation {
  text: string;
  nodeIds: string[];
}

export interface GraphNarrative {
  observations: NarrativeObservation[];
  /** Always "ai" — surfaced so the UI can label the panel honestly. */
  origin: "ai";
  model: string | null;
  generatedAt: string;
}
