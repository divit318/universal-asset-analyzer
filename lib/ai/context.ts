/**
 * Context Layer — assembles the single CompanyContext bundle the copilot
 * reasons over. It fans out across every existing data source (Yahoo quote +
 * fundamentals, EDGAR statements + filings, profile, news, peers, the
 * platform's own score/risk/momentum engines, and the watchlist), running them
 * in parallel and degrading gracefully: any source that fails contributes a
 * `warning` instead of sinking the whole bundle.
 *
 * Bundles are cached per symbol with a short TTL so multi-turn conversations
 * and the predefined actions don't re-fetch the world on every message.
 */

import { getHistory, getQuote } from "../yahoo";
import { getFundamentals } from "../fundamentals";
import { getFinancialStatements } from "../statements";
import { getRecentFilings } from "../edgar";
import { getCompanyProfile } from "../profile";
import { getCompanyNews } from "../news";
import { getPeerComparison } from "../peers";
import { assessRisks, classifyInvestmentPersonality, computeMomentum, computeScore } from "../scoring";
import { listAllNotes, listWatchlist } from "../db";
import { constituentsForSector } from "../sp500";
import { detectMarket } from "../market";
import { getLatestSectorRotation, findSectorRotationEntry } from "../sector-rotation";
import { getTimelineFeed } from "../timeline";
import { getOpportunityMapData } from "../opportunity-map";
import { getKnowledgeGraph } from "../knowledge-graph";
import type { CompanyContext } from "./types";
import type { SectorRotationEntry } from "../types";

/** Settle a best-effort source, recording a warning on failure. */
async function tryOr<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    warnings.push(`${label}: ${err instanceof Error ? err.message : "unavailable"}`);
    return fallback;
  }
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 50;
const cache = new Map<string, { at: number; ctx: CompanyContext }>();

function evictOldest(): void {
  let oldestKey = "";
  let oldestAt = Infinity;
  for (const [k, v] of cache) {
    if (v.at < oldestAt) { oldestKey = k; oldestAt = v.at; }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/**
 * Build (or return a cached) CompanyContext for a symbol. The live quote is the
 * one hard requirement — without it there's no company to analyze, so a quote
 * failure rejects. Everything else is best-effort.
 */
export async function buildCompanyContext(
  rawSymbol: string,
  opts: { fresh?: boolean } = {},
): Promise<CompanyContext> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) throw new Error("A symbol is required");

  const cached = cache.get(symbol);
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.ctx;
  }

  const warnings: string[] = [];

  // The quote is required; fetch it first so we can fail fast.
  const quote = await getQuote(symbol);

  const [profile, fundamentals, statements, filings, news, peers, history, graph] =
    await Promise.all([
      tryOr("profile", warnings, () => getCompanyProfile(symbol), null),
      tryOr("fundamentals", warnings, () => getFundamentals(symbol), null),
      tryOr("statements", warnings, () => getFinancialStatements(symbol), null),
      tryOr("filings", warnings, () => getRecentFilings(symbol, 10), []),
      tryOr("news", warnings, () => getCompanyNews(symbol, 8), []),
      tryOr("peers", warnings, () => getPeerComparison(symbol), null),
      tryOr("price history", warnings, () => getHistory(symbol, 420), []),
      tryOr("knowledge graph", warnings, () => getKnowledgeGraph("symbol", symbol), null),
    ]);

  const momentum = computeMomentum(history);

  // The platform's own scoring/risk engines, when we have the inputs.
  // Market-aware + sector-rotation-aware, matching /api/fundamentals so the
  // copilot's view of the score is consistent with what the page displays.
  let score: CompanyContext["score"] = null;
  let risks: CompanyContext["risks"] = [];
  let personality: CompanyContext["personality"] = null;
  let sectorRotationEntry: SectorRotationEntry | null = null;
  if (fundamentals) {
    const market = detectMarket(quote);
    const rotation = getLatestSectorRotation();
    sectorRotationEntry = findSectorRotationEntry(rotation, fundamentals.snapshot.sector);
    score = computeScore(fundamentals.snapshot, statements, fundamentals.analyst, momentum, sectorRotationEntry, market);
    risks = assessRisks(
      fundamentals.snapshot,
      statements,
      fundamentals.analyst,
      fundamentals.insider,
    );
    personality = classifyInvestmentPersonality(score, fundamentals.snapshot, momentum);
  }

  // Investment Timeline — reads the persisted feed only (no live sync, unlike
  // /api/timeline) so a copilot chat turn never blocks on a fresh crawl; the
  // Details tab's TimelinePreviewCard is what keeps the feed warm.
  let recentTimelineEvents: CompanyContext["recentTimelineEvents"] = [];
  try {
    recentTimelineEvents = getTimelineFeed("symbol", symbol).events
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
  } catch {
    /* timeline is non-critical context */
  }

  // Opportunity Map — cheap, cached-scanner-result read only, never a live scan.
  let relatedOpportunities: CompanyContext["relatedOpportunities"] = null;
  try {
    const map = getOpportunityMapData();
    const node = map.nodes.find((n) => n.symbol === symbol);
    const cluster = node ? map.clusters.find((c) => c.nodeIds.includes(node.id)) : undefined;
    if (node && cluster) {
      const siblings = cluster.nodeIds
        .filter((id) => id !== node.id)
        .map((id) => map.nodes.find((n) => n.id === id)?.symbol)
        .filter((s): s is string => s != null)
        .slice(0, 5);
      relatedOpportunities = { theme: node.theme, siblings };
    }
  } catch {
    /* opportunity map is non-critical context */
  }

  // Knowledge Graph — top neighbors by importance, already fetched above.
  const graphNeighbors: CompanyContext["graphNeighbors"] = [];
  if (graph) {
    const companyId = `company:${symbol}`;
    const byImportance = [...graph.nodes]
      .filter((n) => n.id !== companyId)
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 6);
    for (const n of byImportance) {
      const edge = graph.edges.find(
        (e) => (e.source === companyId && e.target === n.id) || (e.target === companyId && e.source === n.id),
      );
      graphNeighbors.push({ label: n.label, relationship: edge?.label ?? n.type, type: n.type });
    }
  }

  let onWatchlist = false;
  try {
    onWatchlist = listWatchlist().some((w) => w.symbol === symbol);
  } catch {
    /* watchlist is non-critical context */
  }

  // Cross-stock memory: include saved notes for this symbol AND any notes for
  // peer symbols so the copilot's analysis is informed by prior conclusions.
  let savedNotes: Array<{ symbol: string; content: string; createdAt: string }> = [];
  try {
    const allNotes = listAllNotes();
    const peerSymbols = new Set<string>(
      peers?.sector ? constituentsForSector(peers.sector).map((c) => c.symbol) : []
    );
    savedNotes = allNotes
      .filter((n) => n.symbol === symbol || peerSymbols.has(n.symbol))
      .slice(0, 10)
      .map((n) => ({ symbol: n.symbol, content: n.content, createdAt: n.createdAt }));
  } catch {
    /* notes are non-critical */
  }

  const ctx: CompanyContext = {
    symbol,
    name: quote.name || symbol,
    builtAt: new Date().toISOString(),
    quote,
    profile,
    snapshot: fundamentals?.snapshot ?? null,
    statements,
    analyst: fundamentals?.analyst ?? null,
    insider: fundamentals?.insider ?? null,
    score,
    risks,
    momentum,
    personality,
    peers,
    filings: filings.map((f) => ({
      form: f.form,
      filedAt: f.filedAt,
      description: f.description,
      documentUrl: f.documentUrl,
    })),
    news,
    onWatchlist,
    savedNotes,
    warnings,
    ownership: fundamentals?.ownership ?? null,
    sectorRotation: sectorRotationEntry,
    recentTimelineEvents,
    relatedOpportunities,
    graphNeighbors,
  };

  if (cache.size >= MAX_CACHE_SIZE) evictOldest();
  cache.set(symbol, { at: Date.now(), ctx });
  return ctx;
}

/** Drop a cached bundle (e.g. after a watchlist change). */
export function invalidateContext(symbol: string): void {
  cache.delete(symbol.trim().toUpperCase());
}
