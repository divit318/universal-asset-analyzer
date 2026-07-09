/**
 * Opportunity Map — orchestration and visualization layer, not a scoring
 * engine. Every field on OpportunityMapNode is read directly from the
 * Scanner pipeline's already-computed ScannerOpportunity.profile
 * (lib/opportunity-engine.ts's buildOpportunityProfile) — this module never
 * re-scores, re-classifies, or re-generates a thesis. It only reshapes
 * cached Scanner output into map nodes + theme clusters for the UI.
 */

import { listPortfolio, listWatchlist } from "./db";
import { getLatestScannerSnapshot } from "./scanner/cache";
import type { OpportunityCategory, Conviction, VolatilityTier } from "./opportunity-engine";
import type { ScannerOpportunity, SignalDirection } from "./types";

export interface OpportunityMapNode {
  id: string;
  symbol: string;
  name: string;
  theme: string;
  category: OpportunityCategory;
  categoryLabel: string;
  opportunityScore: number;
  conviction: Conviction;
  confidence: number;
  expectedVolatility: VolatilityTier;
  direction: SignalDirection;
  timeHorizon: string;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  dividendYieldPct: number | null;
  bullCase: string[];
  bearCase: string[];
  keyCatalyst: string | null;
  primaryRisk: string | null;
  tier: "high_conviction" | "developing";
  inPortfolio: boolean;
  inWatchlist: boolean;
}

export interface OpportunityCluster {
  theme: string;
  nodeIds: string[];
  avgScore: number;
  count: number;
}

export interface OpportunityMapData {
  nodes: OpportunityMapNode[];
  clusters: OpportunityCluster[];
  portfolioSymbols: string[];
  watchlistSymbols: string[];
  scannedAt: string | null;
  generatedAt: string;
}

function toNode(
  opp: ScannerOpportunity,
  tier: "high_conviction" | "developing",
  portfolioSymbols: Set<string>,
  watchlistSymbols: Set<string>,
): OpportunityMapNode | null {
  const profile = opp.profile;
  if (!profile) return null;
  return {
    id: opp.id,
    symbol: opp.ticker,
    name: opp.name,
    theme: opp.theme,
    category: profile.primaryCategory,
    categoryLabel: profile.categoryLabel,
    opportunityScore: profile.opportunityScore,
    conviction: profile.conviction,
    confidence: profile.confidence,
    expectedVolatility: profile.expectedVolatility,
    direction: opp.direction,
    timeHorizon: profile.suggestedHoldingPeriod,
    price: opp.quote?.price ?? null,
    changePercent: opp.quote?.changePercent ?? null,
    marketCap: opp.quote?.marketCap ?? null,
    dividendYieldPct: opp.dividendYieldPct,
    bullCase: profile.bullCase,
    bearCase: profile.bearCase,
    keyCatalyst: profile.keyCatalysts[0] ?? null,
    primaryRisk: profile.keyRisks[0] ?? null,
    tier,
    inPortfolio: portfolioSymbols.has(opp.ticker),
    inWatchlist: watchlistSymbols.has(opp.ticker),
  };
}

/** Pure: group nodes into theme clusters, ranked by average opportunity score. */
export function buildClusters(nodes: OpportunityMapNode[]): OpportunityCluster[] {
  const byTheme = new Map<string, OpportunityMapNode[]>();
  for (const node of nodes) {
    if (!byTheme.has(node.theme)) byTheme.set(node.theme, []);
    byTheme.get(node.theme)!.push(node);
  }
  return [...byTheme.entries()]
    .map(([theme, members]) => ({
      theme,
      nodeIds: members.map((m) => m.id),
      avgScore: Math.round(members.reduce((sum, m) => sum + m.opportunityScore, 0) / members.length),
      count: members.length,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);
}

/** Reads the last cached Scanner auto-scan and reshapes it for the map. Returns an empty map if no scan has run yet. */
export function getOpportunityMapData(): OpportunityMapData {
  const result = getLatestScannerSnapshot()?.result ?? null;
  const portfolioSymbols = new Set(listPortfolio().map((p) => p.symbol));
  const watchlistSymbols = new Set(listWatchlist().map((w) => w.symbol));

  if (!result) {
    return {
      nodes: [],
      clusters: [],
      portfolioSymbols: [...portfolioSymbols],
      watchlistSymbols: [...watchlistSymbols],
      scannedAt: null,
      generatedAt: new Date().toISOString(),
    };
  }

  const highConvictionIds = new Set(result.highConviction.map((o) => o.id));
  const nodes = result.opportunities
    .map((opp) => toNode(opp, highConvictionIds.has(opp.id) ? "high_conviction" : "developing", portfolioSymbols, watchlistSymbols))
    .filter((n): n is OpportunityMapNode => n != null);

  return {
    nodes,
    clusters: buildClusters(nodes),
    portfolioSymbols: [...portfolioSymbols],
    watchlistSymbols: [...watchlistSymbols],
    scannedAt: result.scannedAt,
    generatedAt: new Date().toISOString(),
  };
}
