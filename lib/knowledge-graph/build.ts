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
  listUniversalLots,
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
  type LedgerAssetClass,
  type ResolvedInstrument,
} from "./instrument";
import { computeLookThrough, fetchFundHoldings, type FundHolding } from "./overlap";
import type { LookThroughResult } from "./types";
import { eventLabels, formatEventDate } from "./label";
import { timelineEventLinks, eventQualifiesForUsScope, normalizedTitleKey } from "./relevance";
import { SECTOR_ETF_MAP } from "../sector-rotation";
import { INSTRUMENT_LABEL } from "./types";
import type { GraphNode, GraphEdge, GraphMeta, GraphScope, NodeType, Provenance } from "./types";

const MAX_TIMELINE_EVENTS_PER_SYMBOL = 6;
const MAX_TIMELINE_EVENTS_PER_HOLDING = 3;
const MAX_MARKET_EVENTS = 8;
const MAX_WATCHLIST = 36;
/** Causal-chain fanout bound: only tracked tickers, and never more than this per event (KG-001/002). */
const MAX_CHAIN_TICKERS_PER_EVENT = 4;
const MAX_CHAIN_SECTORS_PER_EVENT = 3;
/** Representative members a sector graph seeds from its SPDR ETF's disclosed top holdings (KG-006). */
const MAX_SECTOR_CONSTITUENTS = 8;

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
   * Resolve queued edges, then:
   * 1. collapse near-duplicate event nodes (same story from two wires = one
   *    node; edges re-point to the survivor),
   * 2. suppress hubs — no non-focus node may out-connect the focus. Surplus
   *    edges are dropped weakest-first (edges to the focus are never dropped)
   *    and the count is recorded on the node as metrics.suppressedLinks,
   * 3. prune degree-0 nodes (except the focus).
   * Orphans are impossible by construction after this point.
   */
  build(truncation: GraphMeta["truncation"] = null): BuildResult {
    // 1. Near-duplicate event collapse (KG-013). First-seen node wins.
    const canonicalId = new Map<string, string>();
    const byTitleKey = new Map<string, string>();
    for (const node of this.nodes.values()) {
      if (node.type !== "timeline_event" && node.type !== "market_event") continue;
      const key = normalizedTitleKey(node.fullLabel.replace(/^[A-Z0-9.=-]{1,12}\s*·\s*/, ""));
      const existing = byTitleKey.get(key);
      if (existing && existing !== node.id) canonicalId.set(node.id, existing);
      else byTitleKey.set(key, node.id);
    }
    for (const dup of canonicalId.keys()) this.nodes.delete(dup);

    const edges = new Map<string, GraphEdge>();
    for (const edge of this.pendingEdges) {
      const source = canonicalId.get(edge.source) ?? edge.source;
      const target = canonicalId.get(edge.target) ?? edge.target;
      if (source === target) continue;
      if (!this.nodes.has(source) || !this.nodes.has(target)) continue;
      const id = `${source}::${edge.type}::${target}`;
      if (!edges.has(id)) edges.set(id, { ...edge, source, target, id });
    }

    const degreeOf = (): Map<string, number> => {
      const degree = new Map<string, number>();
      for (const e of edges.values()) {
        degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
        degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
      }
      return degree;
    };

    // 2. Hub suppression (KG-002/003): the focus must be the graph's centre
    //    of gravity. Cap every other node's degree just below the focus's,
    //    dropping its weakest non-focus edges deterministically.
    let degree = degreeOf();
    const focusDegree = degree.get(this.focusId) ?? 0;
    const cap = Math.max(4, focusDegree - 1);
    for (const node of this.nodes.values()) {
      if (node.id === this.focusId) continue;
      const own = [...edges.values()].filter((e) => e.source === node.id || e.target === node.id);
      if (own.length <= cap) continue;
      const ranked = own.sort((a, b) => {
        const aFocus = a.source === this.focusId || a.target === this.focusId ? 1 : 0;
        const bFocus = b.source === this.focusId || b.target === this.focusId ? 1 : 0;
        return bFocus - aFocus || b.strength - a.strength || a.id.localeCompare(b.id);
      });
      const dropped = ranked.slice(cap);
      for (const e of dropped) edges.delete(e.id);
      node.metrics.suppressedLinks = dropped.length;
    }

    // 3. Prune isolates (including any created by suppression).
    degree = degreeOf();
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
  // Never a silent default bucket: an unresolved node says why (KG-007).
  if (instrument === "unknown") {
    metrics.unresolvedReason = quote ? `Yahoo quoteType "${quote.assetType ?? "?"}" is not recognized` : "No quote data available for this symbol";
  }
  if (instrument === "cash") {
    return {
      id: companyId(symbol),
      type: "company",
      instrument,
      label: "Cash",
      fullLabel: "Cash (USD sleeve, face value)",
      summary: "Uninvested cash in the book. Valued at face; carries no sector or market events.",
      importance,
      confidence: null,
      sector: null,
      weight,
      metrics,
      provenance: PROV.db(),
      href: "/portfolio",
    };
  }
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
    provenance: PROV.yahoo(quote?.regularMarketTime ?? null),
    href: `/research?symbol=${encodeURIComponent(symbol)}`,
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
  // "TSM opportunity" carried zero information (KG-023); the label now states
  // the theme and direction, and the one-line rationale rides in fullLabel.
  return {
    id: opportunityId(opp.id),
    type: "opportunity",
    instrument: null,
    label: `${opp.ticker} · ${opp.theme} (${opp.direction})`,
    fullLabel: `${opp.ticker} ${opp.direction} on ${opp.theme}: ${opp.rationale}`,
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

/**
 * Scanner evidence for symbol scope, bounded to a real ego network
 * (KG-001/002/012):
 *
 * - Region gate: events whose affected tickers are all foreign listings never
 *   enter a US-scoped graph.
 * - Direct events (affectedTickers includes the subject) edge to the subject.
 * - Sector-matched macro events edge to the SECTOR node, not the subject: the
 *   headline is about the sector; the subject reaches it through its own
 *   classification edge. No co-mention artefact can hub onto the subject.
 * - Causal-chain fanout is limited to tickers the user actually tracks
 *   (portfolio or watchlist), capped per event, with resolved instruments.
 */
async function addScannerEvidence(builder: GraphBuilder, symbol: string, sector: string | null, rotationAsOf: string | null): Promise<void> {
  const cached = getCachedScanner();
  if (!cached) return;
  const { result, asOf } = cached;
  const { entries } = latestRotation();
  const tracked = new Set([...listPortfolio().map((p) => p.symbol), ...listWatchlist().map((w) => w.symbol)]);

  const relevantEvents = result.events
    .filter((e) => eventQualifiesForUsScope(e.affectedTickers))
    .filter((e) => e.affectedTickers.includes(symbol) || (sector != null && e.affectedSectors.some((s) => canonicalizeSector(s) === sector)))
    .slice(0, MAX_MARKET_EVENTS);

  for (const event of relevantEvents) {
    const direct = event.affectedTickers.includes(symbol);
    builder.upsertNode(marketEventNode(event));
    if (direct) {
      builder.addEdge({
        source: marketEventId(event.id),
        target: companyId(symbol),
        type: "IMPACTS",
        label: "impacts",
        confidence: null,
        strength: 80,
        directed: true,
        evidence: `${event.headline} (${symbol} is named as an affected ticker)`,
        provenance: PROV.ai(asOf),
        timestamp: event.publishedAt,
      });
    } else if (sector != null) {
      // Sector-mediated relevance stays on the sector node.
      const entry = entries.find((s) => s.sector === sector) ?? null;
      builder.upsertNode(sectorNode(entry, sector, rotationAsOf));
      builder.addEdge({
        source: marketEventId(event.id),
        target: sectorId(sector),
        type: "IMPACTS",
        label: "impacts sector",
        confidence: null,
        strength: 45,
        directed: true,
        evidence: `${event.headline} (tagged ${sector}; reaches ${symbol} only through its sector)`,
        provenance: PROV.ai(asOf),
        timestamp: event.publishedAt,
      });
    }

    // Bounded causal chain: sectors (1st order, capped) and TRACKED tickers
    // only. An event's 40-ticker chain of names the user does not follow is
    // noise in a subject-scoped graph.
    let sectorsAdded = 0;
    const chainTickers: { ticker: string; order: 1 | 2; description: string }[] = [];
    for (const effect of event.causalChain) {
      if (effect.order === 1 && sectorsAdded < MAX_CHAIN_SECTORS_PER_EVENT) {
        for (const rawSector of effect.affectedSectors) {
          if (sectorsAdded >= MAX_CHAIN_SECTORS_PER_EVENT) break;
          const canonical = canonicalizeSector(rawSector);
          if (canonical == null || canonical === sector) continue;
          const entry = entries.find((s) => s.sector === canonical) ?? null;
          builder.upsertNode(sectorNode(entry, canonical, rotationAsOf));
          builder.addEdge({
            source: marketEventId(event.id),
            target: sectorId(canonical),
            type: "IMPACTS",
            label: "1st-order impact",
            confidence: null,
            strength: 60,
            directed: true,
            evidence: effect.description,
            provenance: PROV.ai(asOf),
            timestamp: event.publishedAt,
          });
          sectorsAdded += 1;
        }
      }
      for (const otherTicker of effect.affectedTickers) {
        if (otherTicker === symbol || !tracked.has(otherTicker)) continue;
        if (chainTickers.some((c) => c.ticker === otherTicker)) continue;
        chainTickers.push({ ticker: otherTicker, order: effect.order, description: effect.description });
      }
    }
    const keptChain = chainTickers.slice(0, MAX_CHAIN_TICKERS_PER_EVENT);
    const resolvedChain = await Promise.all(keptChain.map((c) => resolveInstrument(c.ticker)));
    keptChain.forEach((c, i) => {
      builder.upsertNode(assetNode(resolvedChain[i], 40));
      builder.addEdge({
        source: marketEventId(event.id),
        target: companyId(c.ticker),
        type: "IMPACTS",
        label: `${c.order === 1 ? "1st" : "2nd"}-order impact`,
        confidence: null,
        strength: c.order === 1 ? 60 : 35,
        directed: true,
        evidence: `${c.description} (${c.ticker} is on your ${listPortfolio().some((p) => p.symbol === c.ticker) ? "portfolio" : "watchlist"})`,
        provenance: PROV.ai(asOf),
        timestamp: event.publishedAt,
      });
    });
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

/**
 * Attach a symbol's timeline events, gated by subject linkage (KG-011): the
 * timeline store attaches broadcast headlines by co-mention, so a
 * news/scanner event only links here when the headline is materially about
 * the symbol (ticker or company name present). Filings, earnings dates, and
 * alerts are intrinsically about their symbol and always link.
 */
function addTimelineEvents(builder: GraphBuilder, symbol: string, events: TimelineEvent[], companyName: string | null): void {
  for (const event of events) {
    if (!timelineEventLinks(event, companyName)) continue;
    builder.upsertNode(timelineEventNode(event));
    const edgeType =
      event.thesisImpact === "strengthened" ? "SUPPORTED_BY" : event.thesisImpact === "weakened" ? "CONTRADICTED_BY" : "IMPACTS";
    const isBroadcast = event.source.kind === "news" || event.source.kind === "scanner";
    builder.addEdge({
      source: eventId(event.id),
      target: companyId(symbol),
      type: edgeType,
      label: edgeType.toLowerCase().replace(/_/g, " "),
      confidence: event.confidenceScore,
      strength: event.importanceScore,
      directed: true,
      // The linkage basis travels on the edge: broadcast headlines only link
      // when they name the subject; filings/alerts are about it by nature.
      evidence: isBroadcast ? `${event.title} (linked because the headline names ${companyName ?? symbol})` : event.title,
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

  const fundamentals = await getFundamentals(sym).catch(() => null);
  const resolved = await resolveInstrument(sym, fundamentals?.snapshot.sector ?? null, ledgerAssetClasses().get(sym) ?? null);
  // Linkage-gate BEFORE the top-N slice, so co-mention artefacts cannot crowd
  // out events that are actually about the subject (KG-011).
  const events = listTimelineEvents(sym)
    .filter((e) => timelineEventLinks(e, resolved.name))
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .slice(0, MAX_TIMELINE_EVENTS_PER_SYMBOL);

  builder.upsertNode(assetNode(resolved, 100));
  addTimelineEvents(builder, sym, events, resolved.name);

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

  await addScannerEvidence(builder, sym, resolved.sector, asOf);

  return builder.build();
}

/**
 * The ledger's declared asset_class per symbol (first lot wins, matching
 * lib/portfolio/store.ts). This is the namespace guard that keeps the
 * synthetic CASH-USD sleeve from resolving to a micro-cap cryptocurrency and
 * declared equities from flipping to crypto on a ticker collision (KG-008/010).
 */
function ledgerAssetClasses(): Map<string, LedgerAssetClass> {
  const classes = new Map<string, LedgerAssetClass>();
  try {
    for (const lot of listUniversalLots()) {
      if (!classes.has(lot.symbol) && lot.asset_class) classes.set(lot.symbol, lot.asset_class);
    }
  } catch {
    // Best-effort: an unreadable ledger degrades to Yahoo-only resolution.
  }
  return classes;
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
  const isPortfolio = edgeType === "OWNS";
  const ledger = isPortfolio ? ledgerAssetClasses() : new Map<string, LedgerAssetClass>();

  const resolvedAll = await Promise.all(
    capped.map(async (h) => {
      const ledgerClass = ledger.get(h.symbol) ?? null;
      if (ledgerClass === "cash") return resolveInstrument(h.symbol, null, "cash");
      const fundamentals = await getFundamentals(h.symbol).catch(() => null);
      return resolveInstrument(h.symbol, fundamentals?.snapshot.sector ?? null, ledgerClass);
    }),
  );

  // The linkage gate needs company names, so it runs after resolution;
  // events are gated BEFORE the per-holding cap (KG-011).
  const linkable = new Map(capped.map((h, i) => [h.symbol, resolvedAll[i].name]));
  const timelineBySymbol = listTimelineEventsForSymbols(capped.map((h) => h.symbol))
    .filter((e) => timelineEventLinks(e, linkable.get(e.symbol) ?? null))
    .sort((a, b) => b.importanceScore - a.importanceScore)
    .reduce((acc, e) => {
      const list = acc.get(e.symbol) ?? [];
      if (list.length < MAX_TIMELINE_EVENTS_PER_HOLDING) list.push(e);
      acc.set(e.symbol, list);
      return acc;
    }, new Map<string, TimelineEvent[]>());

  // Position value per holding: cash at face value (its shares ARE dollars —
  // pricing the synthetic CASH-USD lot off a quote is the KG-008 defect),
  // live market value when the quote resolved, cost basis otherwise. The
  // evidence string says which one it is.
  const values = capped.map((h, i) => {
    if (!isPortfolio) return null;
    const pos = h as PortfolioPosition;
    if (resolvedAll[i].instrument === "cash") {
      return pos.shares > 0 ? { value: pos.shares, basis: "face" as const } : null;
    }
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
      node.metrics.positionValue = Math.round(value.value * 100) / 100;
      node.metrics.valuationBasis = value.basis;
      if (value.basis !== "face") {
        node.metrics.shares = pos.shares;
        node.metrics.avgCost = pos.avgCost;
        if (resolved.quote?.price != null && pos.avgCost > 0) {
          node.metrics.unrealizedPnlPct = Math.round(((resolved.quote.price - pos.avgCost) / pos.avgCost) * 10000) / 100;
        }
      }
    }

    const basisLabel = { market: "market value", cost: "cost basis", face: "cash at face value" } as const;
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
          ? `${(weight * 100).toFixed(1)}% of portfolio (${basisLabel[value!.basis]})`
          : `${resolved.symbol} is on your ${isPortfolio ? "portfolio" : "watchlist"}`,
      provenance: PROV.db(),
      timestamp: null,
    });

    // Cash is book weight, not a market entity: no sector, no events.
    if (resolved.instrument === "cash") continue;
    await addClassificationEdges(builder, resolved, entries, asOf);
    addTimelineEvents(builder, holding.symbol, timelineBySymbol.get(holding.symbol) ?? [], resolved.name);
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
      // are resolved like any other asset (they are liquid disclosed holdings;
      // AVGO must never render "Unclassified Instrument" — KG-009).
      const topExposures = result.exposures.slice(0, 10);
      const missing = topExposures.filter((e) => !builder.hasNode(companyId(e.symbol)));
      const resolvedMissing = await Promise.all(
        missing.map(async (e) => {
          const fundamentals = await getFundamentals(e.symbol).catch(() => null);
          return resolveInstrument(e.symbol, fundamentals?.snapshot.sector ?? null);
        }),
      );
      missing.forEach((exposure, i) => {
        const node = assetNode(resolvedMissing[i], Math.round(30 + exposure.effectiveWeight * 400));
        if (node.summary === node.id.slice("company:".length)) node.summary = exposure.name;
        builder.upsertNode(node);
      });
      for (const exposure of topExposures) {
        const underlyingId = companyId(exposure.symbol);
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

  // Representative members (KG-006): the sector's SPDR ETF discloses its top
  // holdings — real, sourced members with measured weights, so a sector graph
  // is about the sector rather than only the user's coincidental overlap.
  const sectorEtf = SECTOR_ETF_MAP[canonical] ?? null;
  if (sectorEtf) {
    const constituents = (await fetchFundHoldings(sectorEtf)).filter((c) => c.symbol).slice(0, MAX_SECTOR_CONSTITUENTS);
    // Membership in the sector SPDR is itself the sector classification.
    const resolvedConstituents = await Promise.all(constituents.map((c) => resolveInstrument(c.symbol!, canonical)));
    constituents.forEach((holding, i) => {
      const resolved = resolvedConstituents[i];
      builder.upsertNode(assetNode(resolved, Math.round(35 + holding.weight * 250)));
      builder.addEdge({
        source: companyId(holding.symbol!),
        target: sectorId(canonical),
        type: "CONSTITUENT",
        label: `${(holding.weight * 100).toFixed(1)}% of ${sectorEtf}`,
        confidence: null,
        strength: Math.max(20, Math.min(100, Math.round(holding.weight * 300))),
        directed: true,
        evidence: `${holding.name} is ${(holding.weight * 100).toFixed(1)}% of ${sectorEtf}, the ${canonical} sector SPDR ETF (Yahoo disclosed holdings)`,
        provenance: PROV.yahoo(),
        timestamp: null,
      });
    });
  }

  const portfolio = listPortfolio();
  const watchlist = listWatchlist();
  const seen = new Set<string>();
  const members = [...portfolio, ...watchlist].filter((h) => {
    if (seen.has(h.symbol)) return false;
    seen.add(h.symbol);
    return true;
  });

  const memberLedger = ledgerAssetClasses();
  const resolvedAll = await Promise.all(
    members.map(async (h) => {
      const ledgerClass = memberLedger.get(h.symbol) ?? null;
      if (ledgerClass === "cash") return resolveInstrument(h.symbol, null, "cash");
      const fundamentals = await getFundamentals(h.symbol).catch(() => null);
      return resolveInstrument(h.symbol, fundamentals?.snapshot.sector ?? null, ledgerClass);
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
      // Region gate (KG-012): an NSE corporate announcement tagged
      // "Industrials" must not leak into a US sector graph.
      .filter((e) => eventQualifiesForUsScope(e.affectedTickers))
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
