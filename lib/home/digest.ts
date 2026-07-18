/**
 * The Home Digest — one deterministic payload for the whole homepage.
 *
 * Composition only. Every number in here is read from an engine that already
 * computed it: the portfolio report, the decision engine, the Scanner snapshot,
 * sector rotation, the watchlist alert engine, the calendar, the decision
 * journal. This module adds no scoring, no ranking, and no thresholds of its
 * own — the same contract lib/mission-control.ts holds, and for the same
 * reason: a homepage that computes its own version of "portfolio health" will
 * drift from /portfolio's version, and then neither is trustworthy.
 *
 * Two hard rules it enforces:
 *
 *   1. **No AI.** The digest must paint immediately. AI is slow, serialized on
 *      local Ollama, and optional. The narrative arrives separately over
 *      `/api/home/brief` (see brief.ts) and every module that uses it has a
 *      deterministic fallback that ships in *this* payload (`fallbackBriefing`).
 *
 *   2. **Every source degrades alone.** Steps run through `runPlan()`, which
 *      isolates failures: a dead Yahoo tape does not cost you your portfolio
 *      pulse, and an empty portfolio does not cost you the market intelligence.
 *      A module whose source failed renders `degraded`, never a broken page.
 */

import { runPlan, stepValue } from "../platform/orchestrator";
import { gatherContext, buildOpportunitySnapshot, buildCalibration, buildSectorAttention, type MissionControlContext, type UpcomingEventLite } from "../mission-control";
import { buildPortfolioReport, type UniversalPortfolioReport } from "../portfolio/report";
import { getCalendarEvents } from "../calendar";
import { listWatchlist, listLots, listNotifications } from "../db";
import { getHistory, getQuote, getQuotes } from "../yahoo";
import { portfolioPerformance } from "../portfolio-performance";
import { buildMarketIntelligence } from "./market-intel";
import { buildPortfolioPulse } from "./pulse";
import { buildThreats } from "./threats";
import { buildAttribution } from "./attribution";
import { buildTimelineFeeds } from "./timeline";
import { buildWatchlistIntelligence } from "./watchlist-intel";
import { buildRecentActivity } from "./activity";
import { buildRecommendedActions } from "./actions";
import { deterministicBriefing, toBriefPortfolio } from "./brief";
import {
  buildAttentionQueue,
  seedsFromActions,
  seedsFromThreats,
  seedsFromAlerts,
  seedsFromEvents,
  seedsFromSignals,
  type WeightBySymbol,
} from "./attention";
import { listActiveDismissals } from "../db";
import { estimateMarketStatus } from "../market-hours";
import { MIN_DAYS_TO_ANNUALIZE, type HomeDigest, type PortfolioPerformanceSummary } from "./contracts";
import type { PortfolioLot, WatchlistItem } from "../types";

const BENCHMARK = "SPY";

/* ------------------------------------------------------------------ */
/* Module 9 — performance                                              */
/* ------------------------------------------------------------------ */

/**
 * Reuses `portfolioPerformance()` — the same XIRR + benchmark engine
 * /api/portfolio/performance calls. The homepage shows the three headline
 * numbers; the full position-level breakdown stays on /portfolio.
 */
async function buildPerformance(): Promise<PortfolioPerformanceSummary> {
  const lots = listLots();
  if (lots.length === 0) {
    return { status: "empty", xirrPct: null, holdingDays: 0, totalReturnPct: 0, totalReturnDollar: 0, benchmark: null };
  }

  const bySymbol = new Map<string, PortfolioLot[]>();
  for (const l of lots) {
    const list = bySymbol.get(l.symbol);
    if (list) list.push(l);
    else bySymbol.set(l.symbol, [l]);
  }

  const earliest = lots.reduce((min, l) => (l.tradeDate < min ? l.tradeDate : min), lots[0].tradeDate);
  const daysSinceFirst = Math.ceil((Date.now() - Date.parse(earliest)) / 86_400_000) + 7;

  const [quotes, benchHistory, benchQuote] = await Promise.all([
    getQuotes([...bySymbol.keys()]),
    getHistory(BENCHMARK, Math.max(30, daysSinceFirst)).catch(() => []),
    getQuote(BENCHMARK).catch(() => null),
  ]);

  const priceBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.price]));
  const benchPriceNow = benchQuote?.price ?? benchHistory.at(-1)?.close ?? 0;

  const perf = portfolioPerformance(
    bySymbol,
    (s) => priceBySymbol.get(s.toUpperCase()) ?? null,
    new Date().toISOString(),
    benchHistory.length > 0 && benchPriceNow > 0
      ? {
          symbol: BENCHMARK,
          history: benchHistory.map((h) => ({ date: h.date.slice(0, 10), close: h.close })),
          priceNow: benchPriceNow,
        }
      : undefined,
  );

  // `portfolioPerformance()` returns every rate as a RATIO (-0.048 = -4.8%),
  // including totalReturnPct despite the name. Scale once, here, so no renderer
  // has to remember. Getting this wrong printed "-0.0%" next to "-$25,369".
  const asPct = (ratio: number) => ratio * 100;

  // Annualizing a portfolio younger than a quarter produces a number that is
  // arithmetically correct and practically meaningless — see MIN_DAYS_TO_ANNUALIZE.
  const canAnnualize = perf.holdingDays >= MIN_DAYS_TO_ANNUALIZE;
  const xirrPct = canAnnualize && perf.xirr != null ? asPct(perf.xirr) : null;

  return {
    status: "ok",
    xirrPct,
    holdingDays: perf.holdingDays,
    totalReturnPct: asPct(perf.totalReturnPct),
    totalReturnDollar: perf.totalPnl,
    // The benchmark comparison is XIRR-vs-XIRR, so it inherits the same gate:
    // if we won't annualize the portfolio, we can't honestly annualize the gap.
    benchmark:
      canAnnualize && perf.benchmark && perf.xirr != null && perf.benchmark.xirr != null
        ? {
            symbol: perf.benchmark.symbol,
            portfolioPct: asPct(perf.xirr),
            benchmarkPct: asPct(perf.benchmark.xirr),
            excessPct: asPct(perf.benchmark.outperformancePct ?? 0),
          }
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* The digest                                                          */
/* ------------------------------------------------------------------ */

export async function buildHomeDigest(): Promise<HomeDigest> {
  const plan = await runPlan([
    // The shared deterministic context Mission Control already assembles:
    // legacy portfolio report, sector rotation, market regime, watchlist alerts,
    // scanner freshness. One call, reused by four modules below.
    { id: "ctx", run: () => gatherContext() },

    // The universal report is a separate, heavier build (multi-asset-class,
    // decision cards, optimization). It is what Modules 3 and 4 need.
    { id: "report", run: () => buildPortfolioReport() },

    { id: "calendar", run: () => getCalendarEvents() },
    { id: "watchlist", run: async () => listWatchlist() },
    { id: "notifications", run: async () => listNotifications(20) },
    { id: "performance", run: () => buildPerformance() },

    // Market intelligence needs breadth and sector attention, both of which
    // ride on ctx (regime + rotation + the portfolio's sector weights).
    {
      id: "market",
      dependsOn: ["ctx"],
      run: (deps) => {
        const ctx = deps.ctx as MissionControlContext;
        return buildMarketIntelligence({
          regime: ctx.regime,
          breadthPct: ctx.regime?.breadthPct ?? null,
          sectorAttention: buildSectorAttention(ctx.report, ctx.rotation).changes,
        });
      },
    },
  ], { timeoutMs: 20_000 });

  const ctx = stepValue<MissionControlContext>(plan, "ctx");
  const report = stepValue<UniversalPortfolioReport>(plan, "report");
  const calendar = stepValue<{ events: { id: string; symbol?: string; name: string; type: string; date: string }[] }>(plan, "calendar");
  const watchlist = stepValue<WatchlistItem[]>(plan, "watchlist") ?? [];
  const notifications = stepValue<Parameters<typeof buildRecommendedActions>[2]>(plan, "notifications") ?? [];
  const market = stepValue<HomeDigest["marketIntelligence"]>(plan, "market");
  const performance = stepValue<PortfolioPerformanceSummary>(plan, "performance");

  // Events: next 14 days, which is the window both the calendar card and the
  // watchlist's earnings list read from.
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 14);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const upcoming: UpcomingEventLite[] = (calendar?.events ?? [])
    .filter((e) => e.date >= today && e.date <= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((e) => ({ id: e.id, symbol: e.symbol, name: e.name, type: e.type, date: e.date }));

  const watchlistAlerts = ctx?.watchlistAlerts ?? [];

  // buildOpportunitySnapshot and buildCalibration read the *legacy* report shape
  // that gatherContext already produced — reusing Mission Control's own builders
  // rather than reimplementing fit-ranked opportunities on the homepage.
  const opportunity = ctx
    ? buildOpportunitySnapshot(ctx)
    : { status: "empty" as const, healthIssues: [], opportunities: [], scannerFreshness: null };

  const calibration = ctx
    ? await buildCalibration(ctx.report).catch(() => ({ status: "empty" as const, trackRecord: null, eligible: false }))
    : { status: "empty" as const, trackRecord: null, eligible: false };

  const activity = buildRecentActivity();
  const { timeline, intelligence } = buildTimelineFeeds({
    activity: activity.entries,
    notifications,
    watchlistAlerts,
    upcomingEvents: upcoming,
  });

  // The retired modules' engines now feed the Attention Queue instead of owning
  // cards. These are the *same* already-computed slices the digest was building;
  // the feeders are pure transforms of them, so the queue costs no extra fetch.
  const recommendedActions = buildRecommendedActions(report, watchlistAlerts, notifications);
  const threats = buildThreats(report);

  // symbol → portfolio weight (0–1), for portfolio-weighted impact on
  // threats/alerts/events. `Holding.weight` is a percentage.
  const weightBySymbol: WeightBySymbol = new Map();
  if (report) {
    for (const h of report.holdings) {
      if (h.symbol) weightBySymbol.set(h.symbol.toUpperCase(), h.weight / 100);
    }
  }

  const now = Date.now();
  const marketOpen = estimateMarketStatus("US", new Date(now)) === "open";
  const dismissals = listActiveDismissals(now);

  const attention = buildAttentionQueue({
    feeders: [
      { id: "actions", run: () => seedsFromActions(recommendedActions.actions) },
      { id: "threats", run: () => seedsFromThreats(threats.threats) },
      { id: "alerts", run: () => seedsFromAlerts(watchlistAlerts, weightBySymbol) },
      { id: "events", run: () => seedsFromEvents(upcoming, weightBySymbol, now, marketOpen) },
      { id: "signals", run: () => seedsFromSignals(opportunity.opportunities) },
    ],
    dismissals,
    now,
  });

  return {
    generatedAt: new Date().toISOString(),

    attention,

    marketIntelligence:
      market ?? { status: "degraded", groups: [], breadthPct: null, sentiment: null, regime: null, sectorAttention: [] },

    portfolioPulse: buildPortfolioPulse(report),

    recommendedActions,

    threats,

    attribution: buildAttribution(
      report,
      performance?.benchmark ? { symbol: performance.benchmark.symbol, excessPct: performance.benchmark.excessPct } : null,
    ),

    opportunityFeed: {
      status: opportunity.status,
      opportunities: opportunity.opportunities,
      scannerFreshness: opportunity.scannerFreshness,
    },

    timeline,
    intelligence,

    watchlistIntelligence: buildWatchlistIntelligence(watchlist, watchlistAlerts, upcoming),

    upcomingEvents: { status: upcoming.length > 0 ? "ok" : "empty", events: upcoming },

    performance:
      performance ?? { status: "degraded", xirrPct: null, holdingDays: 0, totalReturnPct: 0, totalReturnDollar: 0, benchmark: null },

    activity,

    calibration,

    // Ships with the digest so Today's Brief has something true to render the
    // instant the page paints, whether or not Ollama is up and whether or not
    // the AI stream ever arrives. Reads the same universal report Portfolio
    // Pulse renders, so the prose and the badge cannot disagree.
    fallbackBriefing: ctx
      ? deterministicBriefing(ctx, toBriefPortfolio(report), notifications.filter((n) => !n.read).length)
      : "No market or portfolio data available yet.",
  };
}
