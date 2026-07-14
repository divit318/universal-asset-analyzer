/**
 * Mission Control — the /intelligence redesign's single composition point,
 * also reused by /api/dashboard's home-page teaser (see gatherContext()).
 *
 * Every field here is read from an existing engine's already-computed
 * output (computePortfolioReport, getLatestSectorRotation, rankByFit,
 * getLatestScannerSnapshot, computeTrackRecord, gatherWatchlistAlerts,
 * getCalendarEvents) — this module performs zero new scoring/ranking math,
 * only assembly, severity-sorting, and the Daily Briefing's narration layer,
 * matching the "engines decide, AI narrates, never fails" split used
 * throughout lib/market-summary.ts / lib/movement-explainer.ts.
 *
 * Every source degrades independently: a missing portfolio, a down Ollama,
 * or a stale/absent Scanner snapshot yields a null/empty card, never a
 * failed digest.
 */

import { getPortfolioForIOS } from "./ios/server";
import { buildInvestmentProfile, fromLegacyReport } from "./ios/profile";
import { rankByFit } from "./ios/fit-scorer";
import type { FitAssetData } from "./ios/types";
import { getLatestSectorRotation } from "./sector-rotation";
import { getLatestScannerSnapshot } from "./scanner/cache";
import { fetchMacroSignals, fetchSectorPerformance } from "./scanner/signals";
import { assessMarketRegime } from "./scanner/index";
import { listDecisions, listWatchlist, listNotifications, unreadNotificationCount, getScannerCache, putScannerCache } from "./db";
import { getQuotes } from "./yahoo";
import { computeTrackRecord, type TrackRecord } from "./decision-journal";
import { gatherWatchlistAlerts } from "./ai-watchlist";
import { getCalendarEvents } from "./calendar";
import { runPrompt } from "./ai";
import { verifyGrounding } from "./ai/grounding";
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

export interface MissionControlDigest {
  generatedAt: string;
  briefing: { status: CardStatus; text: string; aiGenerated: boolean };
  actionQueue: { status: CardStatus; items: ActionQueueItem[] };
  opportunitySnapshot: {
    status: CardStatus;
    healthIssues: PortfolioAlert[];
    opportunities: OpportunitySnapshotItem[];
    scannerFreshness: Freshness | null;
  };
  sectorAttention: { status: CardStatus; changes: SectorAttentionChange[] };
  upcomingEvents: { status: CardStatus; events: UpcomingEventLite[] };
  recentActivityScope: { scope: "portfolio" | "watchlist" | "none"; id: string };
  calibration: { status: CardStatus; trackRecord: TrackRecord | null; eligible: boolean };
}

/** Shared deterministic context — also consumed by /api/dashboard to avoid recomputing the same data. */
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
): MissionControlDigest["actionQueue"] {
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
): MissionControlDigest["opportunitySnapshot"] {
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
): MissionControlDigest["sectorAttention"] {
  if (!rotation || rotation.leadershipChanges.length === 0) {
    return { status: "empty", changes: [] };
  }
  const weightBySector = new Map((report?.sectorAllocation ?? []).map((s) => [s.sector, s.weight]));
  const changes: SectorAttentionChange[] = rotation.leadershipChanges
    .filter((c) => weightBySector.has(c.sector))
    .map((c) => ({ ...c, portfolioWeightPct: weightBySector.get(c.sector) ?? null }));

  return { status: changes.length > 0 ? "ok" : "empty", changes };
}

async function buildUpcomingEvents(): Promise<MissionControlDigest["upcomingEvents"]> {
  try {
    const { events } = await getCalendarEvents();
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const upcoming = events
      .filter((e) => e.date >= today && e.date <= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8)
      .map((e) => ({ id: e.id, symbol: e.symbol, name: e.name, type: e.type, date: e.date }));

    return { status: upcoming.length > 0 ? "ok" : "empty", events: upcoming };
  } catch {
    return { status: "empty", events: [] };
  }
}

/** Exported for unit testing. */
export async function buildCalibration(report: PortfolioReport | null): Promise<MissionControlDigest["calibration"]> {
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

function buildBriefingPrompt(ctx: MissionControlContext, unreadCount: number): string {
  const regimeDesc = ctx.regime
    ? `${ctx.regime.trend} (${ctx.regime.breadthPct != null ? `${ctx.regime.breadthPct}% of sectors advancing` : "breadth unavailable"}). Dominant sectors: ${ctx.regime.dominantSectors.join(", ") || "none"}.`
    : "Market regime unavailable.";
  const rotationDesc = ctx.rotation
    ? `Sector leaders: ${ctx.rotation.leaders.join(", ") || "none"}. Laggards: ${ctx.rotation.laggards.join(", ") || "none"}.`
    : "No sector rotation snapshot available.";
  const portfolioDesc = ctx.report
    ? `Portfolio health grade ${ctx.report.health.grade} (${ctx.report.health.total}/100), ${ctx.report.alerts.length} active alert(s), today's change ${ctx.report.todayChangePct >= 0 ? "+" : ""}${ctx.report.todayChangePct.toFixed(2)}%.`
    : "No portfolio tracked.";

  return `You are writing a 2-4 sentence "good morning" investor briefing. Use ONLY the facts below — do not invent data.

MARKET: ${regimeDesc}
SECTOR ROTATION: ${rotationDesc}
PORTFOLIO: ${portfolioDesc}
UNREAD ALERTS: ${unreadCount}

Write a short, direct briefing that: states what's happening in the market, connects it to the portfolio if one is tracked, and names the single most important thing to pay attention to today. Return ONLY the briefing text — no headings, no bullet points, no preamble.`;
}

function deterministicBriefing(ctx: MissionControlContext, unreadCount: number): string {
  const parts: string[] = [];
  if (ctx.regime) parts.push(ctx.regime.summary);
  if (ctx.rotation && ctx.rotation.leaders.length > 0) parts.push(`Leading sectors: ${ctx.rotation.leaders.join(", ")}.`);
  if (ctx.report) parts.push(`Portfolio health grade ${ctx.report.health.grade}, ${ctx.report.alerts.length} active alert(s).`);
  if (unreadCount > 0) parts.push(`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`);
  return parts.join(" ") || "No market or portfolio data available yet.";
}

async function buildBriefing(ctx: MissionControlContext, unreadCount: number): Promise<MissionControlDigest["briefing"]> {
  const fallback = deterministicBriefing(ctx, unreadCount);
  if (!ctx.regime && !ctx.report) return { status: "empty", text: fallback, aiGenerated: false };

  const cacheKey = `daily-briefing:${new Date().toISOString().slice(0, 13)}:${ctx.report?.health.grade ?? "none"}:${ctx.rotation?.asOf ?? "none"}`;
  const cached = getScannerCache(cacheKey);
  if (cached) return { status: "ok", text: cached, aiGenerated: true };

  try {
    const prompt = buildBriefingPrompt(ctx, unreadCount);
    const raw = await runPrompt("daily-briefing", prompt, { maxTokens: 800 });
    const text = raw.trim();
    if (!text) return { status: "ok", text: fallback, aiGenerated: false };

    const grounding = verifyGrounding(text, prompt);
    if (grounding.level === "low") {
      return { status: "ok", text: fallback, aiGenerated: false };
    }

    putScannerCache(cacheKey, text);
    return { status: "ok", text, aiGenerated: true };
  } catch {
    return { status: "ok", text: fallback, aiGenerated: false };
  }
}

export async function buildMissionControlDigest(): Promise<MissionControlDigest> {
  const ctx = await gatherContext();
  const notifications = listNotifications(20);
  const unreadCount = unreadNotificationCount();

  const [briefing, upcomingEvents, calibration] = await Promise.all([
    buildBriefing(ctx, unreadCount),
    buildUpcomingEvents(),
    buildCalibration(ctx.report),
  ]);

  const actionQueue = buildActionQueue(ctx.report, ctx.watchlistAlerts, notifications);
  const opportunitySnapshot = buildOpportunitySnapshot(ctx);
  const sectorAttention = buildSectorAttention(ctx.report, ctx.rotation);

  const recentActivityScope: MissionControlDigest["recentActivityScope"] = ctx.report
    ? { scope: "portfolio", id: "portfolio" }
    : listWatchlist().length > 0
      ? { scope: "watchlist", id: "watchlist" }
      : { scope: "none", id: "" };

  return {
    generatedAt: new Date().toISOString(),
    briefing,
    actionQueue,
    opportunitySnapshot,
    sectorAttention,
    upcomingEvents,
    recentActivityScope,
    calibration,
  };
}
