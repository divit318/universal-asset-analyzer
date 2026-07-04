"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import type { ScannerResult, ScannerProgressEvent, ScannerOpportunity } from "@/lib/types";
import { CATEGORY_LABELS, type OpportunityCategory } from "@/lib/opportunity-engine";
import { MarketRegimeBanner } from "./_components/market-regime-banner";
import { MarketSummaryCard } from "./_components/market-summary-card";
import { SectorRotationGrid } from "./_components/sector-rotation-grid";
import { SectorRotationPanel } from "@/app/_components/sector-rotation-panel";
import { OpportunityCard } from "./_components/opportunity-card";
import { EmergingThemeCard } from "./_components/emerging-theme-card";
import { CausalChainCard } from "./_components/causal-chain";
import { RiskAlertRow } from "./_components/risk-alert-row";
import { ProgressStream } from "./_components/progress-stream";
import { recordScanDuration } from "@/lib/scanner-eta";
import { SourceExplorer } from "./_components/source-explorer";
import { WatchlistImpact, PortfolioImpact } from "./_components/watchlist-portfolio-impact";
// v1 components — kept for legacy signal display in developing section
import { SignalCard } from "./_components/signal-card";
import { useIOSSafe } from "@/lib/ios-context";

const CACHE_KEY = "uaa_scanner_v3";

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
  const [india, setIndia] = useState(true);
  const [global, setGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ScannerProgressEvent | null>(null);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [result, setResult] = useState<ScannerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [watchlistSymbols, setWatchlistSymbols] = useState<string[]>([]);
  const [portfolioSymbols, setPortfolioSymbols] = useState<string[]>([]);

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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFromCache(true);
    } else {
      void runScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(e?: React.FormEvent, overrideQuery?: string) {
    e?.preventDefault();
    const q = overrideQuery ?? query;

    // Abort any in-flight scan
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    const scanStart = Date.now();
    setLoading(true);
    setError(null);
    setResult(null);
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
          try {
            const msg = JSON.parse(line) as
              | { type: "progress"; stage: string; message: string; pct: number }
              | { type: "result"; data: ScannerResult }
              | { type: "cached"; data: ScannerResult }
              | { type: "error"; message: string };

            if (msg.type === "progress") {
              setProgress({ stage: msg.stage as ScannerProgressEvent["stage"], message: msg.message, pct: msg.pct });
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
          } catch (parseErr) {
            // Skip malformed lines
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

  const opportunities = result?.opportunities ?? [];
  const highConviction = result?.highConviction ?? [];
  const developing = result?.developing ?? [];
  const causalEvents = (result?.events ?? []).filter((e) => e.causalChain.length > 0).slice(0, 6);

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
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">

      {/* ── Header ── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Market Intelligence</h1>
              <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-muted">
                Live
              </span>
            </div>
            {result && (
              <span className="font-mono text-xs text-muted/60">
                {new Date(result.scannedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                {fromCache && (
                  <> · Cached · <button className="text-accent hover:underline" onClick={() => void runScan()}>refresh</button></>
                )}
              </span>
            )}
          </div>
          <Link
            href="/intelligence?view=opportunity-map"
            className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Opportunity Map →
          </Link>
        </div>
        <p className="text-sm text-muted">
          Multi-stage AI pipeline — discovers investment opportunities from market events, not just headlines.
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
              className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="text-muted/60 uppercase tracking-widest font-medium text-[10px]">Markets</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-foreground transition-colors">
            <input type="checkbox" checked={india} onChange={(e) => setIndia(e.target.checked)} className="accent-accent" />
            India (NSE/BSE)
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-foreground transition-colors">
            <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="accent-accent" />
            Global
          </label>
        </div>
      </form>

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Loading / progress ── */}
      {loading && <ProgressStream event={progress} startedAt={scanStartedAt} />}

      {/* ── Results dashboard ── */}
      {result && !loading && (
        <div className="flex flex-col gap-8">

          {/* AI Market Summary — narrates the Market Regime / Sector Rotation section below */}
          <MarketSummaryCard
            regime={result.marketRegime}
            macroSignals={result.macroSignals}
            scannedAt={result.scannedAt}
          />

          {/* 1. Market Regime Banner */}
          <MarketRegimeBanner
            regime={result.marketRegime}
            macroSignals={result.macroSignals}
          />

          {/* Opportunity category tabs */}
          {opportunities.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveCategory("all")}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeCategory === "all"
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-border text-muted hover:border-accent/30 hover:text-accent"
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
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-muted hover:border-accent/30 hover:text-accent"
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
                {activeCategoryOpportunities.map((opp) => (
                  <OpportunityCard key={opp.id} opportunity={opp} />
                ))}
              </div>
            </section>
          )}

          {/* 2. Today's Opportunities (high conviction) */}
          {activeCategory === "all" && highConviction.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Today&apos;s Opportunities</h2>
                  <span className="rounded-full border border-positive/30 bg-positive/10 px-2 py-0.5 text-[10px] font-medium text-positive">
                    {highConviction.length} High Conviction
                  </span>
                </div>
                {ios?.profileReady && ios.profile.hasPortfolio && (
                  <button
                    onClick={() => setFitRanking((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                      fitRanking
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border text-muted hover:border-accent/30 hover:text-accent"
                    }`}
                  >
                    <span>✦</span>
                    {fitRanking ? "Sorted by Portfolio Fit" : "Sort by Portfolio Fit"}
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rankOpportunities(highConviction).map((opp) => (
                  <OpportunityCard key={opp.id} opportunity={opp} />
                ))}
              </div>
            </section>
          )}

          {/* 3. Sector Rotation — continuous engine (rolling relative strength) */}
          {activeCategory === "all" && <SectorRotationPanel />}

          {/* 3b. Sector Rotation — today's news-driven impact (single scan) */}
          {activeCategory === "all" && result.sectorImpacts.length > 0 && (
            <SectorRotationGrid impacts={result.sectorImpacts} />
          )}

          {/* 4. Emerging Themes */}
          {activeCategory === "all" && result.emergingThemes.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-sm font-semibold">Emerging Themes</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {result.emergingThemes.map((theme) => (
                  <EmergingThemeCard key={theme.name} theme={theme} />
                ))}
              </div>
            </section>
          )}

          {/* 5. Causal Event Chains */}
          {activeCategory === "all" && causalEvents.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Market Cause & Effect</h2>
                <button
                  onClick={() => setShowCausal((v) => !v)}
                  className="text-xs text-muted hover:text-foreground transition-colors"
                >
                  {showCausal ? "Hide" : "Show"}
                </button>
              </div>
              {showCausal && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {causalEvents.map((event) => (
                    <CausalChainCard key={event.id} event={event} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 6. Watchlist + Portfolio Impact (side by side) */}
          {activeCategory === "all" && (watchlistSymbols.length > 0 || portfolioSymbols.length > 0) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <WatchlistImpact opportunities={opportunities} watchlistSymbols={watchlistSymbols} />
              <PortfolioImpact opportunities={opportunities} portfolioSymbols={portfolioSymbols} />
            </div>
          )}

          {/* 7. Developing Signals */}
          {activeCategory === "all" && developing.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">Developing Signals</h2>
                <span className="text-xs text-muted">· Composite 40–69</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {developing.map((opp) => (
                  <OpportunityCard key={opp.id} opportunity={opp} />
                ))}
              </div>
            </section>
          )}

          {/* 8. Risk Alerts */}
          {activeCategory === "all" && result.riskAlerts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Risk Alerts</h2>
              <div className="rounded-xl border border-border overflow-hidden">
                {result.riskAlerts.map((alert) => (
                  <RiskAlertRow key={alert.id} alert={alert} />
                ))}
              </div>
            </section>
          )}

          {/* 9. Source Explorer */}
          {activeCategory === "all" && result.events.length > 0 && (
            <SourceExplorer events={result.events} />
          )}

        </div>
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
                The Market Intelligence Scanner collects signals from all sources, clusters stories,
                maps cause-and-effect chains, cross-references fundamentals, and surfaces
                investment opportunities — not just headlines.
              </p>
            </div>
            <button
              onClick={() => void runScan()}
              className="rounded-lg bg-accent-strong px-6 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Launch Scanner
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
                  className="group flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left transition-all hover:border-accent/30 hover:bg-surface-2"
                >
                  <span className="text-sm text-foreground group-hover:text-accent transition-colors">{t.label}</span>
                  <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">{t.cat}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
