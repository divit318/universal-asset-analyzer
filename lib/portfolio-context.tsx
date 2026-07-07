"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { PortfolioReport, NewPositionRecommendation, PortfolioObjective, PortfolioConstraints } from "@/lib/portfolio-analytics";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";

export type PortfolioTab = "brief" | "holdings" | "intelligence" | "actions" | "review";

const OBJECTIVE_KEY   = "uaa_portfolio_objective";
const CONSTRAINTS_KEY = "uaa_portfolio_constraints";

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

interface PortfolioCtx {
  // Report data — single source of truth
  report: PortfolioReport | null;
  reportLoading: boolean;
  reportError: string | null;
  refreshReport: (force?: boolean) => void;

  // Cross-tab symbol focus
  focusedSymbol: string | null;
  focusSymbol: (symbol: string | null) => void;

  // Navigation with optional context
  activeTab: PortfolioTab;
  navigateTo: (tab: PortfolioTab, opts?: { symbol?: string }) => void;

  // Portfolio objective (drives AI recommendations)
  objective: PortfolioObjective;
  setObjective: (o: PortfolioObjective) => void;

  // User-defined constraints
  constraints: PortfolioConstraints;
  setConstraints: (c: PortfolioConstraints) => void;

  // New position recommendations (AI-powered, objective-aware)
  newPositionRecs: NewPositionRecommendation[];
  newPositionRecsLoading: boolean;
  newPositionRecsError: string | null;
  fetchNewPositionRecs: () => void;
}

const Ctx = createContext<PortfolioCtx | null>(null);

export function usePortfolio(): PortfolioCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePortfolio must be used inside PortfolioProvider");
  return ctx;
}

interface Props {
  children: ReactNode;
  initialTab?: PortfolioTab;
}

export function PortfolioProvider({ children, initialTab = "brief" }: Props) {
  const [report, setReport]               = useState<PortfolioReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError]     = useState<string | null>(null);
  const [focusedSymbol, setFocusedSymbol] = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<PortfolioTab>(initialTab);
  const loadingRef = useRef(false);

  // Lazy initializers read localStorage once on first render — no effect needed
  const [objective, _setObjective]     = useState<PortfolioObjective>(() => loadObjective());
  const [constraints, _setConstraints] = useState<PortfolioConstraints>(() => loadConstraints());

  const [newPositionRecs, setNewPositionRecs]               = useState<NewPositionRecommendation[]>([]);
  const [newPositionRecsLoading, setNewPositionRecsLoading] = useState(false);
  const [newPositionRecsError, setNewPositionRecsError]     = useState<string | null>(null);
  const newRecsCacheKeyRef = useRef<string | null>(null);

  const setObjective = useCallback((o: PortfolioObjective) => {
    _setObjective(o);
    try { localStorage.setItem(OBJECTIVE_KEY, o); } catch { /* ignore */ }
    setNewPositionRecs([]);
    newRecsCacheKeyRef.current = null;
  }, []);

  const setConstraints = useCallback((c: PortfolioConstraints) => {
    _setConstraints(c);
    try { localStorage.setItem(CONSTRAINTS_KEY, JSON.stringify(c)); } catch { /* ignore */ }
    setNewPositionRecs([]);
    newRecsCacheKeyRef.current = null;
  }, []);

  const refreshReport = useCallback(async (force = false) => {
    if (loadingRef.current && !force) return;
    loadingRef.current = true;
    setReportLoading(true);
    setReportError(null);
    try {
      const url = force ? "/api/portfolio/report?fresh=1" : "/api/portfolio/report";
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setReport(json as PortfolioReport);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "Analytics unavailable");
    } finally {
      setReportLoading(false);
      loadingRef.current = false;
    }
  }, []);

  const fetchNewPositionRecs = useCallback(async () => {
    const cacheKey = `${objective}__${JSON.stringify(constraints)}`;
    if (newRecsCacheKeyRef.current === cacheKey && newPositionRecs.length > 0) return;

    setNewPositionRecsLoading(true);
    setNewPositionRecsError(null);
    try {
      const res = await fetch("/api/portfolio/new-positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objective, constraints }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setNewPositionRecs((json as { recommendations: NewPositionRecommendation[] }).recommendations ?? []);
      newRecsCacheKeyRef.current = cacheKey;
    } catch (e) {
      setNewPositionRecsError(e instanceof Error ? e.message : "Failed to fetch recommendations");
    } finally {
      setNewPositionRecsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objective, constraints]);

  const focusSymbol = useCallback((symbol: string | null) => {
    setFocusedSymbol(symbol);
  }, []);

  const navigateTo = useCallback((tab: PortfolioTab, opts?: { symbol?: string }) => {
    if (opts?.symbol != null) setFocusedSymbol(opts.symbol);
    setActiveTab(tab);
    requestAnimationFrame(() => {
      document.getElementById("portfolio-content")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <Ctx.Provider value={{
      report, reportLoading, reportError, refreshReport,
      focusedSymbol, focusSymbol,
      activeTab, navigateTo,
      objective, setObjective,
      constraints, setConstraints,
      newPositionRecs, newPositionRecsLoading, newPositionRecsError, fetchNewPositionRecs,
    }}>
      {children}
    </Ctx.Provider>
  );
}
