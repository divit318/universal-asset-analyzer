"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import type {
  ScannerResult,
  ScannerProgressEvent,
  ScannerPartialKey,
  ScannerOpportunity,
  ScannerStageEvent,
  ScannerStageFailure,
} from "@/lib/types";
import { CATEGORY_LABELS, type OpportunityCategory } from "@/lib/opportunity-engine";
import { MarketRegimeBanner } from "./_components/market-regime-banner";
import { MarketSummaryCard } from "./_components/market-summary-card";
import { UnifiedSectorRotation } from "./_components/unified-sector-rotation";
import { useBootReady } from "@/app/_components/boot-context";
import { OpportunityCard } from "./_components/opportunity-card";
import { EmergingThemeCard } from "./_components/emerging-theme-card";
import { CausalChainCard } from "./_components/causal-chain";
import { RiskAlertRow } from "./_components/risk-alert-row";
import { CommandBar, type Focus } from "./_components/command-bar";
import { WireSection } from "./_components/wire-section";
import { recordScanDuration } from "@/lib/scanner-eta";
import { WatchlistImpact, PortfolioImpact } from "./_components/watchlist-portfolio-impact";
import { PortfolioWatch } from "./_components/portfolio-watch";
import { Tape } from "./_components/tape";
import { buildTape, type TapeStory } from "@/lib/wire/tape";
import { EvidenceDrawer } from "./_components/evidence-drawer";
import {
  eventStoryIds,
  storyIdsForEventIds,
  riskStoryIds,
  resolveArticles,
  insightsForStories,
  type EvidenceRequest,
} from "@/lib/wire/evidence";
import { canonicalizeSector } from "@/lib/gics-sectors";
import { SectionNav, type WireSection as WireSectionId } from "./_components/section-nav";
import { useIOSSafe } from "@/lib/ios-context";
import { PageShell, Skeleton } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { useToast } from "@/app/_components/toast";
import { usePersistedState } from "@/app/_components/use-persisted-state";

const CACHE_KEY = "uaa_scanner_v3";

/**
 * Only Global/India are real backend-routed sources (fetchMarketNews in
 * lib/news.ts gates two structurally separate source lists on these
 * booleans). US/Europe/China/Asia have no dedicated source lists — they
 * work by seeding the region name into the existing global keyword search
 * (Yahoo/NewsAPI/Google News), the same mechanism as typing it manually.
 */
function focusToParams(focus: Focus): { india: boolean; global: boolean; querySeed: string } {
  switch (focus) {
    case "india":  return { india: true,  global: false, querySeed: "" };
    case "us":     return { india: false, global: true,  querySeed: "United States" };
    case "europe": return { india: false, global: true,  querySeed: "Europe" };
    case "china":  return { india: false, global: true,  querySeed: "China" };
    case "asia":   return { india: false, global: true,  querySeed: "Asia" };
    case "global":
    default:       return { india: false, global: true,  querySeed: "" };
  }
}

// Insight-first order: regime → interpretation → actionable ideas → context →
// the raw feed last. The command bar is sticky and not a nav target.
const WIRE_SECTIONS: WireSectionId[] = [
  { id: "market-state", label: "Market State" },
  { id: "ai-summary", label: "AI Market Summary" },
  { id: "opportunities", label: "Opportunities" },
  { id: "emerging-themes", label: "Emerging Themes" },
  { id: "cause-effect", label: "Cause & Effect" },
  { id: "sector-rotation", label: "Sector Rotation" },
  { id: "risk-monitor", label: "Risk Monitor" },
  { id: "portfolio-impact", label: "Portfolio Impact" },
  { id: "the-tape", label: "The Tape" },
];

const THEME_SECTOR: Record<string, string> = {
  ai: "Technology", artificial: "Technology", software: "Technology",
  semiconductor: "Technology", chip: "Technology", cloud: "Technology",
  cyber: "Technology", tech: "Technology", saas: "Technology",
  data: "Technology", computing: "Technology",
  healthcare: "Healthcare", biotech: "Healthcare", pharma: "Healthcare",
  drug: "Healthcare", medical: "Healthcare", genomic: "Healthcare", health: "Healthcare",
  energy: "Energy", oil: "Energy", gas: "Energy", solar: "Energy",
  wind: "Energy", renewable: "Energy", ev: "Energy", battery: "Energy",
  bank: "Financials", finance: "Financials", fintech: "Financials",
  insurance: "Financials", payment: "Financials",
  retail: "Consumer Discretionary", consumer: "Consumer Discretionary",
  ecommerce: "Consumer Discretionary", luxury: "Consumer Discretionary",
  industrial: "Industrials", infrastructure: "Industrials",
  defense: "Industrials", aerospace: "Industrials", logistics: "Industrials",
  reit: "Real Estate", real: "Real Estate", property: "Real Estate",
  material: "Materials", commodity: "Materials", mining: "Materials", steel: "Materials",
  utility: "Utilities", utilities: "Utilities", power: "Utilities",
  telecom: "Communication Services", media: "Communication Services",
  streaming: "Communication Services", social: "Communication Services",
  staples: "Consumer Staples", food: "Consumer Staples", beverage: "Consumer Staples",
};

function inferSectorFromTheme(theme: string): string | null {
  const words = theme.toLowerCase().split(/\W+/);
  for (const word of words) {
    const sector = THEME_SECTOR[word];
    if (sector) return sector;
  }
  return null;
}
const CATEGORY_ORDER: OpportunityCategory[] = [
  "high_conviction", "portfolio_improver", "value", "growth", "quality_compounder",
  "momentum_leader", "emerging_theme", "sector_rotation", "defensive", "dividend",
];

function buildCategoryGroups(opps: ScannerOpportunity[]): Map<OpportunityCategory, ScannerOpportunity[]> {
  const map = new Map<OpportunityCategory, ScannerOpportunity[]>();
  for (const opp of opps) {
    for (const c of opp.profile?.categories ?? []) {
      const list = map.get(c) ?? [];
      list.push(opp);
      map.set(c, list);
    }
  }
  return map;
}

/** Placeholder for a section whose data hasn't streamed in yet — keeps the
 *  page's structure visible from the first paint instead of a blank gap. */
function SectionSkeleton({ height = "h-40" }: { height?: string }) {
  return <Skeleton height={height} radius="rounded-xl" className="border border-border" />;
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** .NS/.BO-insensitive symbol key, matching the impact panels' comparison. */
function symbolKey(symbol: string): string {
  return symbol.replace(/\.(NS|BO)$/, "").toUpperCase();
}

// Sanity cutoff, NOT a freshness policy: a revisit re-renders the session's
// last scan at any age below this instead of silently kicking off a fresh
// 60s+ pipeline run — the scan is expensive, the command bar already shows
// "Scanned Xm ago" with an explicit Refresh, and navigating Home and back is
// not a request for new work. Only a scan old enough that its "as of" label
// stops being meaningful (a tab left open overnight) auto-rescans.
const CACHE_TTL = 24 * 60 * 60 * 1000;

function saveCache(result: ScannerResult) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ result, cachedAt: Date.now() }));
  } catch { /* storage unavailable */ }
}

function loadCache(): ScannerResult | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { result, cachedAt } = JSON.parse(raw) as { result: ScannerResult; cachedAt: number };
    return Date.now() - cachedAt < CACHE_TTL ? result : null;
  } catch { return null; }
}

/** Symbols out of an API payload — tolerant of shape drift, never throws. */
function extractSymbols(value: unknown, key: string): string[] {
  const container = (value as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(container)) return [];
  return container
    .map((i) => (i as { symbol?: unknown } | null)?.symbol)
    .filter((s): s is string => typeof s === "string");
}

/** Load watchlist/portfolio symbols from the API for impact panels.
 *  /api/watchlist returns { items, groups } (since the Watchlist rebuild);
 *  /api/portfolio returns { holdings, positions } — `positions` is the
 *  market-symbol view the impact panels' ticker match needs. Treating either
 *  payload as a bare array threw, emptied BOTH lists, and silently removed
 *  the Portfolio Impact zone from the page.
 *
 *  Failure is REPORTED, not folded into []: an empty list means "you track
 *  nothing", a failed fetch means "we don't know what you track" — the page
 *  must render those differently (a section gated on `symbols.length > 0`
 *  silently unmounted on fetch failure, indistinguishable from having no
 *  holdings). */
async function loadUserSymbols(): Promise<{
  watchlist: string[];
  portfolio: string[];
  failed: string[];
}> {
  const asJson = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  };
  const [wl, pf] = await Promise.allSettled([
    asJson("/api/watchlist"),
    asJson("/api/portfolio"),
  ]);
  return {
    watchlist: wl.status === "fulfilled" ? extractSymbols(wl.value, "items") : [],
    portfolio: pf.status === "fulfilled" ? extractSymbols(pf.value, "positions") : [],
    failed: [
      ...(wl.status === "rejected" ? ["watchlist"] : []),
      ...(pf.status === "rejected" ? ["portfolio"] : []),
    ],
  };
}

export default function ScannerPage() {
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState<Focus>("global");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ScannerProgressEvent | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<ScannerResult | null>(null);
  // Fields streamed in before the full result lands — see runScan()'s reader
  // loop. `result`, once set, always wins per-field (display below spreads
  // partial first, result second), so this never shows stale data.
  const [partial, setPartial] = useState<Partial<ScannerResult>>({});
  const [error, setError] = useState<string | null>(null);
  // Honest degradation: stages that fell back mid-scan (streamed live), and
  // the latest stall notice while nothing is visibly progressing. A starved
  // scan used to swallow ten timeouts and render as a clean empty result.
  const [stageFailures, setStageFailures] = useState<ScannerStageFailure[]>([]);
  const [stall, setStall] = useState<Extract<ScannerStageEvent, { type: "stall" }> | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);
  // "loading" until the symbols fetch settles; failed endpoints by name after.
  // Distinguishes "you track nothing" from "we couldn't find out" — the
  // Portfolio Impact section renders those as different states.
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [symbolsFailed, setSymbolsFailed] = useState<string[]>([]);

  useBootReady(!loading, "wire");

  const [fitRanking, setFitRanking] = useState(false);
  const [activeCategory, setActiveCategory] = useState<OpportunityCategory | "all">("all");

  const toast = useToast();
  // Dismissals persist across visits and scans (an idea you rejected should
  // not resurrect on refresh) and are restorable — never a silent deletion.
  const [dismissed, setDismissed] = usePersistedState<string[]>("uaa.wire.dismissed", [], isStringArray);

  // Evidence linking: which insight's sources are open in the drawer, and
  // which Tape story is being traced through its downstream insights.
  const [evidence, setEvidence] = useState<EvidenceRequest | null>(null);
  const [trace, setTrace] = useState<TapeStory | null>(null);

  // IOS — portfolio fit re-ranking
  const ios = useIOSSafe();

  function rankOpportunities(opps: ScannerOpportunity[]): ScannerOpportunity[] {
    if (!fitRanking || !ios?.profileReady) return opps;
    const items = opps.map((o) => ({
      ...o,
      symbol: o.ticker,
      absoluteScore: o.opportunityScore.composite,
      sector: inferSectorFromTheme(o.theme),
      marketCap: o.quote?.marketCap ?? null,
      compositeScores: o.compositeScores,
    }));
    const ranked = ios.rankByPortfolioFit(items, 0.4);
    return ranked.map((r) => opps.find((o) => o.ticker === r.symbol)!).filter(Boolean);
  }
  const abortRef = useRef<AbortController | null>(null);

  // The initial state is already "loading", so the mount effect only runs the
  // fetch; the Retry button re-enters the loading state first.
  function fetchUserSymbols() {
    loadUserSymbols().then(({ watchlist, portfolio, failed }) => {
      setWatchlistSymbols(watchlist);
      setPortfolioSymbols(portfolio);
      setSymbolsFailed(failed);
      setSymbolsLoading(false);
    });
  }

  function refreshUserSymbols() {
    setSymbolsLoading(true);
    fetchUserSymbols();
  }

  useEffect(() => {
    // Load user symbols for impact panels
    fetchUserSymbols();

    // Try client cache first, then auto-scan
    const cached = loadCache();
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(cached);
       
      setFromCache(true);
    } else {
      void runScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(e?: React.FormEvent, overrideQuery?: string, overrideFocus?: Focus) {
    e?.preventDefault();
    const q = overrideQuery ?? query;
    const { india, global } = focusToParams(overrideFocus ?? focus);

    // Abort any in-flight scan
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const scanStart = Date.now();
    setLoading(true);
    setError(null);
    setResult(null);
    setPartial({});
    setProgress(null);
    setStageFailures([]);
    setStall(null);
    setScanStartedAt(scanStart);
    setFromCache(false);

    try {
      const res = await fetch("/api/scanner/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim() || undefined, india, global }),
        signal: abort.signal,
      });

      if (!res.ok) {
        throw new Error(`Scan failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let msg:
            | ({ type: "progress" } & ScannerProgressEvent)
            | { type: "partial"; key: ScannerPartialKey; data: unknown }
            | ScannerStageEvent
            | { type: "result"; data: ScannerResult }
            | { type: "cached"; data: ScannerResult }
            | { type: "error"; message: string }
            | { type: "cancelled" };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // Skip malformed lines
          }

          if (msg.type === "progress") {
            setProgress({
              stage: msg.stage,
              message: msg.message,
              pct: msg.pct,
              currentItem: msg.currentItem,
              unitsDone: msg.unitsDone,
              unitsTotal: msg.unitsTotal,
            });
            setStall(null); // any progress clears the stall notice
          } else if (msg.type === "partial") {
            setPartial((prev) => ({ ...prev, [msg.key]: msg.data }));
          } else if (msg.type === "stage_failed") {
            setStageFailures((prev) => [...prev, { stage: msg.stage, reason: msg.reason }]);
          } else if (msg.type === "stall") {
            setStall(msg);
          } else if (msg.type === "result") {
            setResult(msg.data);
            setStageFailures(msg.data.stageFailures ?? []);
            saveCache(msg.data);
            recordScanDuration(Date.now() - scanStart);
          } else if (msg.type === "cached") {
            setResult(msg.data);
            setStageFailures(msg.data.stageFailures ?? []);
            saveCache(msg.data);
            setFromCache(true);
          } else if (msg.type === "cancelled") {
            // The job stopped server-side (this or another subscriber cancelled).
            return;
          } else if (msg.type === "error") {
            throw new Error(msg.message);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      // Only set error if this scan hasn't been superseded by a newer one
      if (abortRef.current === abort) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      // Only reset loading/progress if this scan is still the active one
      if (abortRef.current === abort) {
        setLoading(false);
        setProgress(null);
        setScanStartedAt(null);
      }
    }
  }

  /**
   * Clicking a chip sets the visible search text to its seed (empty for
   * Global/India, which have real dedicated source routing — see
   * focusToParams) so what's driving the scan is never hidden, then runs
   * immediately with fresh values rather than waiting on state to settle.
   */
  function selectFocus(f: Focus) {
    const { querySeed } = focusToParams(f);
    setFocus(f);
    setQuery(querySeed);
    void runScan(undefined, querySeed, f);
  }

  /**
   * Cancel genuinely stops the scan: aborting the fetch disconnects this
   * stream's subscription, and the job registry (lib/platform/jobs.ts) aborts
   * the pipeline server-side once its last subscriber is gone — including the
   * in-flight model call. Not just a client-side unmount.
   */
  function cancelScan() {
    abortRef.current?.abort();
    setLoading(false);
    setProgress(null);
    setStall(null);
    setScanStartedAt(null);
  }

  // Once `result` lands it wins per-field over `partial` (spread order below),
  // so nothing here ever shows stale streamed data next to the final version.
  const display: Partial<ScannerResult> = { ...partial, ...result };
  const allOpportunities = display.opportunities ?? [];
  const causalEvents = (display.events ?? []).filter((e) => e.causalChain.length > 0).slice(0, 6);

  // Dismissed ideas leave the Opportunities zone (only — impact panels still
  // reflect the full scan) and can be restored from the section header.
  const dismissedSet = new Set(dismissed.map(symbolKey));
  const isDismissed = (o: ScannerOpportunity) => dismissedSet.has(symbolKey(o.ticker));
  const opportunities = allOpportunities.filter((o) => !isDismissed(o));
  const highConviction = (display.highConviction ?? []).filter((o) => !isDismissed(o));
  const developing = (display.developing ?? []).filter((o) => !isDismissed(o));
  const dismissedCount = allOpportunities.length - opportunities.length;

  // Join each opportunity back to the market event that produced it — the
  // "why now" line and its corroboration count on the card.
  const eventById = new Map((display.events ?? []).map((e) => [e.id, e]));
  function triggerFor(opp: ScannerOpportunity): { headline: string; sourceCount: number } | null {
    const evs = opp.sourceEventIds
      .map((id) => eventById.get(id))
      .filter((e): e is NonNullable<typeof e> => e != null);
    if (evs.length === 0) return null;
    return {
      headline: evs[0].headline,
      sourceCount: evs.reduce((n, e) => n + Math.max(1, e.sources.length), 0),
    };
  }

  const watchlistSet = new Set(watchlistSymbols.map(symbolKey));
  async function addTickerToWatchlist(ticker: string) {
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Provenance (lib/idea-source.ts): "scanner" — flagged by an event scan.
        body: JSON.stringify({ symbol: ticker, source: "scanner" }),
      });
      if (!res.ok) throw new Error();
      setWatchlistSymbols((prev) => [...prev, ticker]);
      toast(`${ticker} added to watchlist`, "success");
    } catch {
      toast(`Couldn't add ${ticker}`, "error");
    }
  }

  // ── Evidence joins (lib/wire/evidence.ts — pure, derivation-backed, so
  //    payloads cached before storyIds existed still resolve) ──
  const events = display.events ?? [];
  const evidenceArticles = evidence
    ? resolveArticles(evidence.storyIds, display.newsItems ?? [], events)
    : [];

  // Forward trace from a Tape story: light up every downstream insight.
  // Approximate joins (risks) deliberately do not participate.
  const tracedInsights = trace
    ? insightsForStories(trace.storyIds, {
        events,
        emergingThemes: display.emergingThemes,
        sectorImpacts: display.sectorImpacts,
        opportunities: allOpportunities,
      })
    : null;
  const tracedEventIds = new Set(tracedInsights?.eventIds ?? []);
  const tracedThemes = new Set(tracedInsights?.themeNames ?? []);
  const tracedSectors = new Set(
    (tracedInsights?.sectorNames ?? []).map((s) => canonicalizeSector(s) ?? s),
  );
  const tracedOppIds = new Set(tracedInsights?.opportunityIds ?? []);
  const tracedCount =
    tracedEventIds.size + tracedThemes.size + tracedSectors.size + tracedOppIds.size;

  /** Shared card wiring for every opportunity grid in the zone. */
  const cardProps = (opp: ScannerOpportunity) => ({
    opportunity: opp,
    triggerEvent: triggerFor(opp),
    inWatchlist: watchlistSet.has(symbolKey(opp.ticker)),
    onAddToWatchlist: () => void addTickerToWatchlist(opp.ticker),
    onDismiss: () => setDismissed([...dismissed, opp.ticker]),
    onShowEvidence: () =>
      setEvidence({
        title: `${opp.ticker} — ${opp.theme}`,
        storyIds: storyIdsForEventIds(opp.sourceEventIds, events),
      }),
    highlighted: tracedOppIds.has(opp.id),
  });
  // Cluster/dedupe/noise-filter the raw feed once per newsItems arrival —
  // pure and tested in lib/wire/tape.ts, so the component just renders it.
  const newsItems = display.newsItems;
  const tapeView = useMemo(() => (newsItems ? buildTape(newsItems) : null), [newsItems]);

  // Opportunity categories — "Portfolio Improver" is computed client-side from the
  // existing IOS fit engine (never recompute fit logic; just tag opportunities that
  // are a good/excellent fit and not already held).
  const categoryGroups = buildCategoryGroups(opportunities);
  if (ios?.profileReady && ios.profile.hasPortfolio) {
    const improvers = opportunities.filter((o) => {
      const fit = ios.getPortfolioFit({
        symbol: o.ticker,
        sector: inferSectorFromTheme(o.theme),
        marketCap: o.quote?.marketCap ?? null,
        compositeScores: o.compositeScores,
        dividendYield: o.dividendYieldPct,
      });
      return !fit.isInPortfolio && (fit.fitTier === "excellent" || fit.fitTier === "good");
    });
    if (improvers.length > 0) categoryGroups.set("portfolio_improver", improvers);
  }
  const activeCategoryOpportunities = activeCategory === "all"
    ? []
    : [...(categoryGroups.get(activeCategory) ?? [])].sort(
        (a, b) => b.opportunityScore.composite - a.opportunityScore.composite,
      );

  const scanRunningOrDone = loading || result != null;

  return (
    <PageShell py="py-6" width="wide" gap="gap-6">

      {/* ── Zone 1: sticky command bar. Not inside Reveal — its transform
             would disable position:sticky. Scan status renders inline here,
             not as a mid-page block. ── */}
      <CommandBar
        query={query}
        onQueryChange={setQuery}
        focus={focus}
        onSelectFocus={selectFocus}
        onSubmit={runScan}
        loading={loading}
        progress={progress}
        stall={stall}
        degradedCount={stageFailures.length}
        onCancel={cancelScan}
        scannedAt={result?.scannedAt ?? null}
        fromCache={fromCache}
        onRefresh={() => void runScan()}
      />

      <Reveal index={0} as="p" className="text-sm text-muted">
        A live tape across markets, sectors, and your portfolio — investment opportunities discovered from market events, not just headlines.
      </Reveal>

      {/* Floating scroll-spy nav — once a scan is underway or done, so it's
          available to jump between sections as they stream in, not just
          after everything's finished. */}
      {scanRunningOrDone && <SectionNav sections={WIRE_SECTIONS} />}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Degraded scan — sections below reflect PARTIAL analysis. Rendered
          once the result is in (or while failures stream), never silently:
          an empty Opportunities zone with no explanation reads as "no
          opportunities today", which is a different claim. ── */}
      {stageFailures.length > 0 && (
        <details className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
          <summary className="cursor-pointer">
            Partial scan — {stageFailures.length} stage{stageFailures.length === 1 ? "" : "s"} degraded.
            Affected sections reflect reduced analysis.
          </summary>
          <ul className="mt-2 list-disc pl-5 text-xs">
            {stageFailures.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.stage}</span>: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── Active evidence trace — a Tape story lit up through the page ── */}
      {trace && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
          <span className="min-w-0 truncate text-foreground">
            Tracing <span className="font-medium">“{trace.canonical.headline}”</span>
            <span className="text-muted"> — {tracedCount} downstream insight{tracedCount === 1 ? "" : "s"} highlighted</span>
          </span>
          <button
            onClick={() => setTrace(null)}
            className="shrink-0 text-xs text-muted transition-colors hover:text-foreground"
          >
            Clear ✕
          </button>
        </div>
      )}

      {/* ── Zones 2-8 — sections render as their own data streams in (see the
          partial-message handling in runScan() above). Each falls back to a
          skeleton while loading and not yet ready. Ordered by the question
          each answers: regime → interpretation → ideas → context → risk. ── */}
      {scanRunningOrDone && (
        <div className="flex flex-col gap-8">

          {/* Zone 2: Market State — regime + the ONE macro rail */}
          {(display.marketRegime || loading) && (
            <WireSection id="market-state" title="Market State" collapsible persist>
              {display.marketRegime ? (
                <div className="animate-fade-rise">
                  <MarketRegimeBanner
                    regime={display.marketRegime}
                    macroSignals={display.macroSignals ?? []}
                  />
                </div>
              ) : (
                <SectionSkeleton height="h-32" />
              )}
            </WireSection>
          )}

          {/* Zone 3: AI Market Summary — interpretation, labelled as such by
              its accent styling; the measured panels above and below win when
              they disagree. */}
          {(display.marketRegime || loading) && (
            <WireSection id="ai-summary" title="AI Market Summary">
              {display.marketRegime ? (
                <MarketSummaryCard
                  regime={display.marketRegime}
                  macroSignals={display.macroSignals ?? []}
                  scannedAt={display.scannedAt ?? String(scanStartedAt ?? "")}
                />
              ) : (
                <SectionSkeleton height="h-20" />
              )}
            </WireSection>
          )}

          {/* Zone 4: Opportunities — the pipeline's company-level output,
              promoted above the fold. Category filtering is scoped to this
              zone; it no longer hides the rest of the page. */}
          <WireSection
            id="opportunities"
            title="Opportunities"
            badge={opportunities.length > 0 ? `${opportunities.length}` : undefined}
            actions={
              <>
                {dismissedCount > 0 && (
                  <button
                    onClick={() => setDismissed([])}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                    title="Bring back every dismissed opportunity"
                  >
                    Restore dismissed ({dismissedCount})
                  </button>
                )}
                {ios?.profileReady && ios.profile.hasPortfolio && highConviction.length > 0 && (
                  <button
                    onClick={() => setFitRanking((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                      fitRanking
                        ? "border-brand/40 bg-brand/10 text-brand"
                        : "border-border text-muted hover:border-brand/30 hover:text-brand"
                    }`}
                  >
                    {fitRanking ? "Sorted by Portfolio Fit" : "Sort by Portfolio Fit"}
                  </button>
                )}
              </>
            }
          >
            {opportunities.length === 0 ? (
              loading ? (
                <SectionSkeleton />
              ) : (
                <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                  {dismissedCount > 0 ? (
                    <p>All {dismissedCount} opportunities from this scan are dismissed.</p>
                  ) : (
                    <>
                      <p>No company-level ideas cleared the bar in this scan.</p>
                      <p className="max-w-lg text-xs text-muted/70">
                        Ideas appear here only when an event ties to specific tickers AND the
                        company passes the fundamentals gate — a broad tape often produces none.
                        Focus the scan on a theme, sector, or event to go deeper on one area.
                      </p>
                    </>
                  )}
                </div>
              )
            ) : (
              <div className="flex flex-col gap-5">
                {/* Category tabs */}
                <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    onClick={() => setActiveCategory("all")}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      activeCategory === "all"
                        ? "border-brand/40 bg-brand/10 text-brand"
                        : "border-border text-muted hover:border-brand/30 hover:text-brand"
                    }`}
                  >
                    All ({opportunities.length})
                  </button>
                  {CATEGORY_ORDER.filter((c) => (categoryGroups.get(c)?.length ?? 0) > 0).map((c) => (
                    <button
                      key={c}
                      onClick={() => setActiveCategory(c)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        activeCategory === c
                          ? "border-brand/40 bg-brand/10 text-brand"
                          : "border-border text-muted hover:border-brand/30 hover:text-brand"
                      }`}
                    >
                      {CATEGORY_LABELS[c]} ({categoryGroups.get(c)!.length})
                    </button>
                  ))}
                </div>

                {/* Filtered single-category view */}
                {activeCategory !== "all" && (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {activeCategoryOpportunities.map((opp, i) => (
                      <OpportunityCard key={opp.id} {...cardProps(opp)} style={{ animationDelay: `${i * 40}ms` }} />
                    ))}
                  </div>
                )}

                {/* Today's Opportunities (high conviction) */}
                {activeCategory === "all" && highConviction.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">
                        High Conviction
                      </span>
                      <span className="rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-label font-medium text-positive">
                        {highConviction.length}
                      </span>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {rankOpportunities(highConviction).map((opp, i) => (
                        <OpportunityCard key={opp.id} {...cardProps(opp)} style={{ animationDelay: `${i * 40}ms` }} />
                      ))}
                    </div>
                  </div>
                )}

                {/* Developing Signals */}
                {activeCategory === "all" && developing.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">
                        Developing Signals
                      </span>
                      <span className="text-xs text-muted">· Composite 40–69</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {developing.map((opp, i) => (
                        <OpportunityCard key={opp.id} {...cardProps(opp)} style={{ animationDelay: `${i * 40}ms` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </WireSection>

          {/* Zone 5: Emerging Themes */}
          {(display.emergingThemes?.length || (loading && !display.emergingThemes)) ? (
            <WireSection
              id="emerging-themes"
              title="Emerging Themes"
              badge={display.emergingThemes?.length ? `${display.emergingThemes.length}` : undefined}
            >
              {display.emergingThemes && display.emergingThemes.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {display.emergingThemes.map((theme, i) => {
                    const storyIds = storyIdsForEventIds(theme.drivingEvents, events);
                    return (
                      <EmergingThemeCard
                        key={theme.name}
                        theme={theme}
                        style={{ animationDelay: `${i * 40}ms` }}
                        evidenceCount={storyIds.length > 0 ? storyIds.length : undefined}
                        onShowEvidence={
                          storyIds.length > 0
                            ? () => setEvidence({ title: theme.name, storyIds })
                            : undefined
                        }
                        highlighted={tracedThemes.has(theme.name)}
                      />
                    );
                  })}
                </div>
              ) : (
                <SectionSkeleton />
              )}
            </WireSection>
          ) : null}

          {/* Zone 6: Cause & Effect — collapsed by default. Renders even when
              the scan produced no chains: a zone that silently disappears is
              indistinguishable from a rendering bug (and only macro/policy/
              geopolitics events are analyzed, so "none" is a real outcome). */}
          <WireSection
            id="cause-effect"
            title="Cause & Effect"
            badge={causalEvents.length > 0 ? `${causalEvents.length}` : undefined}
            collapsible
            defaultCollapsed
            persist
          >
            {causalEvents.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {causalEvents.map((event, i) => (
                  <CausalChainCard
                    key={event.id}
                    event={event}
                    style={{ animationDelay: `${i * 60}ms` }}
                    onShowEvidence={() =>
                      setEvidence({ title: event.headline, storyIds: eventStoryIds(event) })
                    }
                    highlighted={tracedEventIds.has(event.id)}
                  />
                ))}
              </div>
            ) : loading && !display.events ? (
              <SectionSkeleton />
            ) : (
              <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                No cause-and-effect chains from this scan — none of its events classified as macro, policy, or geopolitics.
              </p>
            )}
          </WireSection>

          {/* Zone 7: Sector Rotation — ONE grid, one tile per sector, carrying
              both datasets (price rank + news sentiment) with divergence as
              the primary affordance. Replaces the two identically-titled
              grids; the shared SectorRotationPanel component is untouched. */}
          <WireSection id="sector-rotation" title="Sector Rotation" collapsible persist>
            <UnifiedSectorRotation
              impacts={display.sectorImpacts}
              scanLoading={loading}
              highlightedSectors={tracedSectors}
              onShowEvidence={(sector) => {
                const impact = (display.sectorImpacts ?? []).find(
                  (s) => (canonicalizeSector(s.sector) ?? s.sector) === sector,
                );
                if (!impact) return;
                setEvidence({
                  title: `${sector} — news sentiment`,
                  storyIds: storyIdsForEventIds(impact.drivingEvents, events),
                });
              }}
            />
          </WireSection>

          {/* Zone 8: Risk Monitor — same rule as Cause & Effect: an empty
              result renders as a statement, not a missing section. */}
          <WireSection
            id="risk-monitor"
            title="Risk Monitor"
            badge={display.riskAlerts?.length ? `${display.riskAlerts.length}` : undefined}
          >
            {display.riskAlerts && display.riskAlerts.length > 0 ? (
              <div className="rounded-xl border border-border overflow-hidden">
                {display.riskAlerts.map((alert, i) => (
                  <RiskAlertRow
                    key={alert.id}
                    alert={alert}
                    style={{ animationDelay: `${i * 40}ms` }}
                    onShowEvidence={() => {
                      // Risks carry no pipeline-recorded event link (that
                      // needs an additive field in extractRiskAlerts, whose
                      // file another session is instrumenting) — this is an
                      // overlap join and the drawer labels it approximate.
                      const { storyIds, approximate } = riskStoryIds(alert, events);
                      setEvidence({ title: alert.headline, storyIds, approximate });
                    }}
                  />
                ))}
              </div>
            ) : loading && !display.riskAlerts ? (
              <SectionSkeleton height="h-20" />
            ) : (
              <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                No risk alerts from this scan — no events carried bearish causal effects or geopolitical classification.
              </p>
            )}
          </WireSection>

        </div>
      )}

      {/* Zone 9: Portfolio Impact — deliberately OUTSIDE the result/loading
          gate. Holdings news fetches independently of the AI pipeline (its own
          streaming route, own loading state), so it's real content the moment
          the page loads; the scan-derived impact cards join it when ready.

          Always mounted once the symbols fetch settles: a failed /api/watchlist
          or /api/portfolio used to silently unmount the whole zone —
          indistinguishable from having no holdings. Same explicit-state rule
          as Cause & Effect / Risk Monitor: fetch failure and genuine emptiness
          each say so in words. */}
      {!symbolsLoading && (
        <WireSection id="portfolio-impact" title="Portfolio Impact">
          <div className="flex flex-col gap-5">
            {symbolsFailed.length > 0 && (
              <p className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                <span>
                  Couldn&apos;t load your {symbolsFailed.join(" and ")} — impact matching below
                  {symbolsFailed.length === 2 ? " is unavailable" : " is incomplete"}.
                </span>
                <button
                  type="button"
                  onClick={refreshUserSymbols}
                  className="shrink-0 rounded border border-warning/40 px-2 py-0.5 text-xs transition-colors hover:bg-warning/20"
                >
                  Retry
                </button>
              </p>
            )}
            {symbolsFailed.length === 0 &&
              watchlistSymbols.length === 0 &&
              portfolioSymbols.length === 0 && (
                <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                  Nothing tracked yet — add symbols to your watchlist or holdings to your
                  portfolio and each scan will flag signals on names you own or follow.
                </p>
              )}
            {/* Full scan output, not the dismissed-filtered list — a signal on
                something you HOLD stays visible even if the idea was dismissed. */}
            {allOpportunities.length > 0 &&
              (watchlistSymbols.length > 0 || portfolioSymbols.length > 0) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <WatchlistImpact opportunities={allOpportunities} watchlistSymbols={watchlistSymbols} />
                  <PortfolioImpact opportunities={allOpportunities} portfolioSymbols={portfolioSymbols} />
                </div>
              )}
            <PortfolioWatch />
          </div>
        </WireSection>
      )}

      {/* Zone 10: The Tape — the raw feed, last and collapsed by default. A
          scan's insights live above; this is the firehose for verification. */}
      {scanRunningOrDone && (tapeView || loading) && (
        <WireSection
          id="the-tape"
          title="The Tape"
          badge={
            tapeView
              ? tapeView.clusteredArticles > 0
                ? `${tapeView.stories.length + tapeView.filtered.length} stories from ${tapeView.totalArticles} articles`
                : `${tapeView.stories.length + tapeView.filtered.length} stories`
              : undefined
          }
          collapsible
          defaultCollapsed
          persist
        >
          {/* The standalone Source Explorer folded into evidence linking:
              per-story sources live in each row's expander, and every insight
              above opens its own sources in the drawer. */}
          {tapeView ? (
            <Tape
              view={tapeView}
              tracedStoryId={trace?.id ?? null}
              onTrace={(story) => setTrace((prev) => (prev?.id === story.id ? null : story))}
            />
          ) : (
            <SectionSkeleton height="h-56" />
          )}
        </WireSection>
      )}

      {/* ── Evidence drawer — one click from any insight to its sources ── */}
      {evidence && (
        <EvidenceDrawer
          request={evidence}
          articles={evidenceArticles}
          onClose={() => setEvidence(null)}
        />
      )}

      {/* ── Empty state ── */}
      {!result && !loading && !error && (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="9" r="6" />
                <path d="M9 6v6M6 9h6" />
                <path d="M14 14L19 19" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Run the Intelligence Pipeline</p>
              <p className="max-w-md text-xs leading-5 text-muted">
                The Wire collects signals from all sources, clusters stories,
                maps cause-and-effect chains, cross-references fundamentals, and surfaces
                investment opportunities — not just headlines.
              </p>
            </div>
            <button
              onClick={() => void runScan()}
              className="rounded-lg bg-brand-strong px-6 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Open The Wire
            </button>
          </div>

          {/* Quick-launch themes */}
          <div className="flex flex-col gap-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted/60">Quick themes</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "RBI rate cycle", cat: "Macro" },
                { label: "AI infrastructure", cat: "Global" },
                { label: "India defense spending", cat: "Policy" },
                { label: "Copper supply squeeze", cat: "Commodity" },
                { label: "IT sector results", cat: "Earnings" },
                { label: "Semiconductor shortage", cat: "Global" },
                { label: "Fed rate decision", cat: "Macro" },
                { label: "EV demand surge", cat: "Sector" },
              ].map((t) => (
                <button
                  key={t.label}
                  onClick={() => { setQuery(t.label); void runScan(undefined, t.label); }}
                  className="group flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-all hover:border-brand/30 hover:bg-surface-2"
                >
                  <span className="text-sm text-foreground group-hover:text-brand transition-colors">{t.label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-label text-muted">{t.cat}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
