/**
 * Investment Knowledge Graph — graph construction.
 *
 * Deterministic composition only: every node/edge here is derived from data
 * already computed by an existing engine (Sector Rotation, Timeline, Scanner,
 * Portfolio/Watchlist). Nothing is fabricated and nothing is duplicated —
 * this module is an "evidence consumer," not a new scoring/analysis engine.
 */

import {
  listPortfolio,
  listWatchlist,
  listTimelineEvents,
  listTimelineEventsForSymbols,
  getLatestSectorRotationSnapshots,
  getScannerCache,
} from "../db";
import { getFundamentals } from "../fundamentals";
import { resolveScopeSymbols } from "../timeline";
import type {
  ScannerResult,
  MarketEvent,
  ScannerOpportunity,
  SectorRotationEntry,
  TimelineEvent,
  PortfolioPosition,
  WatchlistItem,
} from "../types";
import type { GraphNode, GraphEdge, GraphScope, NodeType } from "./types";

const MAX_TIMELINE_EVENTS_PER_SYMBOL = 6;
const MAX_MARKET_EVENTS = 8;
const MAX_HOLDINGS = 12;

class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  upsertNode(node: GraphNode): GraphNode {
    const existing = this.nodes.get(node.id);
    if (existing) {
      // Keep the higher-importance version if the same node is added twice
      // (e.g. a company reached via two different holdings).
      if (node.importance > existing.importance) this.nodes.set(node.id, node);
      return this.nodes.get(node.id)!;
    }
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(edge: Omit<GraphEdge, "id">): void {
    if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) return;
    if (edge.source === edge.target) return;
    const id = `${edge.source}::${edge.type}::${edge.target}`;
    if (this.edges.has(id)) return;
    this.edges.set(id, { ...edge, id });
  }

  build(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
  }
}

const companyId = (symbol: string) => `company:${symbol.toUpperCase()}`;
const sectorId = (sector: string) => `sector:${sector}`;
const eventId = (id: string) => `event:${id}`;
const marketEventId = (id: string) => `market:${id}`;
const opportunityId = (id: string) => `opportunity:${id}`;
const thesisId = (id: string) => `thesis:${id}`;

function companyNode(symbol: string, name: string, importance: number): GraphNode {
  return {
    id: companyId(symbol),
    type: "company",
    label: symbol.toUpperCase(),
    summary: name,
    importance,
    confidence: 90,
    metrics: { name },
    href: `/research?symbol=${encodeURIComponent(symbol)}`,
  };
}

function sectorNode(entry: SectorRotationEntry | null, name: string): GraphNode {
  return {
    id: sectorId(name),
    type: "sector",
    label: name,
    summary: entry
      ? `Rank #${entry.rank}/11 by relative strength — ${entry.classification}`
      : "Sector",
    importance: entry ? Math.max(30, 100 - (entry.rank - 1) * 6) : 40,
    confidence: entry ? 85 : 40,
    metrics: entry
      ? { rank: entry.rank, classification: entry.classification, relativeStrength: entry.relativeStrength }
      : {},
    href: `/intelligence?view=timeline&scope=sector&id=${encodeURIComponent(name)}`,
  };
}

function timelineEventNode(event: TimelineEvent): GraphNode {
  return {
    id: eventId(event.id),
    type: "timeline_event",
    label: event.title.length > 60 ? `${event.title.slice(0, 57)}...` : event.title,
    summary: event.title,
    importance: event.importanceScore,
    confidence: event.confidenceScore,
    metrics: { category: event.category, impact: event.impact, date: event.timestamp.slice(0, 10) },
    href: `/intelligence?view=timeline&scope=symbol&id=${encodeURIComponent(event.symbol)}`,
  };
}

function marketEventNode(event: MarketEvent): GraphNode {
  return {
    id: marketEventId(event.id),
    type: "market_event",
    label: event.headline.length > 60 ? `${event.headline.slice(0, 57)}...` : event.headline,
    summary: event.summary,
    importance: 40 + event.causalChain.length * 10,
    confidence: 70,
    metrics: { category: event.category, publishedAt: event.publishedAt.slice(0, 10) },
    href: "/scanner",
  };
}

function opportunityNode(opp: ScannerOpportunity): GraphNode {
  return {
    id: opportunityId(opp.id),
    type: "opportunity",
    label: `${opp.ticker} opportunity`,
    summary: opp.rationale,
    importance: opp.opportunityScore.composite,
    confidence: opp.opportunityScore.composite,
    metrics: { verdict: opp.opportunityScore.verdict, direction: opp.direction, theme: opp.theme },
    href: "/scanner",
  };
}

/** Sector rotation neighbors: sectors this one is plausibly rotating capital to/from, from real rank deltas. */
function addSectorRotationEdges(builder: GraphBuilder, focusSector: string, allSectors: SectorRotationEntry[]): void {
  const focus = allSectors.find((s) => s.sector === focusSector);
  if (!focus) return;
  for (const other of allSectors) {
    if (other.sector === focusSector) continue;
    builder.upsertNode(sectorNode(other, other.sector));
    // Capital rotating INTO the strengthening sector FROM the weakening one.
    if (focus.rankChange != null && other.rankChange != null) {
      if (focus.rankChange >= 2 && other.rankChange <= -2) {
        builder.addEdge({
          source: sectorId(other.sector),
          target: sectorId(focusSector),
          type: "ROTATES_TO",
          label: "capital rotating to",
          confidence: 65,
          strength: Math.min(100, (focus.rankChange - other.rankChange) * 10),
          evidence: `${focusSector} moved up ${focus.rankChange} ranks while ${other.sector} fell ${Math.abs(other.rankChange)} ranks`,
          timestamp: null,
        });
      } else if (focus.rankChange <= -2 && other.rankChange >= 2) {
        builder.addEdge({
          source: sectorId(focusSector),
          target: sectorId(other.sector),
          type: "ROTATES_TO",
          label: "capital rotating to",
          confidence: 65,
          strength: Math.min(100, (other.rankChange - focus.rankChange) * 10),
          evidence: `${other.sector} moved up ${other.rankChange} ranks while ${focusSector} fell ${Math.abs(focus.rankChange)} ranks`,
          timestamp: null,
        });
      }
    }
  }
}

/** Pull the most recent cached Scanner auto-scan (best-effort, never triggers a live pipeline run). */
function getCachedScannerResult(): ScannerResult | null {
  const cached = getScannerCache("v2::true:true");
  if (!cached) return null;
  try {
    return JSON.parse(cached) as ScannerResult;
  } catch {
    return null;
  }
}

function addScannerEvidence(builder: GraphBuilder, symbol: string, sector: string | null): void {
  const result = getCachedScannerResult();
  if (!result) return;

  const relevantEvents = result.events
    .filter((e) => e.affectedTickers.includes(symbol) || (sector != null && e.affectedSectors.includes(sector)))
    .slice(0, MAX_MARKET_EVENTS);

  for (const event of relevantEvents) {
    builder.upsertNode(marketEventNode(event));
    builder.addEdge({
      source: marketEventId(event.id),
      target: companyId(symbol),
      type: "IMPACTS",
      label: "impacts",
      confidence: 70,
      strength: event.affectedTickers.includes(symbol) ? 80 : 45,
      evidence: event.headline,
      timestamp: event.publishedAt,
    });
    // First-order causal chain -> other sectors/tickers this same event touches,
    // which is exactly how "what connects NVIDIA and Microsoft" gets answered.
    for (const effect of event.causalChain) {
      for (const otherSector of effect.affectedSectors) {
        if (sector != null && otherSector === sector) continue;
        builder.upsertNode(sectorNode(null, otherSector));
        builder.addEdge({
          source: marketEventId(event.id),
          target: sectorId(otherSector),
          type: "IMPACTS",
          label: `${effect.order === 1 ? "1st" : "2nd"}-order impact`,
          confidence: 55,
          strength: effect.order === 1 ? 60 : 35,
          evidence: effect.description,
          timestamp: event.publishedAt,
        });
      }
      for (const otherTicker of effect.affectedTickers) {
        if (otherTicker === symbol) continue;
        builder.upsertNode(companyNode(otherTicker, otherTicker, 40));
        builder.addEdge({
          source: marketEventId(event.id),
          target: companyId(otherTicker),
          type: "IMPACTS",
          label: `${effect.order === 1 ? "1st" : "2nd"}-order impact`,
          confidence: 55,
          strength: effect.order === 1 ? 60 : 35,
          evidence: effect.description,
          timestamp: event.publishedAt,
        });
      }
    }
  }

  const opportunity = result.opportunities.find((o) => o.ticker === symbol);
  if (opportunity) {
    builder.upsertNode(opportunityNode(opportunity));
    builder.addEdge({
      source: companyId(symbol),
      target: opportunityId(opportunity.id),
      type: "GENERATES",
      label: "generates",
      confidence: opportunity.opportunityScore.composite,
      strength: opportunity.opportunityScore.composite,
      evidence: opportunity.rationale,
      timestamp: null,
    });
    if (opportunity.thesis) {
      const tId = thesisId(opportunity.id);
      builder.upsertNode({
        id: tId,
        type: "thesis",
        label: opportunity.thesis.headline,
        summary: opportunity.thesis.summary,
        importance: opportunity.thesis.confidence,
        confidence: opportunity.thesis.confidence,
        metrics: { timeHorizon: opportunity.thesis.timeHorizon },
        href: "/scanner",
      });
      builder.addEdge({
        source: opportunityId(opportunity.id),
        target: tId,
        type: "DRIVES",
        label: "drives",
        confidence: opportunity.thesis.confidence,
        strength: opportunity.thesis.confidence,
        evidence: opportunity.thesis.summary,
        timestamp: null,
      });
    }
  }
}

async function addTimelineEvidence(builder: GraphBuilder, symbol: string): Promise<TimelineEvent[]> {
  const events = listTimelineEvents(symbol)
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, MAX_TIMELINE_EVENTS_PER_SYMBOL);

  for (const event of events) {
    builder.upsertNode(timelineEventNode(event));
    const edgeType = event.thesisImpact === "strengthened" ? "SUPPORTED_BY" : event.thesisImpact === "weakened" ? "CONTRADICTED_BY" : "IMPACTS";
    builder.addEdge({
      source: eventId(event.id),
      target: companyId(symbol),
      type: edgeType,
      label: edgeType.toLowerCase().replace("_", " "),
      confidence: event.confidenceScore,
      strength: event.importanceScore,
      evidence: event.title,
      timestamp: event.timestamp,
    });
  }
  return events;
}

/** Build the graph centered on a single symbol. */
export async function buildSymbolGraph(symbol: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const builder = new GraphBuilder();
  const [fundamentals] = await Promise.all([
    getFundamentals(symbol).catch(() => null),
    addTimelineEvidence(builder, symbol),
  ]);

  const sector = fundamentals?.snapshot.sector ?? null;
  builder.upsertNode(companyNode(symbol, symbol, 100));

  if (sector) {
    const snapshots = getLatestSectorRotationSnapshots(1);
    const entries = snapshots[0]?.sectors ?? [];
    const entry = entries.find((s) => s.sector === sector) ?? null;
    builder.upsertNode(sectorNode(entry, sector));
    builder.addEdge({
      source: companyId(symbol),
      target: sectorId(sector),
      type: "OPERATES_IN",
      label: "operates in",
      confidence: 90,
      strength: 70,
      evidence: `${symbol} is classified under ${sector}`,
      timestamp: null,
    });
    if (entries.length > 0) addSectorRotationEdges(builder, sector, entries);
  }

  const portfolio = listPortfolio();
  if (portfolio.some((p) => p.symbol === symbol)) {
    builder.upsertNode(portfolioSingletonNode());
    builder.addEdge({
      source: portfolioSingletonNode().id,
      target: companyId(symbol),
      type: "OWNS",
      label: "owns",
      confidence: 100,
      strength: 80,
      evidence: "Currently held in your portfolio",
      timestamp: null,
    });
  }
  const watchlist = listWatchlist();
  if (watchlist.some((w) => w.symbol === symbol)) {
    builder.upsertNode(watchlistSingletonNode());
    builder.addEdge({
      source: watchlistSingletonNode().id,
      target: companyId(symbol),
      type: "WATCHES",
      label: "watches",
      confidence: 100,
      strength: 50,
      evidence: "Currently on your watchlist",
      timestamp: null,
    });
  }

  addScannerEvidence(builder, symbol, sector);

  return builder.build();
}

function portfolioSingletonNode(): GraphNode {
  return {
    id: "portfolio:main",
    type: "portfolio",
    label: "Your Portfolio",
    summary: "Current portfolio holdings",
    importance: 90,
    confidence: 100,
    metrics: {},
    href: "/portfolio",
  };
}

function watchlistSingletonNode(): GraphNode {
  return {
    id: "watchlist:main",
    type: "watchlist",
    label: "Your Watchlist",
    summary: "Currently tracked symbols",
    importance: 70,
    confidence: 100,
    metrics: {},
    href: "/watchlist",
  };
}

async function buildHoldingsGraph(
  holdings: (PortfolioPosition | WatchlistItem)[],
  center: GraphNode,
  edgeType: "OWNS" | "WATCHES",
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const builder = new GraphBuilder();
  builder.upsertNode(center);

  const capped = holdings.slice(0, MAX_HOLDINGS);
  const sectorEntries = getLatestSectorRotationSnapshots(1)[0]?.sectors ?? [];
  const timelineBySymbol = new Map(
    listTimelineEventsForSymbols(capped.map((h) => h.symbol))
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .reduce((acc, e) => {
        const list = acc.get(e.symbol) ?? [];
        if (list.length < 3) list.push(e);
        acc.set(e.symbol, list);
        return acc;
      }, new Map<string, TimelineEvent[]>()),
  );

  const fundamentalsResults = await Promise.all(
    capped.map((h) => getFundamentals(h.symbol).catch(() => null)),
  );

  capped.forEach((holding, i) => {
    const node = companyNode(holding.symbol, holding.name, 60);
    builder.upsertNode(node);
    builder.addEdge({
      source: center.id,
      target: node.id,
      type: edgeType,
      label: edgeType.toLowerCase(),
      confidence: 100,
      strength: 70,
      evidence: `${holding.symbol} is in your ${edgeType === "OWNS" ? "portfolio" : "watchlist"}`,
      timestamp: null,
    });

    const sector = fundamentalsResults[i]?.snapshot.sector ?? null;
    if (sector) {
      const entry = sectorEntries.find((s) => s.sector === sector) ?? null;
      builder.upsertNode(sectorNode(entry, sector));
      builder.addEdge({
        source: node.id,
        target: sectorId(sector),
        type: "OPERATES_IN",
        label: "operates in",
        confidence: 90,
        strength: 60,
        evidence: `${holding.symbol} is classified under ${sector}`,
        timestamp: null,
      });
    }

    for (const event of timelineBySymbol.get(holding.symbol) ?? []) {
      builder.upsertNode(timelineEventNode(event));
      const edgeT = event.thesisImpact === "strengthened" ? "SUPPORTED_BY" : event.thesisImpact === "weakened" ? "CONTRADICTED_BY" : "IMPACTS";
      builder.addEdge({
        source: eventId(event.id),
        target: node.id,
        type: edgeT,
        label: edgeT.toLowerCase().replace("_", " "),
        confidence: event.confidenceScore,
        strength: event.importanceScore,
        evidence: event.title,
        timestamp: event.timestamp,
      });
    }
  });

  return builder.build();
}

export async function buildPortfolioGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return buildHoldingsGraph(listPortfolio(), portfolioSingletonNode(), "OWNS");
}

export async function buildWatchlistGraph(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  return buildHoldingsGraph(listWatchlist(), watchlistSingletonNode(), "WATCHES");
}

export async function buildSectorGraph(sector: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const builder = new GraphBuilder();
  const entries = getLatestSectorRotationSnapshots(1)[0]?.sectors ?? [];
  const entry = entries.find((s) => s.sector === sector) ?? null;
  builder.upsertNode(sectorNode(entry, sector));
  if (entries.length > 0) addSectorRotationEdges(builder, sector, entries);

  const [portfolio, watchlist] = [listPortfolio(), listWatchlist()];
  const fundamentalsResults = await Promise.all(
    [...portfolio, ...watchlist].map(async (h) => ({ h, f: await getFundamentals(h.symbol).catch(() => null) })),
  );
  for (const { h, f } of fundamentalsResults) {
    if (f?.snapshot.sector !== sector) continue;
    const node = companyNode(h.symbol, h.name, 55);
    builder.upsertNode(node);
    builder.addEdge({
      source: node.id,
      target: sectorId(sector),
      type: "OPERATES_IN",
      label: "operates in",
      confidence: 90,
      strength: 60,
      evidence: `${h.symbol} is classified under ${sector}`,
      timestamp: null,
    });
    const isHeld = portfolio.some((p) => p.symbol === h.symbol);
    builder.upsertNode(isHeld ? portfolioSingletonNode() : watchlistSingletonNode());
    builder.addEdge({
      source: isHeld ? "portfolio:main" : "watchlist:main",
      target: node.id,
      type: isHeld ? "OWNS" : "WATCHES",
      label: isHeld ? "owns" : "watches",
      confidence: 100,
      strength: 70,
      evidence: `${h.symbol} is ${isHeld ? "held in your portfolio" : "on your watchlist"}`,
      timestamp: null,
    });
  }

  const result = getCachedScannerResult();
  if (result) {
    const impact = result.sectorImpacts.find((s) => s.sector === sector);
    if (impact) {
      const opportunitiesInSector = result.opportunities.filter((o) => o.theme.toLowerCase().includes(sector.toLowerCase()));
      for (const opp of opportunitiesInSector.slice(0, 5)) {
        builder.upsertNode(companyNode(opp.ticker, opp.name, 45));
        builder.addEdge({
          source: sectorId(sector),
          target: companyId(opp.ticker),
          type: "IMPACTS",
          label: "sector impact",
          confidence: 60,
          strength: impact.strength,
          evidence: impact.rationale,
          timestamp: null,
        });
        builder.upsertNode(opportunityNode(opp));
        builder.addEdge({
          source: companyId(opp.ticker),
          target: opportunityId(opp.id),
          type: "GENERATES",
          label: "generates",
          confidence: opp.opportunityScore.composite,
          strength: opp.opportunityScore.composite,
          evidence: opp.rationale,
          timestamp: null,
        });
      }
    }
  }

  return builder.build();
}

/** Resolve a graph scope into its underlying node/edge set. */
export async function buildGraph(scope: GraphScope, id: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  if (scope === "symbol") return buildSymbolGraph(id.toUpperCase());
  if (scope === "portfolio") return buildPortfolioGraph();
  if (scope === "watchlist") return buildWatchlistGraph();
  return buildSectorGraph(id);
}

export { resolveScopeSymbols };
export type { NodeType };
