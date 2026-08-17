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
import { useBootReady } from "@/app/_components/boot-context";
import { MarketNow, type PulseData } from "./_components/market-now";
import { Developments } from "./_components/developments";
import { ForYou } from "./_components/for-you";
import { DeltaStrip } from "./_components/delta-strip";
import { IdeaRow } from "./_components/idea-row";
import { TheFeed } from "./_components/the-feed";
import { OpportunityCard } from "./_components/opportunity-card";
import { EmergingThemeCard } from "./_components/emerging-theme-card";
import { RiskAlertRow } from "./_components/risk-alert-row";
import { CommandBar, type Focus } from "./_components/command-bar";
import { WireSection } from "./_components/wire-section";
import { UnifiedSectorRotation } from "./_components/unified-sector-rotation";
import { recordScanDuration } from "@/lib/scanner-eta";
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
import { rankDevelopments } from "@/lib/wire/developments";
import { buildPersonalImpact } from "@/lib/wire/personal";
import {
  fingerprintScan,
  diffScans,
  isScanFingerprint,
  type ScanFingerprint,
} from "@/lib/wire/delta";
import { canonicalizeSector } from "@/lib/gics-sectors";
import { SectionNav, type WireSection as WireSectionId } from "./_components/section-nav";
import { useIOSSafe } from "@/lib/ios-context";
import { PageShell, Skeleton } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { useToast } from "@/app/_components/toast";
import { usePersistedState } from "@/app/_components/use-persisted-state";

const CACHE_KEY = "uaa_scanner_v3";

/** Previous/last scan fingerprints for the "Since your last scan" diff. */
const FP_KEY = "uaa.wire.fingerprints";

/** How many ideas the Wire leads with; the rest sit behind "View all". */
const TOP_IDEAS_LIMIT = 6;

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

/**
 * Causal-flow order: what's happening (Market Now, instant) → what matters
 * (Top Developments) → what it means for me (For You) → why/where (Sector
 * Map, Themes, Risks) → actionable ideas → the raw feed last. "Since your
 * last scan" renders between Market Now and Developments but is a strip,
 * not a nav target.
 */
const WIRE_SECTIONS: WireSectionId[] = [
  { id: "market-now", label: "Market Now" },
  { id: "developments", label: "Top Developments" },
  { id: "for-you", label: "For You" },
  { id: "sector-map", label: "Sector Map" },
  { id: "themes", label: "Emerging Themes" },
  { id: "risk-monitor", label: "Risk Monitor" },
  { id: "ideas", label: "Ideas" },
  { id: "feed", label: "The Feed" },
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

/** .NS/.BO-insensitive symbol key, matching the personal-impact comparison. */
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

function saveCache(result: ScannerResult, wasDefault: boolean | null) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ result, cachedAt: Date.now(), wasDefault }));
  } catch { /* storage unavailable */ }
}

function loadCache(): { result: ScannerResult; wasDefault: boolean | null } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { result, cachedAt, wasDefault } = JSON.parse(raw) as {
      result: ScannerResult;
      cachedAt: number;
      wasDefault?: boolean | null;
    };
    return Date.now() - cachedAt < CACHE_TTL ? { result, wasDefault: wasDefault ?? null } : null;
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

/** Load watchlist/portfolio symbols from the API for the For You section.
 *  /api/watchlist returns { items, groups } (since the Watchlist rebuild);
 *  /api/portfolio returns { holdings, positions } — `positions` is the
 *  market-symbol view the impact matching needs. Treating either payload as
 *  a bare array threw, emptied BOTH lists, and silently removed the
 *  personalized zone from the page.
 *
 *  Failure is REPORTED, not folded into []: an empty list means "you track
 *  nothing", a failed fetch means "we don't know what you track" — the page
 *  must render those differently. */
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
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [symbolsFailed, setSymbolsFailed] = useState<string[]>([]);

  // Tier-1: live market pulse — independent of the scan pipeline entirely.
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [pulseFailed, setPulseFailed] = useState(false);

  // "Since your last scan" — the previous scan's fingerprint, if this
  // browser saw one. Deltas derive from it at render time.
  const [fpPrev, setFpPrev] = useState<ScanFingerprint | null>(null);
  // True when the scan whose result is on screen used default parameters
  // (blank query, Global focus) — themed scans are not diffed: "new theme:
  // Copper Squeeze" right after searching copper is noise, not news.
  const wasDefaultScanRef = useRef<boolean | null>(null);

  useBootReady(!loading, "wire");

  const [fitRanking, setFitRanking] = useState(false);
  const [activeCategory, setActiveCategory] = useState<OpportunityCategory | "all">("all");
  const [showAllIdeas, setShowAllIdeas] = useState(false);

  const toast = useToast();
  // Dismissals persist across visits and scans (an idea you rejected should
  // not resurrect on refresh) and are restorable — never a silent deletion.
  const [dismissed, setDismissed] = usePersistedState<string[]>("uaa.wire.dismissed", [], isStringArray);

  // Evidence linking: which insight's sources are open in the drawer, and
  // which Feed story is being traced through its downstream insights.
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

  function fetchPulse() {
    fetch("/api/wire/pulse")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: PulseData) => {
        setPulse(data);
        setPulseFailed(false);
      })
      .catch(() => setPulseFailed(true));
  }

  useEffect(() => {
    // Tier 1 in parallel: live pulse + user symbols — neither waits on the scan.
    fetchPulse();
    fetchUserSymbols();

    // Try client cache first, then auto-scan
    const cached = loadCache();
    if (cached) {
      wasDefaultScanRef.current = cached.wasDefault;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(cached.result);

      setFromCache(true);
    } else {
      void runScan();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotate the scan fingerprints when a NEW default scan lands, and restore
  // the previous one across reloads (same scannedAt → same baseline). The
  // deltas themselves derive at render, so StrictMode's double-run is
  // harmless — the store update is idempotent per scannedAt.
  useEffect(() => {
    if (!result) return;
    try {
      const curr = fingerprintScan(result);
      const raw = window.localStorage.getItem(FP_KEY);
      const stored = raw
        ? (JSON.parse(raw) as { prev: unknown; last: unknown })
        : null;
      const last = stored && isScanFingerprint(stored.last) ? stored.last : null;
      const prev = stored && isScanFingerprint(stored.prev) ? stored.prev : null;

      if (last && last.scannedAt === curr.scannedAt) {
        // Same scan as last visit — restore its baseline for a stable strip.
        // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting persisted state after mount; localStorage does not exist during render
        setFpPrev(prev);
      } else if (wasDefaultScanRef.current === true) {
        // New default scan — the old "last" becomes the comparison baseline.
        window.localStorage.setItem(FP_KEY, JSON.stringify({ prev: last, last: curr }));
        setFpPrev(last);
      } else {
        // Themed scan (or unknown provenance) — never diffed, never stored
        // as a baseline: "new theme: Copper Squeeze" right after the user
        // searched copper would be noise, not news.
        setFpPrev(null);
      }
    } catch { /* storage unavailable — no delta strip */ }
  }, [result]);

  async function runScan(e?: React.FormEvent, overrideQuery?: string, overrideFocus?: Focus) {
    e?.preventDefault();
    const q = overrideQuery ?? query;
    const activeFocus = overrideFocus ?? focus;
    const { india, global } = focusToParams(activeFocus);
    wasDefaultScanRef.current = !q.trim() && activeFocus === "global";

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
    setFromCache(false);
    // A fresh scan deserves fresh reaction joins — the pulse is 60s-cached
    // server-side, so this is cheap.
    fetchPulse();

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
            saveCache(msg.data, wasDefaultScanRef.current);
            recordScanDuration(Date.now() - scanStart);
          } else if (msg.type === "cached") {
            setResult(msg.data);
            setStageFailures(msg.data.stageFailures ?? []);
            saveCache(msg.data, wasDefaultScanRef.current);
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
        setError(err instanceof Error ? err.message : "The scan failed before finishing — run it again.");
      }
    } finally {
      // Only reset loading/progress if this scan is still the active one
      if (abortRef.current === abort) {
        setLoading(false);
        setProgress(null);
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
  }

  // Once `result` lands it wins per-field over `partial` (spread order below),
  // so nothing here ever shows stale streamed data next to the final version.
  const display: Partial<ScannerResult> = { ...partial, ...result };
  const displayOpportunities = display.opportunities;
  const displayEvents = display.events;
  // Memoized so downstream useMemos (developments, personal impact) key on
  // the underlying arrays' identity, not on a fresh `?? []` every render.
  const allOpportunities = useMemo(() => displayOpportunities ?? [], [displayOpportunities]);
  const events = useMemo(() => displayEvents ?? [], [displayEvents]);

  // Dismissed ideas leave the Ideas zone (only — For You still reflects the
  // full scan) and can be restored from the section header.
  const dismissedSet = new Set(dismissed.map(symbolKey));
  const isDismissed = (o: ScannerOpportunity) => dismissedSet.has(symbolKey(o.ticker));
  const opportunities = allOpportunities.filter((o) => !isDismissed(o));
  const highConviction = (display.highConviction ?? []).filter((o) => !isDismissed(o));
  const developing = (display.developing ?? []).filter((o) => !isDismissed(o));
  const dismissedCount = allOpportunities.length - opportunities.length;

  // Join each opportunity back to the market event that produced it — the
  // "why now" line and its corroboration count.
  const eventById = new Map(events.map((e) => [e.id, e]));
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
  const evidenceArticles = evidence
    ? resolveArticles(evidence.storyIds, display.newsItems ?? [], events)
    : [];

  // Forward trace from a Feed story: light up every downstream insight.
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

  /** Shared wiring for every idea rendering (compact rows and the full grid). */
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

  // ── Top Developments: deterministic ranking of this scan's events, joined
  //    to the live pulse and the user's names. Pure (lib/wire/developments).
  const developments = useMemo(
    () =>
      rankDevelopments(events, {
        sectorPerf: pulse?.sectorPerf,
        portfolioSymbols,
        watchlistSymbols,
      }),
    [events, pulse, portfolioSymbols, watchlistSymbols],
  );

  // ── For You: the scan joined to what the user owns and follows. Uses the
  //    FULL scan output (not the dismissed-filtered list) — a signal on
  //    something you HOLD stays visible even if the idea was dismissed.
  //    Built once anything has arrived (even an empty completed scan), so
  //    "touches nothing you track" renders as a statement — null means only
  //    "no scan yet".
  const personalImpact = useMemo(
    () =>
      allOpportunities.length > 0 || result != null
        ? buildPersonalImpact(allOpportunities, portfolioSymbols, watchlistSymbols)
        : null,
    [allOpportunities, result, portfolioSymbols, watchlistSymbols],
  );

  // ── Since your last scan: deltas derive at render from the stored
  //    baseline; [] hides the strip (no fabricated changes).
  const deltas = useMemo(
    () => (result && fpPrev ? diffScans(fpPrev, fingerprintScan(result)) : []),
    [result, fpPrev],
  );

  // ── Ideas: the few worth attention first; everything else behind View all.
  const rankedIdeas = rankOpportunities([...highConviction, ...developing]);
  const topIdeas = rankedIdeas.slice(0, TOP_IDEAS_LIMIT);

  // Opportunity categories for the expanded grid — "Portfolio Improver" is
  // computed client-side from the existing IOS fit engine.
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
  const scanMeta = result ? (fromCache ? "cached scan" : "this scan") : loading ? "streaming…" : undefined;

  return (
    <PageShell py="py-6" width="wide" gap="gap-6">

      {/* ── Sticky command bar. Not inside Reveal — its transform would
             disable position:sticky. Scan status renders inline here. ── */}
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
        What&apos;s happening, what matters, why — and what it means for what you own.
      </Reveal>

      {/* Floating scroll-spy nav — once a scan is underway or done. */}
      {scanRunningOrDone && <SectionNav sections={WIRE_SECTIONS} />}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* ── Degraded scan — sections below reflect PARTIAL analysis. Never
          silent: an empty zone with no explanation reads as "nothing today",
          which is a different claim. ── */}
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

      {/* ── Active evidence trace — a Feed story lit up through the page ── */}
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

      {/* ── Tier 1: Market Now — live pulse, independent of the scan. The
          one section that renders in about a second, always. ── */}
      <WireSection id="market-now" title="Market Now">
        <MarketNow
          pulse={pulse}
          pulseFailed={pulseFailed}
          scanRegime={display.marketRegime ?? null}
          scanMacro={display.macroSignals ?? []}
        />
      </WireSection>

      {/* ── Since your last scan — genuine state changes only; renders
          nothing when there's no baseline or nothing changed. ── */}
      <DeltaStrip deltas={deltas} />

      {/* ── Top Developments — the few stories that matter most, each with
          corroboration, live reaction, your exposure, and the pipeline's
          cause→effect chain. ── */}
      {scanRunningOrDone && (
        <WireSection
          id="developments"
          title="Top Developments"
          badge={developments.length > 0 ? `${developments.length}` : undefined}
          meta={scanMeta}
        >
          <Developments
            developments={developments}
            loading={loading && events.length === 0}
            firstRead={tapeView ? tapeView.stories.slice(0, 5) : null}
            onShowEvidence={(dev) =>
              setEvidence({ title: dev.event.headline, storyIds: eventStoryIds(dev.event) })
            }
            tracedEventIds={tracedEventIds}
          />
        </WireSection>
      )}

      {/* ── For You — what the scan means for what you own and follow. High
          on the page by design, and OUTSIDE the scan gate: its symbol
          fetch/empty/failed states are real content whether or not a scan
          ever ran, and a failed /api/watchlist must render as a statement,
          never as a silently missing section. ── */}
      {!symbolsLoading && (
        <WireSection id="for-you" title="For You" meta={scanMeta}>
          <ForYou
            impact={personalImpact}
            scanLoading={loading}
            symbolsLoading={symbolsLoading}
            symbolsFailed={symbolsFailed}
            onRetrySymbols={refreshUserSymbols}
            trackedCounts={{ portfolio: portfolioSymbols.length, watchlist: watchlistSymbols.length }}
          />
        </WireSection>
      )}

      {scanRunningOrDone && (
        <div className="flex flex-col gap-8">

          {/* ── Sector Map — price rank × news sentiment, divergence first ── */}
          <WireSection id="sector-map" title="Sector Map" collapsible persist meta="price · live | sentiment · this scan">
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

          {/* ── Emerging Themes ── */}
          {(display.emergingThemes?.length || (loading && !display.emergingThemes)) ? (
            <WireSection
              id="themes"
              title="Emerging Themes"
              badge={display.emergingThemes?.length ? `${display.emergingThemes.length}` : undefined}
              meta={scanMeta}
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
                        drivingEventCount={theme.drivingEvents.length}
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

          {/* ── Risk Monitor — an empty result renders as a statement, not a
              missing section. ── */}
          <WireSection
            id="risk-monitor"
            title="Risk Monitor"
            badge={display.riskAlerts?.length ? `${display.riskAlerts.length}` : undefined}
            meta={scanMeta}
          >
            {display.riskAlerts && display.riskAlerts.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border">
                {display.riskAlerts.map((alert, i) => (
                  <RiskAlertRow
                    key={alert.id}
                    alert={alert}
                    style={{ animationDelay: `${i * 40}ms` }}
                    onShowEvidence={() => {
                      // Risks carry no pipeline-recorded event link — this is
                      // an overlap join and the drawer labels it approximate.
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

          {/* ── Ideas — the few worth attention, compact; the full universe
              behind View all (category tabs, fit ranking, everything). ── */}
          <WireSection
            id="ideas"
            title="Ideas"
            badge={opportunities.length > 0 ? `top ${Math.min(TOP_IDEAS_LIMIT, rankedIdeas.length)} of ${opportunities.length}` : undefined}
            meta={scanMeta}
            actions={
              <>
                {dismissedCount > 0 && (
                  <button
                    onClick={() => setDismissed([])}
                    className="text-xs text-muted transition-colors hover:text-foreground"
                    title="Bring back every dismissed idea"
                  >
                    Restore dismissed ({dismissedCount})
                  </button>
                )}
                {ios?.profileReady && ios.profile.hasPortfolio && rankedIdeas.length > 0 && (
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
                    <p>All {dismissedCount} ideas from this scan are dismissed.</p>
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
              <div className="flex flex-col gap-3">
                {/* The default: a handful of compact rows. */}
                {!showAllIdeas && (
                  <>
                    <ul className="overflow-hidden rounded-xl border border-border bg-surface">
                      {topIdeas.map((opp, i) => (
                        <IdeaRow key={opp.id} {...cardProps(opp)} style={{ animationDelay: `${i * 40}ms` }} />
                      ))}
                    </ul>
                    {opportunities.length > topIdeas.length && (
                      <button
                        type="button"
                        onClick={() => setShowAllIdeas(true)}
                        className="self-start text-xs text-accent transition-colors hover:underline"
                      >
                        View all {opportunities.length} ideas →
                      </button>
                    )}
                  </>
                )}

                {/* The full universe — category tabs + detailed cards. */}
                {showAllIdeas && (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setShowAllIdeas(false)}
                        className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/30 hover:text-brand"
                      >
                        ← Top ideas
                      </button>
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

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {(activeCategory === "all"
                        ? rankOpportunities(opportunities)
                        : activeCategoryOpportunities
                      ).map((opp, i) => (
                        <OpportunityCard key={opp.id} {...cardProps(opp)} style={{ animationDelay: `${i * 40}ms` }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </WireSection>

          {/* ── The Feed — the one raw-headline surface: this scan's clustered
              tape, plus your holdings' news on a lazily-loaded tab. ── */}
          <WireSection
            id="feed"
            title="The Feed"
            badge={
              tapeView
                ? tapeView.clusteredArticles > 0
                  ? `${tapeView.stories.length + tapeView.filtered.length} stories from ${tapeView.totalArticles} articles`
                  : `${tapeView.stories.length + tapeView.filtered.length} stories`
                : undefined
            }
            collapsible
            persist
          >
            <TheFeed
              tapeView={tapeView}
              tracedStoryId={trace?.id ?? null}
              onTrace={(story) => setTrace((prev) => (prev?.id === story.id ? null : story))}
            />
          </WireSection>

        </div>
      )}

      {/* ── Evidence drawer — one click from any insight to its sources ── */}
      {evidence && (
        <EvidenceDrawer
          request={evidence}
          articles={evidenceArticles}
          onClose={() => setEvidence(null)}
        />
      )}

      {/* ── Empty state (rare — the page auto-scans on first visit) ── */}
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
                what it means for your names — not just headlines.
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
