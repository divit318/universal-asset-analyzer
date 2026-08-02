"use client";

/**
 * IC Report page.
 *
 * Progressive rendering: each tab unlocks the moment its stage completes
 * (Phase 5.1). One container grid for the whole lifecycle (5.3). URL state
 * for symbol and active tab (5.17). ARIA tab pattern with arrow keys (8.3),
 * keyboard shortcuts (5.24), sticky tab bar with the action cluster (5.17).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { downloadBlob } from "@/lib/download";
import type { ICReport } from "@/lib/ic-report";
import { AGENT_COUNT } from "@/lib/ic-questions";
import { signalLibrarySize } from "@/lib/ic-signals";
import type { AgentFinding } from "@/lib/ic-agents";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { Reveal } from "@/app/_components/reveal";
import { PageShell } from "@/app/_components/ui";
import { useTaskSplash } from "@/app/_components/boot-context";
import { useFocusSafe } from "@/lib/focus-context";
import { useReportStream } from "./_components/use-report-stream";
import { ProgressPanel } from "./_components/progress-panel";
import { HeaderSummary } from "./_components/header-summary";
import { ValuationTab } from "./_components/valuation-tab";
import { ThesisTab } from "./_components/thesis-tab";
import { AgentsTab } from "./_components/agents-tab";
import { SignalsTab } from "./_components/signals-tab";
import { WatchTab } from "./_components/watch-tab";
import { DataTab } from "./_components/data-tab";
import { SkeletonCard, EmptyState } from "./_components/shared";

const TABS = ["thesis", "valuation", "agents", "signals", "watch", "data"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  thesis: "Thesis",
  valuation: "Valuation",
  agents: "Agents",
  signals: "Signals",
  watch: "Watch Items",
  data: "Data",
};

function readUrlState(): { symbol: string; tab: Tab } {
  if (typeof window === "undefined") return { symbol: "", tab: "valuation" };
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab") as Tab | null;
  return {
    symbol: (params.get("symbol") ?? "").toUpperCase(),
    tab: tab && TABS.includes(tab) ? tab : "valuation",
  };
}

export default function ICReportPage() {
  const focus = useFocusSafe();
  const taskSplash = useTaskSplash();
  const { state, start, stop, restore, loadHistoric } = useReportStream();
  const [symbol, setSymbol] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("valuation");
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [previousReport, setPreviousReport] = useState<ICReport | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const autoRunRef = useRef(false);
  const restoredRef = useRef(false);
  const tabListRef = useRef<HTMLDivElement>(null);

  /* ── URL state: shareable, bookmarkable, survives refresh (5.17) ── */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const url = readUrlState();
     
    setActiveTab(url.tab);
    if (url.symbol) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deep-link symbol lands after mount by design
      setSymbol(url.symbol);
      focus?.recordFocus(url.symbol);
      if (new URLSearchParams(window.location.search).get("autorun") === "1") autoRunRef.current = true;
      else void restore(url.symbol);
    } else if (focus?.mostRecent) {
       
      setSymbol(focus.mostRecent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncUrl = useCallback((sym: string, tab: Tab) => {
    const params = new URLSearchParams(window.location.search);
    if (sym) params.set("symbol", sym);
    else params.delete("symbol");
    params.set("tab", tab);
    params.delete("autorun");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, []);

  useEffect(() => {
    if (restoredRef.current) syncUrl(symbol.trim().toUpperCase(), activeTab);
  }, [symbol, activeTab, syncUrl]);

  /* ── Export cluster ── */
  const doExport = async (format: "pdf" | "md" | "json") => {
    if (!state.report) return;
    setExportErr(null);
    setExporting(format);
    const date = state.report.generatedAt.slice(0, 10);
    const ext = format === "md" ? "md" : format;
    try {
      await downloadBlob("/api/export/ic-report", `ic-report-${state.report.symbol}-${date}.${ext}`, "POST", {
        report: state.report,
        format,
      });
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const copyMarkdown = async () => {
    if (!state.report) return;
    try {
      const res = await fetch("/api/export/ic-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report: state.report, format: "md" }),
      });
      if (!res.ok) throw new Error(`Copy failed (${res.status})`);
      await navigator.clipboard.writeText(await res.text());
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : "Copy failed");
    }
  };

  /* ── Run ── */
  const run = useCallback(async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym || state.running) return;
    focus?.recordFocus(sym);
    setPreviousReport(state.report);
    setExportErr(null);
    setStartedAt(Date.now());
    taskSplash.show("ic-report");
    const done = start(sym);
    // Dismiss the splash as soon as the stream is live; the progress panel takes over.
    setTimeout(() => taskSplash.reportReady(), 1200);
    await done;
    taskSplash.hide();
  }, [symbol, state.running, state.report, focus, start, taskSplash]);

  useEffect(() => {
    if (autoRunRef.current && symbol.trim() && !state.running) {
      autoRunRef.current = false;
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  /* ── Page title ── */
  useEffect(() => {
    document.title = symbol ? `${symbol.toUpperCase()} IC Report · UAA` : "IC Report · UAA";
    return () => {
      document.title = "Universal Asset Analyzer";
    };
  }, [symbol]);

  /* ── Keyboard shortcuts (5.24): 1-6 tabs, g generate, e export PDF ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = Number.parseInt(e.key, 10);
      if (idx >= 1 && idx <= TABS.length) {
        setActiveTab(TABS[idx - 1]);
      } else if (e.key === "g" && !state.running && symbol.trim()) {
        void run();
      } else if (e.key === "e" && state.report) {
        void doExport("pdf");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.running, state.report, symbol, run]);

  /* ── ARIA tabs with arrow keys (8.3) ── */
  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const idx = TABS.indexOf(activeTab);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next != null) {
      e.preventDefault();
      setActiveTab(TABS[next]);
      const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>("[role=tab]");
      buttons?.[next]?.focus();
    }
  };

  /* ── Patch a retried agent finding into the displayed report ── */
  const onAgentRetried = useCallback((finding: AgentFinding) => {
    // The stream state is authoritative during a run; after a run we patch the report copy.
    if (state.report) {
      const patched: ICReport = {
        ...state.report,
        agentFindings: [...state.report.agentFindings.filter((f) => f.agent !== finding.agent), finding],
        agentFailures: state.report.agentFailures.filter((f) => f.agent !== finding.agent),
      };
      // useReportStream owns report state; simplest is a full restore via loadHistoric-like set.
      // We refetch from the server, which persisted the patched report.
      void restore(patched.symbol);
    }
  }, [state.report, restore]);

  /* ── Derived view state: progressive data from partial or final report ── */
  const view = useMemo(() => {
    const r = state.report;
    const p = state.partial;
    return {
      facts: r?.facts ?? p.facts,
      signalChecks: r?.signalChecks ?? p.signalChecks,
      questions: r?.questions ?? p.questions,
      valuation: r?.valuation ?? p.valuation,
      caseReconciliation: r?.caseReconciliation ?? p.caseReconciliation,
      priorReconciliation: r?.priorReconciliation ?? p.priorReconciliation,
      historyStats: r?.historyStats ?? p.historyStats,
      agentFindings: r?.agentFindings ?? p.agentFindings,
      agentFailures: r?.agentFailures ?? p.agentFailures ?? [],
      synthesis: r?.synthesis ?? p.synthesis,
      thesis: r?.thesis ?? p.thesis,
      monitorables: r?.monitorables,
      currency: r?.currency ?? p.facts?.currency ?? "USD",
    };
  }, [state.report, state.partial]);

  const hasAnything = state.running || state.report != null || state.events.length > 0;
  const trimmedSymbol = symbol.trim().toUpperCase();
  const market = trimmedSymbol.endsWith(".NS") || trimmedSymbol.endsWith(".BO") ? "IN" : "US";

  const tabReady: Record<Tab, boolean> = {
    thesis: !!view.thesis?.bull || view.agentFindings.length > 0,
    valuation: !!view.valuation,
    agents: view.agentFindings.length > 0 || view.agentFailures.length > 0,
    signals: !!view.signalChecks,
    watch: !!view.monitorables,
    data: !!state.report,
  };

  return (
    <PageShell py="py-10" width="wide" className="ic-report-scope">
      {/* Header */}
      <Reveal index={0} as="header" className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">IC Report</h1>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">
            Multi-agent
          </span>
        </div>
        <p className="max-w-3xl text-sm text-muted">
          Signal detection, question generation, a {AGENT_COUNT}-agent investigation, a deterministic valuation engine, and an exportable committee report. Runs fully on local models.
        </p>
      </Reveal>

      {/* Input row */}
      <Reveal index={1} className="flex flex-wrap items-center gap-3">
        <div className="w-80 max-w-full">
          <SymbolSearch
            value={symbol}
            onChange={setSymbol}
            onSelect={(sym) => setSymbol(sym)}
            loading={false}
            placeholder="Ticker or company name (e.g. NVDA, TCS.NS)"
          />
        </div>
        <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted" title="Market is resolved from the ticker: .NS/.BO for NSE/BSE, plain symbols for US exchanges.">
          {trimmedSymbol ? (market === "IN" ? "Indian market (NSE/BSE)" : "US market") : "US and Indian markets"}
        </span>
        {state.running ? (
          <button
            onClick={stop}
            className="min-h-[44px] rounded-lg border border-border px-5 text-sm transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          >
            Stop watching
          </button>
        ) : (
          <button
            onClick={() => void run()}
            disabled={!symbol.trim()}
            className="min-h-[44px] rounded-lg bg-brand-strong px-5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
          >
            Generate report
          </button>
        )}
        <span className="text-label text-muted">Shortcuts: G generate · E export PDF · 1–6 tabs</span>
      </Reveal>

      {state.error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative" role="alert">
          {state.error}
        </div>
      )}

      {/* One grid for the whole lifecycle (5.3) */}
      {hasAnything ? (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            <ProgressPanel
              running={state.running}
              stage={state.stage}
              events={state.events}
              completedAgents={view.agentFindings.length}
              failedAgents={view.agentFailures.length}
              startedAt={startedAt}
            />
          </div>

          <div className="min-w-0">
            <div className="flex flex-col gap-5">
              {state.report && (
                <HeaderSummary
                  report={state.report}
                  previous={previousReport}
                  history={state.history}
                  restoredFromCache={state.restoredFromCache}
                  onSelectHistoric={(generatedAt) => void loadHistoric(state.report!.symbol, generatedAt)}
                  actions={
                    <>
                      <button
                        onClick={() => void doExport("pdf")}
                        disabled={exporting !== null}
                        className="min-h-[36px] rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                      >
                        {exporting === "pdf" ? "Exporting…" : "Export PDF"}
                      </button>
                      <button
                        onClick={() => void doExport("md")}
                        disabled={exporting !== null}
                        className="min-h-[36px] rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                      >
                        Markdown
                      </button>
                      <button
                        onClick={() => void doExport("json")}
                        disabled={exporting !== null}
                        className="min-h-[36px] rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50"
                      >
                        JSON
                      </button>
                      <button
                        onClick={() => void copyMarkdown()}
                        className="min-h-[36px] rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                      >
                        Copy
                      </button>
                      {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
                    </>
                  }
                />
              )}

              {/* Sticky ARIA tab bar (5.17 / 8.3) */}
              <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 py-1 backdrop-blur">
                <div
                  ref={tabListRef}
                  role="tablist"
                  aria-label="Report sections"
                  className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1"
                  onKeyDown={onTabKeyDown}
                >
                  {TABS.map((tab) => (
                    <button
                      key={tab}
                      role="tab"
                      id={`tab-${tab}`}
                      aria-selected={activeTab === tab}
                      aria-controls={`panel-${tab}`}
                      tabIndex={activeTab === tab ? 0 : -1}
                      onClick={() => setActiveTab(tab)}
                      className={`min-h-[40px] shrink-0 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${
                        activeTab === tab
                          ? "bg-brand/15 text-brand shadow-[inset_0_-2px_0_var(--brand)]"
                          : "text-muted hover:text-foreground"
                      }`}
                    >
                      {TAB_LABELS[tab]}
                      {!tabReady[tab] && state.running && (
                        <span className="ml-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning align-middle" aria-label="loading" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab panels — render the moment their stage data exists (5.1) */}
              <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
                {activeTab === "valuation" && (
                  view.valuation ? (
                    <ValuationTab
                      valuation={view.valuation}
                      caseReconciliation={view.caseReconciliation}
                      priorReconciliation={view.priorReconciliation}
                      historyStats={view.historyStats}
                      currency={view.currency}
                    />
                  ) : (
                    <PendingPanel running={state.running} label="Valuation runs within the first minute." />
                  )
                )}
                {activeTab === "thesis" && (
                  view.thesis?.bull || !state.running ? (
                    <ThesisTab thesis={view.thesis} synthesis={view.synthesis} valuation={view.valuation} currency={view.currency} />
                  ) : (
                    <PendingPanel running={state.running} label={`The thesis forms after the ${AGENT_COUNT}-agent network completes.`} />
                  )
                )}
                {activeTab === "agents" && (
                  <AgentsTab
                    findings={view.agentFindings}
                    failures={view.agentFailures}
                    symbol={state.report?.symbol ?? trimmedSymbol}
                    onRetried={onAgentRetried}
                  />
                )}
                {activeTab === "signals" && <SignalsTab checks={view.signalChecks} questions={view.questions} />}
                {activeTab === "watch" && (
                  <WatchTab monitorables={view.monitorables} symbol={state.report?.symbol ?? trimmedSymbol} gaps={view.facts?.gaps} />
                )}
                {activeTab === "data" && (
                  state.report ? <DataTab report={state.report} /> : <PendingPanel running={state.running} label="The provenance table renders when the run completes." />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Landing state */
        <Reveal index={2} className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">
                {symbol.trim()
                  ? `Ready: generate the IC report for ${trimmedSymbol}`
                  : "Enter a ticker to generate a full IC report"}
              </p>
              <p className="max-w-md text-xs leading-5 text-muted">
                {AGENT_COUNT} agents investigate the company: business model, industry, competition, management, capital allocation, accounting, valuation, governance, and risk. A deterministic engine computes every valuation figure.
              </p>
            </div>
            <p className="text-xs text-muted">Sections render as they complete; a full run takes 3 to 15 minutes on a local model.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Signal detection", tone: "text-negative", desc: `${signalLibrarySize("US")} US-market and ${signalLibrarySize("IN")} Indian-market checks, each reported pass or fail with its threshold` },
              { step: "2", title: "Question generation", tone: "text-warning", desc: "Fired signals become signal-derived questions; a labelled baseline checklist covers the rest" },
              { step: "3", title: `${AGENT_COUNT}-agent network`, tone: "text-brand", desc: "Each agent gets a distinct evidence slice and mandate; findings are traced back to the data they cite" },
              { step: "4", title: "Engine and thesis", tone: "text-positive", desc: "Deterministic DCF with invariants, reverse DCF, sensitivity grid, and a thesis written from the computed numbers" },
            ].map(({ step, title, tone, desc }) => (
              <div key={step} className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-label font-semibold ${tone}`}>
                    {step}
                  </span>
                  <h3 className="text-sm font-semibold">{title}</h3>
                </div>
                <p className="text-xs leading-5 text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </Reveal>
      )}
    </PageShell>
  );
}

function PendingPanel({ running, label }: { running: boolean; label: string }) {
  if (!running) return <EmptyState title="Nothing here yet" detail={label} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted">{label}</p>
      <SkeletonCard lines={4} />
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}
