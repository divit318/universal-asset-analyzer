/**
 * Mission Control — the shared composition layer behind the homepage digest.
 *
 * This used to own a page (/intelligence) and assemble its own `MissionControlDigest`,
 * including the AI briefing. The digest now lives in lib/home/digest.ts, because
 * the homepage is where "what should I know and do today" belongs. What remains
 * here is what was always the valuable part: a set of pure builders that turn
 * already-computed engine output into cards, plus the shared context they read.
 *
 * Every value is read from an engine that already computed it (getPortfolioForIOS,
 * getLatestSectorRotation, rankByFit, getLatestScannerSnapshot, computeTrackRecord,
 * gatherWatchlistAlerts) — this module performs zero new scoring or ranking math,
 * only assembly and severity-sorting.
 *
 * Every source degrades independently: a missing portfolio, a stale/absent Scanner
 * snapshot, or a dead provider yields an empty card, never a failed digest.
 */

import { getPortfolioForIOS } from "./ios/server";
import { buildInvestmentProfile, fromLegacyReport } from "./ios/profile";
import { rankByFit } from "./ios/fit-scorer";
import type { FitAssetData } from "./ios/types";
import { getLatestSectorRotation } from "./sector-rotation";
import { getLatestScannerSnapshot } from "./scanner/cache";
import { fetchMacroSignals, fetchSectorPerformance } from "./scanner/signals";
import { assessMarketRegime } from "./scanner/index";
import { listDecisions } from "./db";
import { getQuotes } from "./yahoo";
import { computeTrackRecord, type TrackRecord } from "./decision-journal";
import { gatherWatchlistAlerts } from "./ai-watchlist";
import type { Freshness } from "./provenance";
import { DEFAULT_CONSTRAINTS } from "./portfolio-analytics";
import type { PortfolioReport, PortfolioAlert } from "./portfolio-analytics";
import type { MarketRegime, SectorRotationSnapshot, WatchlistAlert, Notification } from "./types";

export type CardStatus = "ok" | "empty" | "degraded";

export interface ActionQueueItem {
  id: string;
  severity: "high" | "medium" | "low";
  source: "alert" | "recommendation" | "notification" | "watchlist";
  title: string;
  description: string;
  href: string;
  symbol?: string;
}

export interface OpportunitySnapshotItem {
  symbol: string;
  combinedScore: number;
  fitTier: string;
  fitSummary: string;
}

export interface SectorAttentionChange {
  sector: string;
  fromRank: number;
  toRank: number;
  portfolioWeightPct: number | null;
}

export interface UpcomingEventLite {
  id: string;
  symbol?: string;
  name: string;
  type: string;
  date: string;
}

/* -------------------------------------------------------------------------- */
/* Card shapes — each builder's output. Composed by lib/home/digest.ts.        */
/* -------------------------------------------------------------------------- */

export interface ActionQueueCard {
  status: CardStatus;
  items: ActionQueueItem[];
}

export interface OpportunitySnapshotCard {
  status: CardStatus;
  healthIssues: PortfolioAlert[];
  opportunities: OpportunitySnapshotItem[];
  scannerFreshness: Freshness | null;
}

export interface SectorAttentionCard {
  status: CardStatus;
  changes: SectorAttentionChange[];
}

export interface CalibrationCard {
  status: CardStatus;
  trackRecord: TrackRecord | null;
  eligible: boolean;
}

/** Shared deterministic context — gathered once per digest, read by four builders. */
export interface MissionControlContext {
  report: PortfolioReport | null;
  rotation: SectorRotationSnapshot | null;
  regime: MarketRegime | null;
  watchlistAlerts: WatchlistAlert[];
  scannerFreshness: Freshness | null;
}

/**
 * Live regime fallback for when the Scanner hasn't run recently — same
 * approach /api/dashboard already used (macro/sector price action only, no
 * AI-detected themes). Preferring the Scanner snapshot's regime when fresh
 * gives richer `dominantThemes`; this is the no-Scanner-yet safety net.
 */
async function computeLiveRegime(): Promise<MarketRegime | null> {
  try {
    const [macroSignals, sectorPerf] = await Promise.all([
      fetchMacroSignals(),
      fetchSectorPerformance(),
    ]);
    return assessMarketRegime(macroSignals, sectorPerf, []);
  } catch {
    return null;
  }
}

/**
 * The market regime on its own — the Scanner's snapshot when it's fresh, a live
 * computation when it isn't.
 *
 * Exported because the research page's macro ladder needs exactly this one enum
 * and nothing else. It used to get it by fetching /api/dashboard, which built an
 * entire portfolio report, a calendar, and the watchlist alert set to hand back
 * a single field.
 */
export async function getMarketRegime(): Promise<MarketRegime | null> {
  const snapshot = getLatestScannerSnapshot();
  return snapshot?.result.marketRegime ?? (await computeLiveRegime());
}

/** Gathers the deterministic, fast-to-compute shared context. No AI calls. */
export async function gatherContext(): Promise<MissionControlContext> {
  const [iosCtx, rotation, scannerSnapshot, watchlistAlerts] = await Promise.all([
    getPortfolioForIOS(),
    Promise.resolve(getLatestSectorRotation()),
    Promise.resolve(getLatestScannerSnapshot()),
    gatherWatchlistAlerts(),
  ]);

  const regime = scannerSnapshot?.result.marketRegime ?? (await computeLiveRegime());

  return {
    report: iosCtx.report,
    rotation,
    regime,
    watchlistAlerts,
    scannerFreshness: scannerSnapshot?.freshness ?? null,
  };
}

const SEVERITY_RANK: Record<"high" | "medium" | "low", number> = { high: 0, medium: 1, low: 2 };

/** Exported for unit testing — pure, no I/O. */
export function buildActionQueue(
  report: PortfolioReport | null,
  watchlistAlerts: WatchlistAlert[],
  notifications: Notification[],
): ActionQueueCard {
  const items: ActionQueueItem[] = [];

  for (const alert of report?.alerts ?? []) {
    items.push({
      id: `alert-${alert.type}-${alert.symbol ?? "portfolio"}`,
      severity: alert.severity,
      source: "alert",
      title: alert.title,
      description: alert.description,
      href: alert.symbol ? `/research?symbol=${alert.symbol}` : "/portfolio",
      symbol: alert.symbol,
    });
  }

  for (const rec of report?.recommendations ?? []) {
    if (rec.action === "HOLD") continue; // not actionable
    const severity = rec.action === "STRONG_BUY" || rec.action === "SELL" ? "high" : "medium";
    items.push({
      id: `rec-${rec.symbol}`,
      severity,
      source: "recommendation",
      title: `${rec.action.replace("_", " ")}: ${rec.symbol}`,
      description: rec.reasoning,
      href: `/research?symbol=${rec.symbol}`,
      symbol: rec.symbol,
    });
  }

  for (const alert of watchlistAlerts) {
    items.push({
      id: `watchlist-${alert.type}-${alert.symbol}`,
      severity: alert.severity,
      source: "watchlist",
      title: alert.title,
      description: alert.description,
      href: `/research?symbol=${alert.symbol}`,
      symbol: alert.symbol,
    });
  }

  for (const n of notifications) {
    if (n.read) continue;
    items.push({
      id: `notification-${n.id}`,
      severity: n.severity === "warning" ? "high" : "low",
      source: "notification",
      title: n.title,
      description: n.body,
      href: n.symbol ? `/research?symbol=${n.symbol}` : "/watchlist",
      symbol: n.symbol ?? undefined,
    });
  }

  items.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const top = items.slice(0, 10);

  return { status: top.length > 0 ? "ok" : "empty", items: top };
}

/** Exported for unit testing — pure given ctx (no I/O beyond the already-fetched scanner snapshot). */
export function buildOpportunitySnapshot(
  ctx: MissionControlContext,
): OpportunitySnapshotCard {
  const healthIssues = (ctx.report?.alerts ?? []).filter(
    (a) => a.type === "concentration" || a.type === "diversification" || a.type === "risk",
  ).slice(0, 3);

  const snapshot = getLatestScannerSnapshot();
  if (!snapshot) {
    return { status: "empty", healthIssues, opportunities: [], scannerFreshness: null };
  }

  const portfolioSymbols = new Set(ctx.report?.positions.map((p) => p.symbol) ?? []);
  const profile = buildInvestmentProfile(ctx.report ? fromLegacyReport(ctx.report) : null, "ai_optimized", DEFAULT_CONSTRAINTS);

  const candidates: Array<FitAssetData & { absoluteScore: number }> = [
    ...snapshot.result.highConviction,
    ...snapshot.result.developing,
  ]
    .filter((opp) => !portfolioSymbols.has(opp.ticker))
    .map((opp) => ({
      symbol: opp.ticker,
      sector: null,
      marketCap: opp.quote?.marketCap ?? null,
      compositeScores: opp.compositeScores,
      dividendYield: opp.dividendYieldPct,
      absoluteScore: opp.opportunityScore.composite,
    }));

  const ranked = rankByFit(candidates, profile, 0.4).slice(0, 5);
  const opportunities: OpportunitySnapshotItem[] = ranked.map((r) => ({
    symbol: r.symbol,
    combinedScore: r.combinedScore,
    fitTier: r.fitTier,
    fitSummary: r.fitSummary,
  }));

  const status: CardStatus = snapshot.freshness.level === "stale" ? "degraded" : "ok";
  return { status, healthIssues, opportunities, scannerFreshness: snapshot.freshness };
}

/** Exported for unit testing — pure, no I/O. */
export function buildSectorAttention(
  report: PortfolioReport | null,
  rotation: SectorRotationSnapshot | null,
): SectorAttentionCard {
  if (!rotation || rotation.leadershipChanges.length === 0) {
    return { status: "empty", changes: [] };
  }
  const weightBySector = new Map((report?.sectorAllocation ?? []).map((s) => [s.sector, s.weight]));
  const changes: SectorAttentionChange[] = rotation.leadershipChanges
    .filter((c) => weightBySector.has(c.sector))
    .map((c) => ({ ...c, portfolioWeightPct: weightBySector.get(c.sector) ?? null }));

  return { status: changes.length > 0 ? "ok" : "empty", changes };
}

/** Exported for unit testing. */
export async function buildCalibration(report: PortfolioReport | null): Promise<CalibrationCard> {
  const decisions = listDecisions();
  const eligible = decisions.length >= 5;
  if (!eligible) return { status: "empty", trackRecord: null, eligible: false };

  const openSymbols = [...new Set(decisions.filter((d) => d.status === "open").map((d) => d.symbol))];
  const priceBySymbol = new Map<string, number>();
  try {
    const quotes = openSymbols.length > 0 ? await getQuotes(openSymbols) : [];
    for (const q of quotes) if (q.price != null) priceBySymbol.set(q.symbol.toUpperCase(), q.price);
  } catch {
    // Open decisions just won't have a live mark this load — closed ones still score.
  }

  const trackRecord = computeTrackRecord(decisions, priceBySymbol);
  void report; // reserved: could cross-reference current fit tier vs. decision-time fit tier in a future pass
  return { status: "ok", trackRecord, eligible: true };
}
