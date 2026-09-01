/**
 * The Home Digest — one deterministic payload for the whole homepage.
 *
 * Composition only. Every number in here is read from an engine that already
 * computed it: the portfolio report, the decision engine, the Scanner snapshot,
 * sector rotation, the watchlist alert engine, the calendar, the decision
 * journal. This module adds no scoring, no ranking, and no thresholds of its
 * own — the same contract lib/mission-control.ts holds, and for the same
 * reason: a homepage that computes its own version of "portfolio alignment" will
 * drift from /portfolio's version, and then neither is trustworthy.
 *
 * Two hard rules it enforces:
 *
 *   1. **No AI.** The digest must paint immediately. AI is slower than paint
 *      and optional. The narrative arrives separately over
 *      `/api/home/brief` (see brief.ts) and every module that uses it has a
 *      deterministic fallback that ships in *this* payload (`fallbackBriefing`).
 *
 *   2. **Every source degrades alone.** Steps run through `runPlan()`, which
 *      isolates failures: a dead Yahoo tape does not cost you your portfolio
 *      pulse, and an empty portfolio does not cost you the market intelligence.
 *      A module whose source failed renders `degraded`, never a broken page.
 */

import { runPlan, stepValue } from "../platform/orchestrator";
import { dominantBenchmark } from "../benchmarks";
import { getMissionContext, buildOpportunitySnapshot, buildSectorAttention, type MissionControlContext, type UpcomingEventLite } from "../mission-control";
import { getPortfolioReport, type UniversalPortfolioReport } from "../portfolio/report";
import { getCalendarEvents } from "../calendar";
import { listWatchlist, listNotifications } from "../db";
import { isEmptyPerformance } from "../portfolio/performance";
import { buildMarketIntelligence } from "./market-intel";
import { buildPortfolioPulse } from "./pulse";
import { buildEquityCurve, EQUITY_CURVE_DAYS } from "./equity-curve";
import { buildThreats } from "./threats";
import { buildAttribution } from "./attribution";
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
  type WeightBySymbol,
} from "./attention";
import { listActiveDismissals, getHomeFingerprint, putHomeFingerprint } from "../db";
import { estimateMarketStatus } from "../market-hours";
import {
  buildChangeFeed,
  captureFingerprint,
  parseFingerprint,
  shouldPromoteBaseline,
  type FingerprintSource,
  type HomeFingerprint,
} from "./changes";
import { buildSymbolContext } from "./symbol-context";
import { buildDashboardFacts } from "./facts";
import { marketToday, marketDayPlus } from "./clock";
import { MIN_DAYS_TO_ANNUALIZE, type ChangeFeed, type EquityCurve, type HomeDigest, type PortfolioPerformanceSummary } from "./contracts";
import type { WatchlistItem } from "../types";

// Last-resort fallback for degraded/empty states when NO holdings are known
// either (report step failed too, so there are no symbols to derive a market
// from); when holdings survived, the degraded equity-curve label uses
// dominantBenchmark over them instead (see buildHomeDigest). Live performance
// always benchmarks against the market the book mostly holds (lib/benchmarks.ts).
const BENCHMARK = "SPY";

/* ------------------------------------------------------------------ */
/* Module 9 — performance                                              */
/* ------------------------------------------------------------------ */

/**
 * The homepage's performance summary, read OFF the universal report's own
 * performance block — the exact object the Portfolio page's headline tile and
 * Performance tab render.
 *
 * This used to rebuild `portfolioPerformance()` here with its own quote batch
 * and its own benchmark fetch, which is the documented "two surfaces over one
 * portfolio must share one snapshot" failure: quotes are cached for seconds
 * and not persisted, so Home and /portfolio priced the same book at different
 * instants and could disagree on XIRR and the benchmark gap. One block, one
 * snapshot, zero extra fetches — Home now cannot disagree with the tab.
 */
function performanceFromReport(report: UniversalPortfolioReport | undefined): PortfolioPerformanceSummary {
  const block = report?.performance;
  if (!report || !block || isEmptyPerformance(block)) {
    return { status: "empty", xirrPct: null, holdingDays: 0, totalReturnPct: 0, totalReturnDollar: 0, benchmark: null };
  }

  // `portfolioPerformance()` returns every rate as a RATIO (-0.048 = -4.8%)
  // except `total.pct`, which is already in percent. Scale once, here, so no
  // renderer has to remember. Getting this wrong printed "-0.0%" next to "-$25,369".
  const asPct = (ratio: number) => ratio * 100;

  // Annualizing a portfolio younger than a quarter produces a number that is
  // arithmetically correct and practically meaningless — see MIN_DAYS_TO_ANNUALIZE.
  const canAnnualize = block.holdingDays >= MIN_DAYS_TO_ANNUALIZE;

  return {
    status: "ok",
    xirrPct: canAnnualize && block.xirr != null ? asPct(block.xirr) : null,
    holdingDays: block.holdingDays,
    // `total` is the whole-portfolio figure the Portfolio page's headline renders
    // — one definition of "total return" across every surface, by construction.
    totalReturnPct: block.total.pct,
    totalReturnDollar: block.total.pnl,
    // The benchmark comparison is XIRR-vs-XIRR, so it inherits the same gate:
    // if we won't annualize the portfolio, we can't honestly annualize the gap.
    benchmark:
      canAnnualize && block.benchmark && block.xirr != null && block.benchmark.xirr != null
        ? {
            symbol: block.benchmark.symbol,
            portfolioPct: asPct(block.xirr),
            benchmarkPct: asPct(block.benchmark.xirr),
            excessPct: asPct(block.benchmark.outperformancePct ?? 0),
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
    // scanner freshness. One call, reused by four modules below — and shared
    // with the brief route through the platform's missionContext dataset.
    { id: "ctx", run: () => getMissionContext() },

    // The universal report is a separate, heavier build (multi-asset-class,
    // decision cards, optimization). Shared through the platform's
    // portfolioReport dataset (audit PF-02).
    { id: "report", run: () => getPortfolioReport() },

    { id: "calendar", run: () => getCalendarEvents() },
    { id: "watchlist", run: async () => listWatchlist() },
    { id: "notifications", run: async () => listNotifications(20) },
    // Derived from the report's own performance block — never a second quote
    // batch (see performanceFromReport).
    {
      id: "performance",
      dependsOn: ["report"],
      run: async (deps) => performanceFromReport(deps.report as UniversalPortfolioReport | undefined),
    },

    // The Book card's 90-day return index. Rides the same cached `history`
    // dataset the performance step uses; a failure degrades the sparkline alone.
    { id: "equityCurve", run: () => buildEquityCurve(EQUITY_CURVE_DAYS) },

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
  const equityCurve = stepValue<EquityCurve>(plan, "equityCurve");

  // Events: next 14 days, which is the window both the calendar card and the
  // watchlist's earnings list read from. "Today" is the US market-session day
  // (lib/home/clock.ts) — the old UTC slice dropped same-day events from 8pm
  // ET onward while the rest of the page still described the live session
  // (audit NI-10).
  const today = marketToday();
  const cutoffStr = marketDayPlus(14);

  const upcoming: UpcomingEventLite[] = (calendar?.events ?? [])
    .filter((e) => e.date >= today && e.date <= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((e) => ({ id: e.id, symbol: e.symbol, name: e.name, type: e.type, date: e.date }));

  const watchlistAlerts = ctx?.watchlistAlerts ?? [];

  // buildOpportunitySnapshot reads the *legacy* report shape that the shared
  // context already produced — reusing Mission Control's own builder rather
  // than reimplementing fit-ranked opportunities on the homepage.
  // (timeline/intelligence/calibration slices were CUT in Wave 5, audit
  // RD-13/CH-14/PF-07: ~30 KB of payload serialized on every load that no
  // module has selected since the module retirement.)
  const opportunity = ctx
    ? buildOpportunitySnapshot(ctx)
    : { status: "empty" as const, healthIssues: [], opportunities: [], scannerFreshness: null, scannerMethodologyStale: false };

  const activity = buildRecentActivity();

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

  // Signals are deliberately NOT a queue feeder: the Radar is their sole owner
  // (audit RD-02/IA-04 — the queue's five "X fits your book" rows were the
  // same five Radar tiles rendered twice; a scanner idea is browsable context,
  // not a decision demanding triage).
  const attention = buildAttentionQueue({
    feeders: [
      { id: "actions", run: () => seedsFromActions(recommendedActions.actions) },
      { id: "threats", run: () => seedsFromThreats(threats.threats) },
      { id: "alerts", run: () => seedsFromAlerts(watchlistAlerts, weightBySymbol) },
      { id: "events", run: () => seedsFromEvents(upcoming, weightBySymbol, now, marketOpen) },
    ],
    dismissals,
    now,
  });

  const core: Omit<HomeDigest, "changes" | "symbolContext" | "facts"> = {
    generatedAt: new Date().toISOString(),

    attention,

    marketIntelligence:
      market ?? { status: "degraded", groups: [], breadthPct: null, sentiment: null, regime: null, sectorAttention: [], sectors: [] },

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
      scannerMethodologyStale: opportunity.scannerMethodologyStale,
    },

    watchlistIntelligence: buildWatchlistIntelligence(watchlist, watchlistAlerts, upcoming),

    upcomingEvents: { status: upcoming.length > 0 ? "ok" : "empty", events: upcoming },

    performance:
      performance ?? { status: "degraded", xirrPct: null, holdingDays: 0, totalReturnPct: 0, totalReturnDollar: 0, benchmark: null },

    equityCurve:
      equityCurve ??
      {
        status: "degraded",
        windowDays: EQUITY_CURVE_DAYS,
        points: [],
        portfolioPct: null,
        benchmarkPct: null,
        // Degraded state, but market-aware when it can be: benchmark against
        // the market the surviving holdings mostly live in (NIFTY 50 for an
        // India book), exactly as the live curve would have. SPY only when
        // the report step failed too and no symbols are known at all.
        benchmarkSymbol: report
          ? dominantBenchmark(report.holdings.map((h) => h.symbol).filter((s): s is string => s != null)).symbol
          : BENCHMARK,
        coveragePct: null,
      },

    activity,

    // Ships with the digest so Today's Brief has something true to render the
    // instant the page paints, whether or not the AI is available and whether or not
    // the AI stream ever arrives. Reads the same universal report Portfolio
    // Pulse renders, so the prose and the badge cannot disagree.
    fallbackBriefing: ctx
      ? deterministicBriefing(ctx, toBriefPortfolio(report), notifications.filter((n) => !n.read).length)
      : "No market or portfolio data available yet.",
  };

  // The unified-intelligence join: every symbol the page is about to render,
  // looked up once against the book / watchlist / visit log the digest already
  // loaded. Pure join — no extra I/O, cannot slow the first paint.
  const contextSymbols = [
    ...core.attention.items.map((i) => i.symbol),
    ...core.opportunityFeed.opportunities.map((o) => o.symbol),
    ...core.watchlistIntelligence.buckets.flatMap((b) => b.symbols),
    core.portfolioPulse.bestPerformer?.symbol,
    core.portfolioPulse.worstPerformer?.symbol,
  ].filter((s): s is string => !!s);

  const heldWeightsPct = new Map<string, number>();
  if (report) {
    for (const h of report.holdings) {
      if (h.symbol) heldWeightsPct.set(h.symbol.toUpperCase(), h.weight);
    }
  }

  const symbolContext = buildSymbolContext(contextSymbols, {
    heldWeights: heldWeightsPct,
    watchlist,
    activity: activity.entries,
  });

  const changes = detectChanges(core, now);

  // The fact layer: stamps, never new values. Built last so it can carry the
  // change count alongside the slice-sourced facts.
  const facts = buildDashboardFacts(core, {
    changesCount: changes.changes.length,
    unreadNotifications: notifications.filter((n) => !n.read).length,
  });

  return { ...core, changes, symbolContext, facts };
}

/* ------------------------------------------------------------------ */
/* Change detection glue — the only stateful step in the build         */
/* ------------------------------------------------------------------ */

/**
 * Capture the fresh state, promote the previous session's last state to
 * baseline when a new visit has started (see VISIT_GAP_MS), persist, and diff.
 *
 * Failure here must never cost the page: a broken fingerprint read degrades
 * the change feed alone, and the rest of the digest ships untouched.
 */
function detectChanges(core: FingerprintSource, now: number): ChangeFeed {
  try {
    const current = captureFingerprint(core, new Date(now).toISOString());

    const storedCurrent = getHomeFingerprint("current");
    const storedBaseline = getHomeFingerprint("baseline");

    let baseline: HomeFingerprint | null = storedBaseline
      ? parseFingerprint(JSON.parse(storedBaseline.data))
      : null;

    // A gap since the last build means the user left and came back: what they
    // were last looking at becomes the thing we diff against. Refreshes within
    // a sitting keep the existing baseline, so "since your last visit" doesn't
    // reset every 60 seconds.
    if (storedCurrent && shouldPromoteBaseline(storedCurrent.takenAt, now)) {
      const promoted = parseFingerprint(JSON.parse(storedCurrent.data));
      if (promoted) {
        baseline = promoted;
        putHomeFingerprint("baseline", storedCurrent.data, storedCurrent.takenAt);
      }
    }

    putHomeFingerprint("current", JSON.stringify(current), now);

    return buildChangeFeed(baseline, current);
  } catch {
    return { status: "degraded", baselineAt: null, firstVisit: false, changes: [] };
  }
}
