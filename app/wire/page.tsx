"use client";

import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import type { ScannerResult, ScannerProgressEvent, ScannerPartialKey, ScannerOpportunity } from "@/lib/types";
import { CATEGORY_LABELS, type OpportunityCategory } from "@/lib/opportunity-engine";
import { MarketRegimeBanner } from "./_components/market-regime-banner";
import { MarketSummaryCard } from "./_components/market-summary-card";
import { SectorRotationGrid } from "./_components/sector-rotation-grid";
import { SectorRotationPanel } from "@/app/_components/sector-rotation-panel";
import { useBootReady } from "@/app/_components/boot-context";
import { OpportunityCard } from "./_components/opportunity-card";
import { EmergingThemeCard } from "./_components/emerging-theme-card";
import { CausalChainCard } from "./_components/causal-chain";
import { RiskAlertRow } from "./_components/risk-alert-row";
import { ProgressStream } from "./_components/progress-stream";
import { recordScanDuration } from "@/lib/scanner-eta";
import { SourceExplorer } from "./_components/source-explorer";
import { WatchlistImpact, PortfolioImpact } from "./_components/watchlist-portfolio-impact";
import { PortfolioWatch } from "./_components/portfolio-watch";
import { MacroDashboard } from "./_components/macro-dashboard";
import { NewsTimeline } from "./_components/news-timeline";
import { SectionNav, type WireSection } from "./_components/section-nav";
import { useIOSSafe } from "@/lib/ios-context";
import { PageShell } from "@/app/_components/ui";

const CACHE_KEY = "uaa_scanner_v3";

/** Popular Focus — replaces the old India/Global checkboxes with region shortcuts. */
type Focus = "global" | "us" | "india" | "europe" | "china" | "asia";

const FOCUS_CHIPS: { id: Focus; label: string; emoji: string }[] = [
  { id: "global", label: "Global", emoji: "🌍" },
  { id: "us", label: "US", emoji: "🇺🇸" },
  { id: "india", label: "India", emoji: "🇮🇳" },
  { id: "europe", label: "Europe", emoji: "🇪🇺" },
  { id: "china", label: "China", emoji: "🇨🇳" },
  { id: "asia", label: "Asia", emoji: "🌏" },
];

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

// Ordered fastest-ready to slowest-ready, matching the page's DOM order —
// see the comment above the dashboard's section list for why.
const WIRE_SECTIONS: WireSection[] = [
  { id: "hero", label: "Hero" },
  { id: "portfolio-watch", label: "Portfolio Watch" },
  { id: "news-timeline", label: "News Timeline" },
  { id: "macro-dashboard", label: "Macro Dashboard" },
  { id: "todays-brief", label: "Today's Brief" },
  { id: "market-regime", label: "Market Regime" },
  { id: "emerging-themes", label: "Emerging Themes" },
  { id: "cause-effect", label: "Cause & Effect" },
  { id: "risk-monitor", label: "Risk Monitor" },
  { id: "capital-flows", label: "Capital Flows" },
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
  return <div className={`${height} animate-pulse rounded-xl border border-border bg-surface`} />;
}

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes — matches server cache

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

/** Load watchlist/portfolio symbols from the API for impact panels. */
async function loadUserSymbols(): Promise<{ watchlist: string[]; portfolio: string[] }> {
  try {
    const [wl, pf] = await Promise.allSettled([
      fetch("/api/watchlist").then((r) => r.json()),
      fetch("/api/portfolio").then((r) => r.json()),
    ]);
    const watchlist: string[] = (wl.status === "fulfilled" ? (wl.value as { symbol: string }[]) : []).map((i) => i.symbol);
    const portfolio: string[] = (pf.status === "fulfilled" ? (pf.value as { symbol: string }[]) : []).map((i) => i.symbol);
    return { watchlist, portfolio };
  } catch {
    return { watchlist: [], portfolio: [] };
  }
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
  const [fromCache, setFromCache] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);

  useBootReady(!loading, "wire");

  // Section visibility toggles
  const [showCausal, setShowCausal] = useState(true);
  const [fitRanking, setFitRanking] = useState(false);
  const [activeCategory, setActiveCategory] = useState<OpportunityCategory | "all">("all");

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

  useEffect(() => {
    // Load user symbols for impact panels
    loadUserSymbols().then(({ watchlist, portfolio }) => {
      setWatchlistSymbols(watchlist);
      setPortfolioSymbols(portfolio);
    });

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
            | { type: "progress"; stage: string; message: string; pct: number }
            | { type: "partial"; key: ScannerPartialKey; data: unknown }
            | { type: "result"; data: ScannerResult }
            | { type: "cached"; data: ScannerResult }
            | { type: "error"; message: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // Skip malformed lines
          }

          if (msg.type === "progress") {
            setProgress({ stage: msg.stage as ScannerProgressEvent["stage"], message: msg.message, pct: msg.pct });
          } else if (msg.type === "partial") {
            setPartial((prev) => ({ ...prev, [msg.key]: msg.data }));
          } else if (msg.type === "result") {
            setResult(msg.data);
            saveCache(msg.data);
            recordScanDuration(Date.now() - scanStart);
          } else if (msg.type === "cached") {
            setResult(msg.data);
            saveCache(msg.data);
            setFromCache(true);
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

  // Once `result` lands it wins per-field over `partial` (spread order below),
  // so nothing here ever shows stale streamed data next to the final version.
  const display: Partial<ScannerResult> = { ...partial, ...result };
  const opportunities = display.opportunities ?? [];
  const highConviction = display.highConviction ?? [];
  const developing = display.developing ?? [];
  const causalEvents = (display.events ?? []).filter((e) => e.causalChain.length > 0).slice(0, 6);

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

  return (
    <PageShell py="py-10">

      {/* ── Hero ── */}
      <div id="hero" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">The Wire</h1>
              <span className="flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-label font-medium uppercase tracking-widest text-muted">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-positive opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-positive" />
                </span>
                Live
              </span>
            </div>
            {result && (
              <span className="font-mono text-xs text-muted/60">
                {new Date(result.scannedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {fromCache && (
                  <> · Cached · <button className="text-brand hover:underline" onClick={() => void runScan()}>refresh</button></>
                )}
              </span>
            )}
          </div>
          <Link
            href="/"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            The Desk →
          </Link>
        </div>
        <p className="text-sm text-muted">
          A live tape across markets, sectors, and your portfolio — discovers investment opportunities from market events, not just headlines.
        </p>
      </div>

      {/* ── Search controls ── */}
      <form onSubmit={runScan} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="6" cy="6" r="4.5" /><path d="M9.5 9.5L13 13" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Focus on a theme, sector, or event — or leave blank to auto-scan"
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-muted focus:border-brand"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-brand-strong px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-label font-medium uppercase tracking-widest text-muted/60">Popular Focuses</span>
          {FOCUS_CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => selectFocus(c.id)}
              aria-pressed={focus === c.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                focus === c.id
                  ? "border-brand/40 bg-brand/10 text-brand"
                  : "border-border text-muted hover:border-brand/30 hover:text-brand"
              }`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </form>

      {/* Floating scroll-spy nav — once a scan is underway or done, so it's
          available to jump between sections as they stream in, not just
          after everything's finished. */}
      {(loading || result) && <SectionNav sections={WIRE_SECTIONS} />}

      {/* Portfolio Watch — deliberately OUTSIDE the result/loading gate below.
          It fetches independently of the AI pipeline (its own streaming route,
          own loading state) so it's real content the moment the page loads,
          not gated behind the slow scan. */}
      <div id="portfolio-watch">
        <PortfolioWatch />
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Loading / progress ── */}
      {loading && <ProgressStream event={progress} startedAt={scanStartedAt} />}

      {/* ── Results dashboard — sections render as their own data streams in
          (see the partial-message handling in runScan() above), instead of
          everything waiting for the final Assembly stage. Each section below
          falls back to a skeleton while loading and not yet ready, so the
          page's structure is visible from first paint. ── */}
      {(loading || result) && (() => {
        let stagger = 0;
        const nextDelay = () => `${(stagger++) * 90}ms`;
        return (
        <div className="flex flex-col gap-8">

          {/* Sections below are ordered fastest-ready to slowest-ready, matching
              the partial-arrival order verified against the live pipeline:
              Stage 1 output (no LLM call) → post-Classification → post-Causal-
              Reasoning → post-Sector-Impact → post-Opportunity-Scoring. Keeping
              DOM order in sync with data-readiness order means the page fills
              in top-to-bottom the way it's actually arriving, not out of order. */}

          {/* News Timeline — ready right after Stage 1, before any LLM call runs */}
          {activeCategory === "all" && (
            <div id="news-timeline" className="animate-fade-rise" style={{ animationDelay: nextDelay() }}>
              {display.newsItems ? (
                <NewsTimeline newsItems={display.newsItems} />
              ) : loading ? <SectionSkeleton height="h-56" /> : null}
            </div>
          )}

          {/* Macro Dashboard — same as News Timeline, ready right after Stage 1 */}
          {activeCategory === "all" && (
            <div id="macro-dashboard" className="animate-fade-rise" style={{ animationDelay: nextDelay() }}>
              {display.macroSignals ? (
                <MacroDashboard macroSignals={display.macroSignals} />
              ) : loading ? <SectionSkeleton height="h-24" /> : null}
            </div>
          )}

          {/* Today's Brief — AI narration of the Market Regime / Capital Flows below.
              Streams as soon as marketRegime is ready (after Classification),
              not gated on the rest of the pipeline. */}
          <div id="todays-brief" className="animate-fade-rise" style={{ animationDelay: nextDelay() }}>
            {display.marketRegime ? (
              <MarketSummaryCard
                regime={display.marketRegime}
                macroSignals={display.macroSignals ?? []}
                scannedAt={display.scannedAt ?? String(scanStartedAt ?? "")}
              />
            ) : loading ? <SectionSkeleton height="h-20" /> : null}
          </div>

          {/* Market Regime — same readiness as Today's Brief */}
          <div id="market-regime" className="animate-fade-rise" style={{ animationDelay: nextDelay() }}>
            {display.marketRegime ? (
              <MarketRegimeBanner
                regime={display.marketRegime}
                macroSignals={display.macroSignals ?? []}
              />
            ) : loading ? <SectionSkeleton /> : null}
          </div>

          {/* Emerging Themes — same readiness as Today's Brief/Market Regime */}
          {activeCategory === "all" && (
            display.emergingThemes && display.emergingThemes.length > 0 ? (
              <section id="emerging-themes" className="flex flex-col gap-4">
                <h2 className="text-sm font-semibold">Emerging Themes</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {display.emergingThemes.map((theme, i) => (
                    <EmergingThemeCard key={theme.name} theme={theme} style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              </section>
            ) : loading && !display.emergingThemes ? (
              <div id="emerging-themes"><SectionSkeleton /></div>
            ) : null
          )}

          {/* Cause & Effect — ready right after Causal Reasoning */}
          {activeCategory === "all" && (
            causalEvents.length > 0 ? (
              <section id="cause-effect" className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Cause & Effect</h2>
                  <button
                    onClick={() => setShowCausal((v) => !v)}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    {showCausal ? "Hide" : "Show"}
                  </button>
                </div>
                {showCausal && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {causalEvents.map((event, i) => (
                      <CausalChainCard key={event.id} event={event} style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                  </div>
                )}
              </section>
            ) : loading && !display.events ? (
              <div id="cause-effect"><SectionSkeleton /></div>
            ) : null
          )}

          {/* Risk Monitor — same readiness as Cause & Effect (both need enrichedEvents) */}
          {activeCategory === "all" && (
            display.riskAlerts && display.riskAlerts.length > 0 ? (
              <section id="risk-monitor" className="animate-fade-rise flex flex-col gap-2" style={{ animationDelay: nextDelay() }}>
                <h2 className="text-sm font-semibold">Risk Monitor</h2>
                <div className="rounded-xl border border-border overflow-hidden">
                  {display.riskAlerts.map((alert, i) => (
                    <RiskAlertRow key={alert.id} alert={alert} style={{ animationDelay: `${i * 40}ms` }} />
                  ))}
                </div>
              </section>
            ) : loading && !display.riskAlerts ? (
              <div id="risk-monitor"><SectionSkeleton height="h-20" /></div>
            ) : null
          )}

          {/* Source Explorer — same readiness as Cause & Effect/Risk Monitor
              (reads display.events too); moved up from the very end where it
              used to sit despite its data being ready much earlier. */}
          {activeCategory === "all" && display.events && display.events.length > 0 && (
            <SourceExplorer events={display.events} />
          )}

          {/* Capital Flows — ready right after Sector Impact */}
          {activeCategory === "all" && (
            <div id="capital-flows" className="animate-fade-rise flex flex-col gap-6" style={{ animationDelay: nextDelay() }}>
              <SectorRotationPanel />
              {display.sectorImpacts && display.sectorImpacts.length > 0 ? (
                <SectorRotationGrid impacts={display.sectorImpacts} />
              ) : loading && !display.sectorImpacts ? <SectionSkeleton height="h-32" /> : null}
            </div>
          )}

          {/* Everything below needs scored opportunities (post Opportunity
              Scoring) — the slowest-ready content on the page, since Thesis
              Building (the single most expensive stage) still runs after this
              point and progressively enriches these same cards in place. */}

          {/* Opportunity category tabs */}
          {opportunities.length > 0 && (
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
          )}

          {/* Filtered single-category view */}
          {activeCategory !== "all" && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">{CATEGORY_LABELS[activeCategory]}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeCategoryOpportunities.map((opp, i) => (
                  <OpportunityCard key={opp.id} opportunity={opp} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </section>
          )}

          {/* Today's Opportunities (high conviction) */}
          {activeCategory === "all" && highConviction.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Today&apos;s Opportunities</h2>
                  <span className="rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-label font-medium text-positive">
                    {highConviction.length} High Conviction
                  </span>
                </div>
                {ios?.profileReady && ios.profile.hasPortfolio && (
                  <button
                    onClick={() => setFitRanking((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                      fitRanking
                        ? "border-brand/40 bg-brand/10 text-brand"
                        : "border-border text-muted hover:border-brand/30 hover:text-brand"
                    }`}
                  >
                    <span>✦</span>
                    {fitRanking ? "Sorted by Portfolio Fit" : "Sort by Portfolio Fit"}
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rankOpportunities(highConviction).map((opp, i) => (
                  <OpportunityCard key={opp.id} opportunity={opp} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </section>
          )}

          {/* Watchlist + Portfolio Impact (side by side) */}
          {activeCategory === "all" && (watchlistSymbols.length > 0 || portfolioSymbols.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <WatchlistImpact opportunities={opportunities} watchlistSymbols={watchlistSymbols} />
              <PortfolioImpact opportunities={opportunities} portfolioSymbols={portfolioSymbols} />
            </div>
          )}

          {/* Developing Signals */}
          {activeCategory === "all" && developing.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Developing Signals</h2>
                <span className="text-xs text-muted">· Composite 40–69</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {developing.map((opp, i) => (
                  <OpportunityCard key={opp.id} opportunity={opp} style={{ animationDelay: `${i * 40}ms` }} />
                ))}
              </div>
            </section>
          )}

        </div>
        );
      })()}

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
