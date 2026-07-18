"use client";

/**
 * Investment Operating System (IOS) — React context.
 *
 * Wraps the entire application. Every module — Research, Compare, Scanner,
 * Screener, Watchlist — can call useIOS() to:
 *   • Get the user's InvestmentProfile (portfolio + objective + preferences)
 *   • Compute PortfolioFitAnalysis for any asset synchronously
 *   • Re-rank lists by combined absolute + fit score
 *   • Track behavioral signals (researched symbols, dismissed assets)
 *
 * The IOS independently fetches /api/portfolio/report with the same 5-minute
 * server-side cache as the Portfolio module, so it never double-bills a network
 * round-trip when the user is on the Portfolio page.
 *
 * Objective + constraints are read from the same localStorage keys that
 * PortfolioContext writes, so the two contexts stay in sync without coupling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { PortfolioObjective, PortfolioConstraints } from "@/lib/portfolio-analytics";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import { useDataset } from "@/lib/platform/client/use-dataset";

import { buildInvestmentProfile, fromUniversalReport } from "@/lib/ios/profile";
import { computePortfolioFit, rankByFit } from "@/lib/ios/fit-scorer";
import type {
  InvestmentProfile,
  FitAssetData,
  PortfolioFitAnalysis,
  ContextualRanking,
  BehavioralSignals,
} from "@/lib/ios/types";
import { DEFAULT_BEHAVIORAL } from "@/lib/ios/types";

/* -------------------------------------------------------------------------- */
/* localStorage keys (shared with PortfolioContext)                           */
/* -------------------------------------------------------------------------- */

const OBJECTIVE_KEY     = "uaa_portfolio_objective";
const CONSTRAINTS_KEY   = "uaa_portfolio_constraints";
const BEHAVIORAL_KEY    = "uaa_ios_behavioral";
const MAX_RECENT        = 20;

function loadObjective(): PortfolioObjective {
  if (typeof window === "undefined") return "ai_optimized";
  try {
    const v = localStorage.getItem(OBJECTIVE_KEY);
    if (v) return v as PortfolioObjective;
  } catch { /* ignore */ }
  return "ai_optimized";
}

function loadConstraints(): PortfolioConstraints {
  if (typeof window === "undefined") return DEFAULT_CONSTRAINTS;
  try {
    const v = localStorage.getItem(CONSTRAINTS_KEY);
    if (v) return { ...DEFAULT_CONSTRAINTS, ...(JSON.parse(v) as Partial<PortfolioConstraints>) };
  } catch { /* ignore */ }
  return DEFAULT_CONSTRAINTS;
}

function loadBehavioral(): BehavioralSignals {
  if (typeof window === "undefined") return DEFAULT_BEHAVIORAL;
  try {
    const v = localStorage.getItem(BEHAVIORAL_KEY);
    if (v) return { ...DEFAULT_BEHAVIORAL, ...(JSON.parse(v) as Partial<BehavioralSignals>) };
  } catch { /* ignore */ }
  return DEFAULT_BEHAVIORAL;
}

function saveBehavioral(b: BehavioralSignals): void {
  try { localStorage.setItem(BEHAVIORAL_KEY, JSON.stringify(b)); } catch { /* ignore */ }
}

/* -------------------------------------------------------------------------- */
/* Context value shape                                                         */
/* -------------------------------------------------------------------------- */

export interface IOSContextValue {
  /** The fully-built InvestmentProfile (empty when no portfolio). */
  profile: InvestmentProfile;
  profileReady: boolean;
  profileLoading: boolean;

  /** The raw portfolio report (null when the user has no portfolio). Exposes
   * PositionRecommendation[] for the Portfolio Decision Engine, already
   * computed here — no new engine code needed to surface it elsewhere. */
  report: UniversalPortfolioReport | null;

  /** Synchronous fit computation — usable directly in render. */
  getPortfolioFit: (asset: FitAssetData) => PortfolioFitAnalysis;

  /** Re-rank a list of assets by combined absolute + fit score. */
  rankByPortfolioFit: (
    items: Array<FitAssetData & { absoluteScore: number }>,
    fitWeight?: number,
  ) => ContextualRanking[];

  /** Record that the user researched a symbol (drives behavioral learning). */
  trackResearch: (symbol: string) => void;

  /** Mark a symbol as rejected (future recommendations skip it). */
  rejectSymbol: (symbol: string) => void;

  /** Clear a previous rejection. */
  clearRejection: (symbol: string) => void;

  /** True when symbol is in the user's rejected list. */
  isRejected: (symbol: string) => boolean;

  /** Force the portfolio report to refetch — call after a trade so `report`/`profile` reflect it immediately. */
  refreshReport: () => void;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

const IOSCtx = createContext<IOSContextValue | null>(null);

export function useIOS(): IOSContextValue {
  const ctx = useContext(IOSCtx);
  if (!ctx) throw new Error("useIOS must be used inside IOSProvider");
  return ctx;
}

/** Returns null instead of throwing when used outside IOSProvider. */
export function useIOSSafe(): IOSContextValue | null {
  return useContext(IOSCtx);
}

/* -------------------------------------------------------------------------- */
/* IOSProvider                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The report fetcher, keyed identically to how the Portfolio page's own
 * useDataset call keys its default load ("portfolioReport", "maximize_sharpe" —
 * page.tsx's initial `useState<Objective>` default). Sharing that exact key is
 * what lets the two consumers share ONE in-flight request and ONE cached result
 * instead of each independently computing the full report.
 *
 * This used to be a raw, independent `fetch()` here — invisible to the
 * platform's client store, so IOSProvider (mounted once for the whole app) and
 * the Portfolio page each triggered their own full report computation on every
 * portfolio page load, with no sharing between them. That was the single
 * biggest cause of a slow portfolio load: not one expensive computation, but
 * two of them racing each other for the same data.
 */
async function fetchDefaultReport(signal: AbortSignal): Promise<UniversalPortfolioReport> {
  const res = await fetch("/api/portfolio/report?objective=maximize_sharpe", { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
  return json as UniversalPortfolioReport;
}

export function IOSProvider({ children }: { children: ReactNode }) {
  const [objective, setObjective]     = useState<PortfolioObjective>("ai_optimized");
  const [constraints, setConstraints] = useState<PortfolioConstraints>(DEFAULT_CONSTRAINTS);
  const [behavioral, setBehavioral]   = useState<BehavioralSignals>(DEFAULT_BEHAVIORAL);

  // ── Fetch portfolio report, deferred off the critical path ─────────────
  // The IOS profile is an enhancement layer, not first-paint content. Waiting
  // for the browser to go idle keeps this heavy multi-symbol fetch from
  // contending with whatever page the user actually landed on — and if that
  // page IS the Portfolio page (which fetches the same key immediately),
  // useDataset's dedup means this deferred call joins that in-flight request
  // rather than starting a second one.
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    const run = () => setDeferred(true);
    const handle = ric ? ric(run, { timeout: 2000 }) : window.setTimeout(run, 200);
    return () => {
      const cic = (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback;
      if (ric && cic) cic(handle);
      else clearTimeout(handle);
    };
  }, []);

  const { data: report, isInitialLoading, refresh: refreshReport } = useDataset<UniversalPortfolioReport>(
    "portfolioReport",
    "maximize_sharpe",
    fetchDefaultReport,
    { enabled: deferred },
  );
  const profileLoading = deferred && isInitialLoading;
  const profileReady = !isInitialLoading;

  // ── Hydrate from localStorage on mount ─────────────────────────────────
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setObjective(loadObjective());
    setConstraints(loadConstraints());
    setBehavioral(loadBehavioral());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // ── Listen for PortfolioContext changes to stay in sync ────────────────
  // We poll localStorage every time we regain focus or visibility — cheap and
  // works without coupling to PortfolioContext internals.
  useEffect(() => {
    const syncPrefs = () => {
      setObjective(loadObjective());
      setConstraints(loadConstraints());
    };
    window.addEventListener("focus", syncPrefs);
    document.addEventListener("visibilitychange", syncPrefs);
    return () => {
      window.removeEventListener("focus", syncPrefs);
      document.removeEventListener("visibilitychange", syncPrefs);
    };
  }, []);

  // ── Derived InvestmentProfile ─────────────────────────────────────────
  // Pure, but memoized so the context value below keeps a stable identity —
  // otherwise every provider render rebuilds the profile and re-renders every
  // useIOS() consumer across the app.
  const profile: InvestmentProfile = useMemo(
    () => buildInvestmentProfile(report ? fromUniversalReport(report) : null, objective, constraints, behavioral),
    [report, objective, constraints, behavioral],
  );

  // ── Core IOS operations ───────────────────────────────────────────────

  const getPortfolioFit = useCallback(
    (asset: FitAssetData): PortfolioFitAnalysis => computePortfolioFit(asset, profile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.builtAt, profile.objective, profile.hasPortfolio],
  );

  const rankByPortfolioFit = useCallback(
    (
      items: Array<FitAssetData & { absoluteScore: number }>,
      fitWeight = 0.4,
    ): ContextualRanking[] => rankByFit(items, profile, fitWeight),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [profile.builtAt, profile.objective, profile.hasPortfolio],
  );

  const trackResearch = useCallback((symbol: string) => {
    setBehavioral((prev) => {
      const sym = symbol.toUpperCase();
      const recent = [sym, ...prev.recentlyResearched.filter((s) => s !== sym)].slice(
        0,
        MAX_RECENT,
      );
      const next = { ...prev, recentlyResearched: recent };
      saveBehavioral(next);
      return next;
    });
  }, []);

  const rejectSymbol = useCallback((symbol: string) => {
    setBehavioral((prev) => {
      const sym = symbol.toUpperCase();
      if (prev.rejectedSymbols.includes(sym)) return prev;
      const next = { ...prev, rejectedSymbols: [...prev.rejectedSymbols, sym] };
      saveBehavioral(next);
      return next;
    });
  }, []);

  const clearRejection = useCallback((symbol: string) => {
    setBehavioral((prev) => {
      const sym = symbol.toUpperCase();
      const next = {
        ...prev,
        rejectedSymbols: prev.rejectedSymbols.filter((s) => s !== sym),
      };
      saveBehavioral(next);
      return next;
    });
  }, []);

  const isRejected = useCallback(
    (symbol: string) => behavioral.rejectedSymbols.includes(symbol.toUpperCase()),
    [behavioral.rejectedSymbols],
  );

  const value = useMemo<IOSContextValue>(
    () => ({
      profile,
      profileReady,
      profileLoading,
      report,
      getPortfolioFit,
      rankByPortfolioFit,
      trackResearch,
      rejectSymbol,
      clearRejection,
      isRejected,
      refreshReport,
    }),
    [
      profile,
      profileReady,
      profileLoading,
      report,
      getPortfolioFit,
      rankByPortfolioFit,
      trackResearch,
      rejectSymbol,
      clearRejection,
      isRejected,
      refreshReport,
    ],
  );

  return <IOSCtx.Provider value={value}>{children}</IOSCtx.Provider>;
}
