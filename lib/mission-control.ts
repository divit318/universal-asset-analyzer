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
import { buildInvestmentProfile, fromUniversalReport } from "./ios/profile";
import { DEFAULT_FIT_WEIGHT, rankByFit } from "./ios/fit-scorer";
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
import { DEFAULT_CONSTRAINTS } from "./ios/types";
import { buildThreats } from "./home/threats";
import type { ThreatItem } from "./home/contracts";
import type { UniversalPortfolioReport } from "./portfolio/report";
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
  /** ISO time of the observation behind the item (notifications); ranking decays with it. */
  observedAt?: string;
}

export interface OpportunitySnapshotItem {
  symbol: string;
  /** 0.6 × scanner quality + 0.4 × portfolio fit — see rankByFit. */
  combinedScore: number;
  fitTier: string;
  fitSummary: string;
  /** The scanner's standalone quality composite (0-100). Optional: absent on
   *  digests cached before 2026-08-07; render without the decomposition then. */
  absoluteScore?: number;
  /** The IOS portfolio-fit score (0-100) blended into `combinedScore`. */
  fitScore?: number;
  /** A second distinct fit driver, so two panels showing the same symbol never
   *  repeat the same sentence. Null when only one evidenced reason exists. */
  fitDetail?: string | null;
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
  /**
   * What is wrong with the portfolio right now, from the universal report's own
   * threat model (lib/home/threats.ts) rather than a second alert generator. The
   * legacy engine produced its own `PortfolioAlert[]` from its own concentration
   * and risk math, which is how the Home digest could disagree with the Risk Lab
   * about the same portfolio.
   */
  healthIssues: ThreatItem[];
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
  report: UniversalPortfolioReport | null;
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

/** Alert kinds that describe a single session's price action. */
const SESSION_BOUND_KINDS = new Set(["big_move", "drop_alert"]);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * True when a session-bound alert's observation is older than the immediately
 * previous session (>3 calendar days, weekend-tolerant — same policy as
 * lib/metric.ts metricSessionState). Legacy rows without a session date fall
 * back to their created date rather than living forever.
 */
export function isStaleSessionAlert(
  n: Pick<Notification, "kind" | "sessionDate" | "createdAt">,
  now: number = Date.now(),
): boolean {
  if (!SESSION_BOUND_KINDS.has(n.kind)) return false;
  const day = n.sessionDate ?? n.createdAt.slice(0, 10);
  const t = Date.parse(`${day}T00:00:00`);
  if (Number.isNaN(t)) return true; // undated session data is untrusted by policy
  return now - t > 3 * DAY_MS;
}

/** Exported for unit testing — pure, no I/O. */
export function buildActionQueue(
  report: UniversalPortfolioReport | null,
  watchlistAlerts: WatchlistAlert[],
  notifications: Notification[],
): ActionQueueCard {
  const items: ActionQueueItem[] = [];

  // Portfolio problems come from the universal report's threat model, and the
  // proposed actions from its recommendation engine — the same two lists the
  // Portfolio page shows. Nothing is re-derived here.
  for (const threat of buildThreats(report).threats) {
    items.push({
      id: threat.id,
      severity: threat.severity,
      source: "alert",
      title: threat.title,
      description: threat.detail,
      href: threat.href,
      symbol: undefined,
    });
  }

  for (const rec of report?.recommendations ?? []) {
    items.push({
      id: `rec-${rec.id}`,
      // The recommendation engine ranks by priority; 1 is the one to do first.
      severity: rec.priority <= 1 ? "high" : rec.priority <= 3 ? "medium" : "low",
      source: "recommendation",
      title: rec.title,
      description: rec.rationale,
      href: rec.symbol ? `/research?symbol=${rec.symbol}` : "/portfolio?tab=decisions",
      symbol: rec.symbol ?? undefined,
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
    // A price-move alert describes one session. Once that session is older
    // than the immediately previous one (weekend-tolerant), it is history,
    // not an action — it stays in the bell (retention) but leaves the queue
    // (audit F-22d: the pre-purge queue led with a five-day-old -8.7%).
    if (isStaleSessionAlert(n)) continue;
    items.push({
      id: `notification-${n.id}`,
      severity: n.severity === "warning" ? "high" : "low",
      source: "notification",
      title: n.title,
      description: n.body,
      href: n.symbol ? `/research?symbol=${n.symbol}` : "/watchlist",
      symbol: n.symbol ?? undefined,
      observedAt: n.observedAt ?? n.createdAt,
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
  const healthIssues = buildThreats(ctx.report).threats
    .filter((t) => t.category === "concentration" || t.category === "correlation" || t.category === "liquidity" || t.category === "drawdown")
    .slice(0, 3);

  const snapshot = getLatestScannerSnapshot();
  if (!snapshot) {
    return { status: "empty", healthIssues, opportunities: [], scannerFreshness: null };
  }

  const portfolioSymbols = new Set(
    (ctx.report?.holdings ?? []).map((h) => h.symbol).filter((s): s is string => s != null),
  );
  const profile = buildInvestmentProfile(ctx.report ? fromUniversalReport(ctx.report) : null, "ai_optimized", DEFAULT_CONSTRAINTS);

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

  const ranked = rankByFit(candidates, profile, DEFAULT_FIT_WEIGHT).slice(0, 5);
  const opportunities: OpportunitySnapshotItem[] = ranked.map((r) => ({
    symbol: r.symbol,
    combinedScore: r.combinedScore,
    fitTier: r.fitTier,
    fitSummary: r.fitSummary,
    absoluteScore: r.absoluteScore,
    fitScore: r.fitScore,
    fitDetail: r.fitDetail ?? null,
  }));

  const status: CardStatus = snapshot.freshness.level === "stale" ? "degraded" : "ok";
  return { status, healthIssues, opportunities, scannerFreshness: snapshot.freshness };
}

/** Exported for unit testing — pure, no I/O. */
export function buildSectorAttention(
  report: UniversalPortfolioReport | null,
  rotation: SectorRotationSnapshot | null,
): SectorAttentionCard {
  if (!rotation || rotation.leadershipChanges.length === 0) {
    return { status: "empty", changes: [] };
  }
  // The report's own sector allocation — one weighting, shared with every panel.
  const weightBySector = new Map((report?.allocation.bySector.slices ?? []).map((s) => [s.label, s.weight]));
  const changes: SectorAttentionChange[] = rotation.leadershipChanges
    .filter((c) => weightBySector.has(c.sector))
    .map((c) => ({ ...c, portfolioWeightPct: weightBySector.get(c.sector) ?? null }));

  return { status: changes.length > 0 ? "ok" : "empty", changes };
}

/** Exported for unit testing. */
export async function buildCalibration(report: UniversalPortfolioReport | null): Promise<CalibrationCard> {
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
