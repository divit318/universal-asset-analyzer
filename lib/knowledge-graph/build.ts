/**
 * Investment Knowledge Graph — graph construction (v2).
 *
 * Deterministic composition only: every node/edge here is derived from data
 * already computed by an existing engine (Sector Rotation, Timeline, Scanner,
 * Portfolio/Watchlist, Yahoo quotes). Nothing is fabricated — this module is
 * an "evidence consumer," not a new scoring/analysis engine.
 *
 * v2 structural guarantees:
 * - Edges are QUEUED and resolved at build() time, so insertion order can
 *   never silently drop an edge again (v1 lost every event->company edge in
 *   symbol scope because events were added before the company node existed).
 * - Degree-0 nodes are pruned at build() time (except the focus node), so no
 *   scope ever seeds a universe of disconnected sector nodes.
 * - Every sector label passes through canonicalizeSector(); an unresolvable
 *   label yields NO sector node (surfaced as "Unclassified" on the asset)
 *   rather than a second taxonomy.
 * - Instrument types are resolved for every asset node; funds connect to
 *   sectors through weighted holdings composition, never a fake
 *   single-sector classification.
 */

import {
  listPortfolio,
  listWatchlist,
  listTimelineEvents,
  listTimelineEventsForSymbols,
  getLatestSectorRotationSnapshots,
} from "../db";
import { getLatestScannerSnapshot } from "../scanner/cache";
import { getFundamentals } from "../fundamentals";
import { resolveScopeSymbols } from "../timeline";
import { canonicalizeSector } from "../gics-sectors";
import type {
  ScannerResult,
  MarketEvent,
  ScannerOpportunity,
  SectorRotationEntry,
  TimelineEvent,
  PortfolioPosition,
  WatchlistItem,
} from "../types";
import {
  resolveInstrument,
  fundSectorExposures,
  displaySymbol,
  isSingleIssuer,
  type ResolvedInstrument,
} from "./instrument";
import { computeLookThrough, fetchFundHoldings, type FundHolding } from "./overlap";
import type { LookThroughResult } from "./types";
import { eventLabels, formatEventDate } from "./label";
import { INSTRUMENT_LABEL } from "./types";
import type { GraphNode, GraphEdge, GraphMeta, GraphScope, NodeType, Provenance } from "./types";

const MAX_TIMELINE_EVENTS_PER_SYMBOL = 6;
const MAX_TIMELINE_EVENTS_PER_HOLDING = 3;
const MAX_MARKET_EVENTS = 8;
const MAX_WATCHLIST = 36;

/** The classification window the rotation engine actually uses (PRIMARY_WINDOW in lib/sector-rotation.ts). */
export const ROTATION_WINDOW_LABEL = "1m relative strength vs. sector average";

const PROV = {
  db: (asOf: string | null = null): Provenance => ({ source: "platform", origin: "user", asOf }),
  yahoo: (asOf: string | null = null): Provenance => ({ source: "yahoo", origin: "computed", asOf }),
  edgar: (asOf: string | null = null): Provenance => ({ source: "sec_edgar", origin: "computed", asOf }),
  engine: (asOf: string | null = null): Provenance => ({ source: "platform", origin: "computed", asOf }),
  ai: (asOf: string | null = null): Provenance => ({ source: "platform", origin: "ai", asOf }),
};

interface BuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: GraphMeta;
  /** Portfolio scope only: the look-through overlap analysis. */
  lookThrough: LookThroughResult | null;
}

/** Exported for unit tests — the pruning/dedup invariants are pure. */
export class GraphBuilder {
  private nodes = new Map<string, GraphNode>();
  private pendingEdges: Omit<GraphEdge, "id">[] = [];

  constructor(private focusId: string) {}

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

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Queue an edge; endpoints are checked at build() time, not insertion time. */
  addEdge(edge: Omit<GraphEdge, "id">): void {
    if (edge.source === edge.target) return;
    this.pendingEdges.push(edge);
  }

  /**
   * Resolve queued edges, then prune degree-0 nodes (except the focus).
   * Orphans are impossible by construction after this point.
   */
  build(truncation: GraphMeta["truncation"] = null): BuildResult {
    const edges = new Map<string, GraphEdge>();
    for (const edge of this.pendingEdges) {
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) continue;
      const id = `${edge.source}::${edge.type}::${edge.target}`;
      if (!edges.has(id)) edges.set(id, { ...edge, id });
    }

    const degree = new Map<string, number>();
    for (const e of edges.values()) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }

    let isolatesDropped = 0;
    const nodes: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if ((degree.get(node.id) ?? 0) === 0 && node.id !== this.focusId) {
        isolatesDropped += 1;
        continue;
      }
      nodes.push(node);
    }

    return {
      nodes,
      edges: [...edges.values()],
      meta: { focusId: this.focusId, truncation, isolatesDropped },
      lookThrough: null,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Node id helpers                                                            */
/* -------------------------------------------------------------------------- */

const companyId = (symbol: string) => `company:${symbol.toUpperCase()}`;
const sectorId = (sector: string) => `sector:${sector}`;
const eventId = (id: string) => `event:${id}`;
const marketEventId = (id: string) => `market:${id}`;
const opportunityId = (id: string) => `opportunity:${id}`;
const thesisId = (id: string) => `thesis:${id}`;

/* -------------------------------------------------------------------------- */
/* Node builders                                                              */
/* -------------------------------------------------------------------------- */

function assetNode(resolved: ResolvedInstrument, importance: number, weight: number | null = null): GraphNode {
  const { symbol, name, instrument, sector, quote } = resolved;
  const short = displaySymbol(symbol, instrument);
  const metrics: GraphNode["metrics"] = {
    instrument: INSTRUMENT_LABEL[instrument],
  };
  if (quote) {
    metrics.price = quote.price;
    metrics.changePercent = Math.round(quote.changePercent * 100) / 100;
    metrics.currency = quote.currency;
  }
  metrics.sector = sector ?? (isSingleIssuer(instrument) ? "Unclassified" : null);
  return {
    id: companyId(symbol),
    type: "company",
    instrument,
    label: short,
    fullLabel: name && name !== symbol ? `${short} (${name})` : short,
    summary: name,
    importance,
    confidence: null,
    sector,
    weight,
    metrics,
    provenance: PROV.yahoo(),
    href: `/research?symbol=${encodeURIComponent(symbol)}`,
  };
}

/** Fallback asset node for tickers we only know from scanner text (no quote fetch). */
function bareAssetNode(symbol: string, importance: number): GraphNode {
  const sym = symbol.toUpperCase();
  return {
    id: companyId(sym),
    type: "company",
    instrument: "unknown",
    label: sym,
    fullLabel: sym,
    summary: sym,
    importance,
    confidence: null,
    sector: null,
    weight: null,
    metrics: { instrument: INSTRUMENT_LABEL.unknown },
    provenance: PROV.engine(),
    href: `/research?symbol=${encodeURIComponent(sym)}`,
  };
}

function sectorNode(entry: SectorRotationEntry | null, canonical: string, asOf: string | null): GraphNode {
  return {
    id: sectorId(canonical),
    type: "sector",
    instrument: null,
    label: canonical,
    fullLabel: canonical,
    summary: entry
      ? `Rank #${entry.rank}/11 by relative strength (${ROTATION_WINDOW_LABEL}): ${entry.classification}`
      : "GICS sector",
    importance: entry ? Math.max(30, 100 - (entry.rank - 1) * 6) : 40,
    confidence: null,
    sector: canonical,
    weight: null,
    metrics: entry
      ? { rank: entry.rank, classification: entry.classification, relativeStrength: entry.relativeStrength }
      : {},
    provenance: PROV.engine(asOf),
    href: `/knowledge-graph?scope=sector&id=${encodeURIComponent(canonical)}`,
  };
}

function timelineEventNode(event: TimelineEvent): GraphNode {
  const labels = eventLabels(event);
  const isFiling = event.source.kind === "filing";
  return {
    id: eventId(event.id),
    type: "timeline_event",
    instrument: null,
    label: labels.short,
    fullLabel: labels.full,
    summary: event.title,
    importance: event.importanceScore,
    confidence: event.confidenceScore,
    sector: null,
    weight: null,
    metrics: {
      category: event.category,
      impact: event.impact,
      date: formatEventDate(event.timestamp),
      source: event.source.kind,
    },
    provenance: isFiling ? PROV.edgar(event.timestamp) : PROV.engine(event.timestamp),
    href: event.source.url ?? `/research?symbol=${encodeURIComponent(event.symbol)}`,
  };
}

function marketEventNode(event: MarketEvent): GraphNode {
  return {
    id: marketEventId(event.id),
    type: "market_event",
    instrument: null,
    label: event.headline.length > 60 ? `${event.headline.slice(0, 57)}…` : event.headline,
    fullLabel: event.headline,
    summary: event.summary,
    importance: 40 + event.causalChain.length * 10,
    confidence: null,
    sector: null,
    weight: null,
    metrics: { category: event.category, date: formatEventDate(event.publishedAt) },
    provenance: PROV.ai(event.publishedAt),
    href: "/wire",
  };
}

function opportunityNode(opp: ScannerOpportunity): GraphNode {
  return {
    id: opportunityId(opp.id),
    type: "opportunity",
    instrument: null,
    label: `${opp.ticker} opportunity`,
    fullLabel: `${opp.ticker} opportunity: ${opp.theme}`,
    summary: opp.rationale,
    importance: opp.opportunityScore.composite,
    confidence: opp.opportunityScore.composite,
    sector: null,
    weight: null,
    metrics: { verdict: opp.opportunityScore.verdict, direction: opp.direction, theme: opp.theme },
    provenance: PROV.ai(),
    href: "/wire",
  };
}

function portfolioSingletonNode(): GraphNode {
  return {
    id: "portfolio:main",
    type: "portfolio",
    instrument: null,
    label: "Your Portfolio",
    fullLabel: "Your Portfolio",
    summary: "Current portfolio holdings",
    importance: 90,
    confidence: null,
    sector: null,
    weight: null,
    metrics: {},
    provenance: PROV.db(),
    href: "/portfolio",
  };
}

function watchlistSingletonNode(): GraphNode {
  return {
    id: "watchlist:main",
    type: "watchlist",
    instrument: null,
    label: "Your Watchlist",
    fullLabel: "Your Watchlist",
    summary: "Currently tracked symbols",
    importance: 70,
    confidence: null,
    sector: null,
    weight: null,
    metrics: {},
    provenance: PROV.db(),
    href: "/watchlist",
  };
}

/* -------------------------------------------------------------------------- */
/* Shared evidence providers                                                  */
/* -------------------------------------------------------------------------- */

function latestRotation(): { entries: SectorRotationEntry[]; asOf: string | null } {
  const snapshots = getLatestSectorRotationSnapshots(1);
  return { entries: snapshots[0]?.sectors ?? [], asOf: snapshots[0]?.asOf ?? null };
}

/**
 * Sector rotation neighbors: sectors this one is plausibly rotating capital
 * to/from, from real rank deltas. Only sectors that actually receive an edge
 * are added — v1 seeded all 11 sectors here regardless of connectivity.
 */
function addSectorRotationEdges(
  builder: GraphBuilder,
  focusSector: string,
  allSectors: SectorRotationEntry[],
  asOf: string | null,
): void {
  const focus = allSectors.find((s) => s.sector === focusSector);
  if (!focus || focus.rankChange == null) return;
  for (const other of allSectors) {
    if (other.sector === focusSector || other.rankChange == null) continue;
    const into = focus.rankChange >= 2 && other.rankChange <= -2;
    const outof = focus.rankChange <= -2 && other.rankChange >= 2;
    if (!into && !outof) continue;
    builder.upsertNode(sectorNode(other, other.sector, asOf));
    const [winner, loser] = into ? [focus, other] : [other, focus];
    builder.addEdge({
      source: sectorId(loser.sector),
      target: sectorId(winner.sector),
      type: "ROTATES_TO",
      label: "capital rotating to",
      confidence: null,
      strength: Math.min(100, (winner.rankChange! - loser.rankChange!) * 10),
      directed: true,
      evidence: `${winner.sector} moved up ${winner.rankChange} ranks while ${loser.sector} fell ${Math.abs(loser.rankChange!)} ranks (${ROTATION_WINDOW_LABEL})`,
      provenance: PROV.engine(asOf),
      timestamp: asOf,
    });
  }
}

/** Pull the most recent cached Scanner auto-scan (best-effort, never triggers a live pipeline run). */
function getCachedScanner(): { result: ScannerResult; asOf: string } | null {
  const snap = getLatestScannerSnapshot();
  return snap ? { result: snap.result, asOf: snap.generatedAt } : null;
}

function addScannerEvidence(builder: GraphBuilder, symbol: string, sector: string | null, rotationAsOf: string | null): void {
  const cached = getCachedScanner();
  if (!cached) return;
  const { result, asOf } = cached;
  const { entries } = latestRotation();

  const relevantEvents = result.events
    .filter((e) => e.affectedTickers.includes(symbol) || (sector != null && e.affectedSectors.some((s) => canonicalizeSector(s) === sector)))
    .slice(0, MAX_MARKET_EVENTS);

  for (const event of relevantEvents) {
    builder.upsertNode(marketEventNode(event));
    builder.addEdge({
      source: marketEventId(event.id),
      target: companyId(symbol),
      type: "IMPACTS",
      label: "impacts",
      confidence: null,
      strength: event.affectedTickers.includes(symbol) ? 80 : 45,
      directed: true,
      evidence: event.headline,
      provenance: PROV.ai(asOf),
      timestamp: event.publishedAt,
    });
    // First-order causal chain -> other sectors/tickers this same event touches,
    // which is exactly how "what connects NVIDIA and Microsoft" gets answered.
    for (const effect of event.causalChain) {
      for (const rawSector of effect.affectedSectors) {
        const canonical = canonicalizeSector(rawSector);
        if (canonical == null || canonical === sector) continue;
        const entry = entries.find((s) => s.sector === canonical) ?? null;
        builder.upsertNode(sectorNode(entry, canonical, rotationAsOf));
        builder.addEdge({
          source: marketEventId(event.id),
          target: sectorId(canonical),
          type: "IMPACTS",
          label: `${effect.order === 1 ? "1st" : "2nd"}-order impact`,
          confidence: null,
          strength: effect.order === 1 ? 60 : 35,
          directed: true,
          evidence: effect.description,
          provenance: PROV.ai(asOf),
          timestamp: event.publishedAt,
        });
      }
      for (const otherTicker of effect.affectedTickers) {
        if (otherTicker === symbol) continue;
        builder.upsertNode(bareAssetNode(otherTicker, 40));
        builder.addEdge({
          source: marketEventId(event.id),
          target: companyId(otherTicker),
          type: "IMPACTS",
          label: `${effect.order === 1 ? "1st" : "2nd"}-order impact`,
          confidence: null,
          strength: effect.order === 1 ? 60 : 35,
          directed: true,
          evidence: effect.description,
          provenance: PROV.ai(asOf),
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
      directed: true,
      evidence: opportunity.rationale,
      provenance: PROV.ai(asOf),
      timestamp: null,
    });
    if (opportunity.thesis) {
      const tId = thesisId(opportunity.id);
      builder.upsertNode({
        id: tId,
        type: "thesis",
        instrument: null,
        label: opportunity.thesis.headline,
        fullLabel: opportunity.thesis.headline,
        summary: opportunity.thesis.summary,
        importance: opportunity.thesis.confidence,
        confidence: opportunity.thesis.confidence,
        sector: null,
        weight: null,
        metrics: { timeHorizon: opportunity.thesis.timeHorizon },
        provenance: PROV.ai(asOf),
        href: "/wire",
      });
      builder.addEdge({
        source: opportunityId(opportunity.id),
        target: tId,
        type: "DRIVES",
        label: "drives",
        confidence: opportunity.thesis.confidence,
        strength: opportunity.thesis.confidence,
        directed: true,
        evidence: opportunity.thesis.summary,
        provenance: PROV.ai(asOf),
        timestamp: null,
      });
    }
  }
}

function addTimelineEvents(builder: GraphBuilder, symbol: string, events: TimelineEvent[]): void {
  for (const event of events) {
    builder.upsertNode(timelineEventNode(event));
    const edgeType =
      event.thesisImpact === "strengthened" ? "SUPPORTED_BY" : event.thesisImpact === "weakened" ? "CONTRADICTED_BY" : "IMPACTS";
    builder.addEdge({
      source: eventId(event.id),
      target: companyId(symbol),
      type: edgeType,
      label: edgeType.toLowerCase().replace(/_/g, " "),
      confidence: event.confidenceScore,
      strength: event.importanceScore,
      directed: true,
      evidence: event.title,
      provenance: event.source.kind === "filing" ? PROV.edgar(event.timestamp) : PROV.engine(event.timestamp),
      timestamp: event.timestamp,
    });
  }
}

/** Classification edges for one resolved asset: single sector for issuers, weighted exposures for funds. */
async function addClassificationEdges(
  builder: GraphBuilder,
  resolved: ResolvedInstrument,
  entries: SectorRotationEntry[],
  rotationAsOf: string | null,
): Promise<void> {
  const nodeId = companyId(resolved.symbol);
  if (isSingleIssuer(resolved.instrument)) {
    if (!resolved.sector) return; // Unclassified: surfaced on the node, never guessed.
    const entry = entries.find((s) => s.sector === resolved.sector) ?? null;
    builder.upsertNode(sectorNode(entry, resolved.sector, rotationAsOf));
    builder.addEdge({
      source: nodeId,
      target: sectorId(resolved.sector),
      type: "OPERATES_IN",
      label: "operates in",
      confidence: null,
      strength: 60,
      directed: true,
      evidence: `Yahoo Finance classifies ${resolved.symbol} under ${resolved.sector}`,
      provenance: PROV.yahoo(),
      timestamp: null,
    });
    return;
  }

  // Funds: weighted sector exposure from holdings composition, when Yahoo has it.
  if (resolved.instrument.startsWith("etf_") || resolved.instrument === "mutual_fund") {
    const exposures = await fundSectorExposures(resolved.symbol);
    for (const { sector, weight } of exposures.slice(0, 4)) {
      const entry = entries.find((s) => s.sector === sector) ?? null;
      builder.upsertNode(sectorNode(entry, sector, rotationAsOf));
      builder.addEdge({
        source: nodeId,
        target: sectorId(sector),
        type: "EXPOSED_TO",
        label: `${Math.round(weight * 100)}% exposed to`,
        confidence: null,
        strength: Math.round(weight * 100),
        directed: true,
        evidence: `${Math.round(weight * 100)}% of ${resolved.symbol}'s holdings are ${sector} (Yahoo holdings composition)`,
        provenance: PROV.yahoo(),
        timestamp: null,
      });
    }
  }
  // FX pairs, crypto, futures, indices: no sector edge. Honest absence.
}

/* -------------------------------------------------------------------------- */
/* Scope builders                                                             */
/* -------------------------------------------------------------------------- */

/** Build the graph centered on a single symbol. */
export async function buildSymbolGraph(symbol: string): Promise<BuildResult> {
  const sym = symbol.toUpperCase();
  const builder = new GraphBuilder(companyId(sym));

  const [fundamentals, events] = await Promise.all([
    getFundamentals(sym).catch(() => null),
    Promise.resolve(
      listTimelineEvents(sym)
        .sort((a, b) => b.importanceScore - a.importanceScore)
        .slice(0, MAX_TIMELINE_EVENTS_PER_SYMBOL),
    ),
  ]);
  const resolved = await resolveInstrument(sym, fundamentals?.snapshot.sector ?? null);

  builder.upsertNode(assetNode(resolved, 100));
  addTimelineEvents(builder, sym, events);

  const { entries, asOf } = latestRotation();
  await addClassificationEdges(builder, resolved, entries, asOf);
  if (resolved.sector) addSectorRotationEdges(builder, resolved.sector, entries, asOf);

  if (listPortfolio().some((p) => p.symbol === sym)) {
    builder.upsertNode(portfolioSingletonNode());
    builder.addEdge({
      source: "portfolio:main",
      target: companyId(sym),
      type: "OWNS",
      label: "owns",
      confidence: null,
      strength: 80,
      directed: true,
      evidence: "Currently held in your portfolio",
      provenance: PROV.db(),
      timestamp: null,
    });
  }
  if (listWatchlist().some((w) => w.symbol === sym)) {
    builder.upsertNode(watchlistSingletonNode());
    builder.addEdge({
      source: "watchlist:main",
      target: companyId(sym),
      type: "WATCHES",
      label: "watches",
      confidence: null,
      strength: 50,
      directed: true,
      evidence: "Currently on your watchlist",
      provenance: PROV.db(),
      timestamp: null,
    });
  }

  addScannerEvidence(builder, sym, resolved.sector, asOf);

  return builder.build();
}

/* -------------------------------------------------------------------------- */
/* Portfolio / Watchlist                                                      */
/* -------------------------------------------------------------------------- */

async function buildHoldingsGraph(
  holdings: (PortfolioPosition | WatchlistItem)[],
  center: GraphNode,
  edgeType: "OWNS" | "WATCHES",
  cap: number,
): Promise<BuildResult> {
  const builder = new GraphBuilder(center.id);
  builder.upsertNode(center);

  const capped = holdings.slice(0, cap);
  const truncation = holdings.length > capped.length ? { shown: capped.length, total: holdings.length } : null;
  const { entries, asOf } = latestRotation();

  const timelineBySymbol = listTimelineEventsForSymbols(capped.map((h) => h.symbol))
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .reduce((acc, e) => {
      const list = acc.get(e.symbol) ?? [];
      if (list.length < MAX_TIMELINE_EVENTS_PER_HOLDING) list.push(e);
      acc.set(e.symbol, list);
      return acc;
    }, new Map<string, TimelineEvent[]>());

  const resolvedAll = await Promise.all(
    capped.map(async (h) => {
      const fundamentals = await getFundamentals(h.symbol).catch(() => null);
      return resolveInstrument(h.symbol, fundamentals?.snapshot.sector ?? null);
    }),
  );

  // Position value per holding: live market value when the quote resolved,
  // cost basis otherwise (and the evidence string says which one it is).
  const isPortfolio = edgeType === "OWNS";
  const values = capped.map((h, i) => {
    if (!isPortfolio) return null;
    const pos = h as PortfolioPosition;
    const price = resolvedAll[i].quote?.price;
    if (price != null && pos.shares > 0) return { value: price * pos.shares, basis: "market" as const };
    if (pos.shares > 0 && pos.avgCost > 0) return { value: pos.avgCost * pos.shares, basis: "cost" as const };
    return null;
  });
  const totalValue = values.reduce((sum, v) => sum + (v?.value ?? 0), 0);

  for (let i = 0; i < capped.length; i++) {
    const holding = capped[i];
    const resolved = resolvedAll[i];
    const value = values[i];
    const weight = totalValue > 0 && value ? value.value / totalValue : null;

    const importance = weight != null ? Math.round(35 + 65 * Math.min(1, weight / 0.25)) : 55;
    const node = builder.upsertNode(assetNode(resolved, importance, weight));

    if (isPortfolio && value != null) {
      const pos = holding as PortfolioPosition;
      node.metrics.shares = pos.shares;
      node.metrics.avgCost = pos.avgCost;
      node.metrics.positionValue = Math.round(value.value * 100) / 100;
      node.metrics.valuationBasis = value.basis;
      if (resolved.quote?.price != null && pos.avgCost > 0) {
        node.metrics.unrealizedPnlPct = Math.round(((resolved.quote.price - pos.avgCost) / pos.avgCost) * 10000) / 100;
      }
    }

    builder.addEdge({
      source: center.id,
      target: node.id,
      type: edgeType,
      label: edgeType.toLowerCase(),
      confidence: null,
      strength: weight != null ? Math.max(20, Math.min(100, Math.round(weight * 400))) : 50,
      directed: true,
      evidence:
        weight != null
          ? `${(weight * 100).toFixed(1)}% of portfolio (${value!.basis === "market" ? "market value" : "cost basis"})`
          : `${resolved.symbol} is on your ${isPortfolio ? "portfolio" : "watchlist"}`,
      provenance: PROV.db(),
      timestamp: null,
    });

    await addClassificationEdges(builder, resolved, entries, asOf);
    addTimelineEvents(builder, holding.symbol, timelineBySymbol.get(holding.symbol) ?? []);
  }

  // Look-through overlap: portfolio scope only (it needs real book weights).
  let lookThrough: LookThroughResult | null = null;
  if (isPortfolio) {
    const isFund = (r: ResolvedInstrument) => r.instrument.startsWith("etf_") || r.instrument === "mutual_fund";
    const positionInputs = capped.map((h, i) => ({
      symbol: resolvedAll[i].symbol,
      name: resolvedAll[i].name,
      weight: totalValue > 0 && values[i] ? values[i]!.value / totalValue : 0,
      isFund: isFund(resolvedAll[i]),
    }));
    const funds = resolvedAll.filter(isFund);
    const holdingsByFund = new Map<string, FundHolding[]>(
      await Promise.all(
        funds.map(async (f) => [f.symbol, await fetchFundHoldings(f.symbol)] as [string, FundHolding[]]),
      ),
    );
    const result = computeLookThrough(positionInputs, holdingsByFund);
    if (result.exposures.length > 0 || result.fundOverlaps.length > 0) {
      lookThrough = result;
      // Draw the overlap: HOLDS edges from each fund to every underlying the
      // book reaches at least twice. Underlyings not otherwise in the graph
      // enter as unresolved asset nodes (no quote fetch for a name that only
      // exists inside a fund's disclosure).
      for (const exposure of result.exposures.slice(0, 10)) {
        const underlyingId = companyId(exposure.symbol);
        if (!builder.hasNode(underlyingId)) {
          const node = bareAssetNode(exposure.symbol, Math.round(30 + exposure.effectiveWeight * 400));
          node.summary = exposure.name;
          node.fullLabel = exposure.name !== exposure.symbol ? `${exposure.symbol} (${exposure.name})` : exposure.symbol;
          builder.upsertNode(node);
        }
        for (const route of exposure.routes) {
          builder.addEdge({
            source: companyId(route.via),
            target: underlyingId,
            type: "HOLDS",
            label: `holds ${(route.holdingWeight * 100).toFixed(1)}%`,
            confidence: null,
            strength: Math.max(10, Math.min(100, Math.round(route.holdingWeight * 300))),
            directed: true,
            evidence: `${exposure.name} is ${(route.holdingWeight * 100).toFixed(1)}% of ${route.via}'s disclosed holdings, contributing ${(route.contribution * 100).toFixed(2)}% of the book`,
            provenance: PROV.yahoo(),
            timestamp: null,
          });
        }
      }
    }
  }

  return { ...builder.build(truncation), lookThrough };
}

export async function buildPortfolioGraph(): Promise<BuildResult> {
  return buildHoldingsGraph(listPortfolio(), portfolioSingletonNode(), "OWNS", Number.MAX_SAFE_INTEGER);
}

export async function buildWatchlistGraph(): Promise<BuildResult> {
  return buildHoldingsGraph(listWatchlist(), watchlistSingletonNode(), "WATCHES", MAX_WATCHLIST);
}

/* -------------------------------------------------------------------------- */
/* Sector                                                                     */
/* -------------------------------------------------------------------------- */

export async function buildSectorGraph(sector: string): Promise<BuildResult> {
  const canonical = canonicalizeSector(sector) ?? sector;
  const builder = new GraphBuilder(sectorId(canonical));
  const { entries, asOf } = latestRotation();
  const entry = entries.find((s) => s.sector === canonical) ?? null;
  builder.upsertNode(sectorNode(entry, canonical, asOf));
  addSectorRotationEdges(builder, canonical, entries, asOf);

  const portfolio = listPortfolio();
  const watchlist = listWatchlist();
  const seen = new Set<string>();
  const members = [...portfolio, ...watchlist].filter((h) => {
    if (seen.has(h.symbol)) return false;
    seen.add(h.symbol);
    return true;
  });

  const resolvedAll = await Promise.all(
    members.map(async (h) => {
      const fundamentals = await getFundamentals(h.symbol).catch(() => null);
      return resolveInstrument(h.symbol, fundamentals?.snapshot.sector ?? null);
    }),
  );

  const addMembership = (resolved: ResolvedInstrument, nodeId: string) => {
    const isHeld = portfolio.some((p) => p.symbol === resolved.symbol);
    builder.upsertNode(isHeld ? portfolioSingletonNode() : watchlistSingletonNode());
    builder.addEdge({
      source: isHeld ? "portfolio:main" : "watchlist:main",
      target: nodeId,
      type: isHeld ? "OWNS" : "WATCHES",
      label: isHeld ? "owns" : "watches",
      confidence: null,
      strength: 60,
      directed: true,
      evidence: `${resolved.symbol} is ${isHeld ? "held in your portfolio" : "on your watchlist"}`,
      provenance: PROV.db(),
      timestamp: null,
    });
  };

  for (const resolved of resolvedAll) {
    if (resolved.sector === canonical) {
      const node = builder.upsertNode(assetNode(resolved, 55));
      builder.addEdge({
        source: node.id,
        target: sectorId(canonical),
        type: "OPERATES_IN",
        label: "operates in",
        confidence: null,
        strength: 60,
        directed: true,
        evidence: `Yahoo Finance classifies ${resolved.symbol} under ${canonical}`,
        provenance: PROV.yahoo(),
        timestamp: null,
      });
      addMembership(resolved, node.id);
      continue;
    }
    // Tracked funds with measured exposure to this sector belong in its
    // graph too: a 39%-Technology VOO position IS Technology exposure.
    if (resolved.instrument.startsWith("etf_") || resolved.instrument === "mutual_fund") {
      const exposure = (await fundSectorExposures(resolved.symbol)).find((e) => e.sector === canonical);
      if (!exposure) continue;
      const node = builder.upsertNode(assetNode(resolved, 45));
      builder.addEdge({
        source: node.id,
        target: sectorId(canonical),
        type: "EXPOSED_TO",
        label: `${Math.round(exposure.weight * 100)}% exposed to`,
        confidence: null,
        strength: Math.round(exposure.weight * 100),
        directed: true,
        evidence: `${Math.round(exposure.weight * 100)}% of ${resolved.symbol}'s holdings are ${canonical} (Yahoo holdings composition)`,
        provenance: PROV.yahoo(),
        timestamp: null,
      });
      addMembership(resolved, node.id);
    }
  }

  // Scanner events that touch this sector (edges to the sector node, plus any
  // opportunity for a ticker already in this graph). The v1 theme-substring
  // join that pulled in unrelated tickers is deliberately gone.
  const cached = getCachedScanner();
  if (cached) {
    const relevant = cached.result.events
      .filter((e) => e.affectedSectors.some((s) => canonicalizeSector(s) === canonical))
      .slice(0, MAX_MARKET_EVENTS);
    for (const event of relevant) {
      builder.upsertNode(marketEventNode(event));
      builder.addEdge({
        source: marketEventId(event.id),
        target: sectorId(canonical),
        type: "IMPACTS",
        label: "impacts",
        confidence: null,
        strength: 55,
        directed: true,
        evidence: event.headline,
        provenance: PROV.ai(cached.asOf),
        timestamp: event.publishedAt,
      });
    }
    for (const opp of cached.result.opportunities) {
      if (!builder.hasNode(companyId(opp.ticker))) continue;
      builder.upsertNode(opportunityNode(opp));
      builder.addEdge({
        source: companyId(opp.ticker),
        target: opportunityId(opp.id),
        type: "GENERATES",
        label: "generates",
        confidence: opp.opportunityScore.composite,
        strength: opp.opportunityScore.composite,
        directed: true,
        evidence: opp.rationale,
        provenance: PROV.ai(cached.asOf),
        timestamp: null,
      });
    }
  }

  return builder.build();
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

/** Resolve a graph scope into its underlying node/edge set. */
export async function buildGraph(scope: GraphScope, id: string): Promise<BuildResult> {
  if (scope === "symbol") return buildSymbolGraph(id.toUpperCase());
  if (scope === "portfolio") return buildPortfolioGraph();
  if (scope === "watchlist") return buildWatchlistGraph();
  return buildSectorGraph(id);
}

export { resolveScopeSymbols };
export type { NodeType };
