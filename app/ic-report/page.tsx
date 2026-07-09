"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { downloadBlob } from "@/lib/download";
import type { ICReport, ICProgressEvent, ICReportStage } from "@/lib/ic-report";
import type { AgentFinding } from "@/lib/ic-agents";
import type { DetectedSignal } from "@/lib/ic-signals";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { PageShell } from "@/app/_components/ui";
import { GroundingBadge } from "@/app/_components/grounding-badge";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type StreamEvent = ICProgressEvent & { report?: ICReport };

const STAGE_LABELS: Record<ICReportStage, string> = {
  signals: "Signal Detection",
  questions: "Question Generation",
  agents: "Investigation Agents",
  agent_complete: "Agent Network",
  thesis: "Thesis Formation",
  valuation: "Valuation Engine",
  done: "Complete",
  error: "Error",
};

const STAGE_ORDER: ICReportStage[] = [
  "signals",
  "questions",
  "agents",
  "thesis",
  "valuation",
  "done",
];

/* -------------------------------------------------------------------------- */
/* Severity + domain styles                                                   */
/* -------------------------------------------------------------------------- */

const SEV_STYLE = {
  high: "border-negative/40 bg-negative/10 text-negative",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-positive/40 bg-positive/10 text-positive",
};

const CONF_STYLE = {
  high: "text-positive",
  medium: "text-warning",
  low: "text-negative",
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold tracking-tight border-b border-border pb-2">
      {children}
    </h2>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

function SignalsGrid({ signals }: { signals: DetectedSignal[] }) {
  if (!signals.length) return <p className="text-sm text-muted">No material signals detected.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {signals.map((s) => (
        <div key={s.id} className={`rounded-lg border p-3 text-sm ${SEV_STYLE[s.severity]}`}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">{s.category.replace(/_/g, " ")}</span>
            <span className="rounded-full border px-1.5 py-0.5 text-label font-semibold uppercase">{s.severity}</span>
          </div>
          <p className="leading-5">{s.description}</p>
        </div>
      ))}
    </div>
  );
}

const CONF_TOOLTIP: Record<"high" | "medium" | "low", string> = {
  high: "High confidence: data was sufficient and the AI's analysis is consistent with primary sources.",
  medium: "Medium confidence: some data gaps or conflicting signals; take with appropriate caution.",
  low: "Low confidence: limited data available; AI is extrapolating more than analyzing. Verify independently.",
};

function AgentGrid({ findings }: { findings: AgentFinding[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {findings.map((f) => (
        <Card key={f.agent} className="cursor-pointer" >
          <button
            className="w-full text-left"
            onClick={() => setExpanded(expanded === f.agent ? null : f.agent)}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium">{f.agentLabel}</span>
              <span
                className={`text-xs font-semibold uppercase ${CONF_STYLE[f.confidence]}`}
                title={CONF_TOOLTIP[f.confidence]}
              >
                {f.confidence} conf.
              </span>
            </div>
            <ul className="space-y-1">
              {f.keyInsights.slice(0, expanded === f.agent ? undefined : 2).map((ins, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted">
                  <span className="mt-0.5 shrink-0 text-brand">→</span>
                  <span>{ins}</span>
                </li>
              ))}
            </ul>
            {f.keyInsights.length > 2 && (
              <span className="mt-2 block text-xs text-brand">
                {expanded === f.agent ? "Show less" : `+${f.keyInsights.length - 2} more`}
              </span>
            )}
          </button>
          {expanded === f.agent && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs leading-5 text-muted">{f.findings}</p>
              {f.dataLimitations && (
                <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-warning">
                  ⚠ {f.dataLimitations}
                </p>
              )}
              {f.grounding && <GroundingBadge grounding={f.grounding} className="mt-2" />}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ThesisSection({ thesis }: { thesis: ICReport["thesis"] }) {
  const [tab, setTab] = useState<"bull" | "bear" | "base">("base");
  const tabs = [
    { key: "base" as const, label: "Base Case", color: "text-brand" },
    { key: "bull" as const, label: "Bull Case", color: "text-positive" },
    { key: "bear" as const, label: "Bear Case", color: "text-negative" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-lg border border-border bg-surface p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-surface-2 " + t.color : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <p className="text-sm leading-6">{thesis[tab]}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Variant Perception</h3>
          <p className="text-sm leading-5 text-muted">{thesis.variantPerception}</p>
        </Card>
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Market Expectations</h3>
          <p className="text-sm leading-5 text-muted">{thesis.marketExpectations}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          { title: "Key Catalysts", items: thesis.keyCatalysts, color: "text-positive" },
          { title: "Key Drivers", items: thesis.keyDrivers, color: "text-brand" },
          { title: "Key Risks", items: thesis.keyRisks, color: "text-negative" },
        ].map(({ title, items, color }) => (
          <Card key={title}>
            <h3 className={`mb-3 text-sm font-semibold ${color}`}>{title}</h3>
            <ul className="space-y-2">
              {items.map((item, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted">
                  <span className={`mt-0.5 shrink-0 ${color}`}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function ValuationSection({ valuation, runHotCold }: { valuation: ICReport["valuation"]; runHotCold: ICReport["runHotCold"] }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Header summary */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Current Price", value: valuation.currentPrice },
          { label: "Intrinsic Value", value: valuation.intrinsicValueRange },
          { label: "Implied Upside", value: valuation.impliedUpside },
        ].map(({ label, value }) => (
          <Card key={label} className="text-center">
            <div className="text-xs text-muted">{label}</div>
            <div className={`mt-1 text-xl font-semibold ${
              label === "Implied Upside"
                ? value.startsWith("+") ? "text-positive" : value.startsWith("-") ? "text-negative" : ""
                : ""
            }`}>
              {value}
            </div>
          </Card>
        ))}
      </div>

      {/* Approach table */}
      {valuation.approaches.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">Valuation Methods</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 text-left font-medium">Method</th>
                  <th className="pb-2 text-right font-medium">Target</th>
                  <th className="pb-2 text-right font-medium">Upside</th>
                  <th className="pb-2 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {valuation.approaches.map((a) => (
                  <tr key={a.method} className="group">
                    <td className="py-2.5 font-medium">{a.method}</td>
                    <td className="py-2.5 text-right font-mono">{a.priceTarget}</td>
                    <td className={`py-2.5 text-right font-mono ${
                      a.impliedUpside.startsWith("+") ? "text-positive" : "text-negative"
                    }`}>{a.impliedUpside}</td>
                    <td className={`py-2.5 text-right text-xs uppercase ${CONF_STYLE[a.confidence]}`}>{a.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Assumptions per method */}
          <div className="mt-4 space-y-2">
            {valuation.approaches.map((a) => (
              <details key={`${a.method}-details`} className="group">
                <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                  {a.method} assumptions
                </summary>
                <p className="mt-1 rounded-md bg-surface-2 p-2 text-xs leading-5 text-muted">
                  {a.assumptions}
                </p>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* Scenarios */}
      {valuation.scenarios.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          {valuation.scenarios.map((s) => {
            const isPos = s.impliedUpside.startsWith("+");
            const isNeg = s.impliedUpside.startsWith("-");
            return (
              <Card key={s.label}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{s.label}</h3>
                  <span className={`font-mono text-sm font-semibold ${isPos ? "text-positive" : isNeg ? "text-negative" : ""}`}>
                    {s.priceTarget}
                  </span>
                </div>
                <div className={`mb-3 text-xs ${isPos ? "text-positive" : isNeg ? "text-negative" : "text-muted"}`}>
                  {s.impliedUpside}
                </div>
                <ul className="space-y-1">
                  {s.keyAssumptions.map((a, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted">
                      <span className="shrink-0">·</span>
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {/* DCF sensitivity + verdict */}
      {(valuation.dcfSensitivity || valuation.valuationVerdict) && (
        <div className="grid gap-4 md:grid-cols-2">
          {valuation.dcfSensitivity && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">DCF Sensitivity</h3>
              <p className="text-sm leading-5 text-muted">{valuation.dcfSensitivity}</p>
            </Card>
          )}
          {valuation.valuationVerdict && (
            <Card>
              <h3 className="mb-2 text-sm font-semibold">Valuation Verdict</h3>
              <p className="text-sm leading-5 text-muted">{valuation.valuationVerdict}</p>
            </Card>
          )}
        </div>
      )}

      {/* Run Hot / Cold */}
      {runHotCold && (
        <Card className={`border ${
          runHotCold.signal === "run_hot" ? "border-warning/40 bg-warning/5" :
          runHotCold.signal === "run_cold" ? "border-brand/40 bg-brand/5" : ""
        }`}>
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="mb-1 text-sm font-semibold">
                  Run Hot / Cold — Historical Return Percentile
                </h3>
                <p className="text-sm text-muted">
                  Current 1-year return of <strong className="text-foreground">{runHotCold.oneYearReturn.toFixed(1)}%</strong> is at the{" "}
                  <strong className="text-foreground">{runHotCold.percentile}th percentile</strong> of its own return history
                  (median: {runHotCold.medianReturn.toFixed(1)}%).
                </p>
                <p className="mt-1 text-xs text-muted">
                  {runHotCold.signal === "run_hot"
                    ? "RUN HOT — stock is in its top 20% historical return band. Counter-cyclical caution: mean reversion is the higher-probability outcome."
                    : runHotCold.signal === "run_cold"
                    ? "RUN COLD — stock is in its bottom 20% historical return band. Counter-cyclical opportunity: returns are historically at their most attractive."
                    : "NEUTRAL — current returns are within the normal historical range."}
                </p>
              </div>
              <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold uppercase ${
                runHotCold.signal === "run_hot" ? "border-warning/40 text-warning" :
                runHotCold.signal === "run_cold" ? "border-brand/40 text-brand" : "border-border text-muted"
              }`}>
                {runHotCold.signal.replace("_", " ")}
              </span>
            </div>
            {/* Multi-year CAGR windows */}
            {runHotCold.historicalWindows && runHotCold.historicalWindows.filter((w) => w.available).length > 0 && (
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-muted">Long-Run CAGR Windows — Percentile vs Own History</div>
                <div className="flex flex-wrap gap-2">
                  {runHotCold.historicalWindows.filter((w) => w.available).map((w) => {
                    const hotBorder = w.signal === "run_hot" ? "border-warning/50 bg-warning/5" : w.signal === "run_cold" ? "border-brand/50 bg-brand/5" : "border-border bg-surface-2";
                    const pctColor = w.signal === "run_hot" ? "text-warning" : w.signal === "run_cold" ? "text-brand" : "text-muted";
                    return (
                      <div key={w.years} className={`flex flex-col items-center rounded-lg border px-3 py-2 ${hotBorder}`}>
                        <span className="text-xs font-semibold text-muted">{w.years}Y</span>
                        <span className={`font-mono text-sm font-semibold ${w.return > 0 ? "text-positive" : "text-negative"}`}>
                          {w.return > 0 ? "+" : ""}{w.return.toFixed(1)}%
                        </span>
                        <span className="text-label text-muted">CAGR</span>
                        {w.percentile != null && (
                          <span className={`mt-0.5 text-label font-semibold ${pctColor}`}>
                            {w.percentile}th pct
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted">
                  Amber = run hot (≥80th pct of own N-year CAGR history) · Blue = run cold (≤20th pct) · Primary signal uses longest available window.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function ProgressTracker({
  completedAgents,
  totalAgents,
  currentStage,
}: {
  completedAgents: number;
  totalAgents: number;
  currentStage: ICReportStage | null;
}) {
  const activeIdx = currentStage ? STAGE_ORDER.indexOf(currentStage) : -1;

  return (
    <Card>
      <div className="flex flex-col gap-3">
        {STAGE_ORDER.filter((s) => s !== "agent_complete").map((stage, i) => {
          const isDone = activeIdx > i || currentStage === "done";
          const isActive = activeIdx === i;
          const isAgents = stage === "agents";
          // Once past the agents stage, a completed count short of the total
          // means some (or all) agents failed — don't show a false green check.
          const agentsShort = isAgents && isDone && totalAgents > 0 && completedAgents < totalAgents;
          const agentsFailed = agentsShort && completedAgents === 0;

          return (
            <div key={stage} className="flex items-center gap-3">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                agentsFailed ? "border-negative bg-negative/20 text-negative" :
                agentsShort ? "border-warning bg-warning/20 text-warning" :
                isDone ? "border-positive bg-positive/20 text-positive" :
                isActive ? "border-brand bg-brand/20 text-brand animate-pulse" :
                "border-border text-muted"
              }`}>
                {agentsShort ? "!" : isDone ? "✓" : i + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${isActive ? "text-foreground" : isDone ? "text-muted" : "text-muted/50"}`}>
                    {STAGE_LABELS[stage]}
                  </span>
                  {isAgents && totalAgents > 0 && (
                    <span className="text-xs text-muted">{completedAgents}/{totalAgents} agents</span>
                  )}
                </div>
                {isAgents && totalAgents > 0 && (
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-brand transition-all"
                      style={{ width: `${(completedAgents / totalAgents) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Main page                                                                  */
/* -------------------------------------------------------------------------- */

export default function ICReportPage() {
  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState<"US" | "IN">("US");
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<ICReportStage | null>(null);
  const [completedAgents, setCompletedAgents] = useState(0);
  const [totalAgents, setTotalAgents] = useState(0);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [report, setReport] = useState<ICReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Restore last saved report from sessionStorage on mount; also read ?symbol= deep-link
  useEffect(() => {
    // Deep-link from Scanner: /ic-report?symbol=TICKER
    const urlSymbol = new URLSearchParams(window.location.search).get("symbol");
    if (urlSymbol) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSymbol(urlSymbol.toUpperCase());
      // Detect Indian exchange by suffix
      if (urlSymbol.toUpperCase().endsWith(".NS") || urlSymbol.toUpperCase().endsWith(".BO")) {
         
        setExchange("IN");
      }
      return; // don't restore stale cached report when deep-linking
    }
    try {
      const saved = sessionStorage.getItem("uaa_ic_last_report");
      if (saved) {
        const parsed = JSON.parse(saved) as { symbol: string; exchange: "US" | "IN"; report: ICReport };
        if (parsed.symbol && parsed.report) {
          setSymbol(parsed.symbol);
          setExchange(parsed.exchange ?? "US");
          setReport(parsed.report);
        }
      }
    } catch { /* ignore */ }
   
  }, []);

  // Dynamic page title
  useEffect(() => {
    document.title = symbol
      ? `${symbol.toUpperCase()} IC Report · UAA`
      : "Deep Research · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [symbol]);

  // Fetch available Ollama models on mount
  useEffect(() => {
    fetch("/api/screener/nl")
      .then((r) => r.json())
      .then((d: { models?: string[] }) => {
        const models = d.models ?? [];
        setOllamaModels(models);
        if (models.length > 0 && !selectedModel) setSelectedModel(models[0]);
      })
      .catch(() => {/* Ollama offline — model picker hidden gracefully */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addEvent = useCallback((event: StreamEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  async function run() {
    if (!symbol.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    // Start elapsed timer
    startTimeRef.current = Date.now();
    setElapsedSecs(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSecs(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    setRunning(true);
    setError(null);
    setReport(null);
    setEvents([]);
    setCurrentStage(null);
    setCompletedAgents(0);
    setTotalAgents(0);

    try {
      const res = await fetch("/api/ic-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          exchange,
          ...(selectedModel ? { model: selectedModel } : {}),
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let dispatchSeen = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            addEvent(event);

            if (event.stage !== "agent_complete") {
              setCurrentStage(event.stage);
            }

            if (event.stage === "agents" && !dispatchSeen) {
              const match = event.message.match(/(\d+) agents/);
              if (match) {
                dispatchSeen = true;
                setTotalAgents(parseInt(match[1]));
              }
            }

            if (event.stage === "agent_complete") {
              setCompletedAgents((c) => c + 1);
            }

            if (event.stage === "done" && event.report) {
              setReport(event.report);
              // Persist to sessionStorage for restore on next page load
              try {
                sessionStorage.setItem("uaa_ic_last_report", JSON.stringify({
                  symbol: symbol.trim().toUpperCase(),
                  exchange,
                  report: event.report,
                }));
              } catch { /* ignore */ }
            }

            if (event.stage === "error") {
              setError(event.message);
            }
          } catch {
            // Malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setError(err.message);
      }
    } finally {
      setRunning(false);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  const [activeTab, setActiveTab] = useState<"signals" | "agents" | "thesis" | "valuation" | "monitorables">("thesis");

  return (
    <PageShell py="py-10">
      {/* Header */}
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">IC Deep Research</h1>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">
            Multi-agent
          </span>
        </div>
        <p className="max-w-3xl text-sm text-muted">
          Signal detection → question generation → 9-agent investigation → thesis → valuation → exportable IC report. Fully local.
        </p>
      </header>

      {/* Input */}
      <div className="flex flex-wrap gap-3">
        <div className="w-80">
          <SymbolSearch
            value={symbol}
            onChange={setSymbol}
            onSelect={(sym) => setSymbol(sym)}
            loading={false}
          />
        </div>
        <select
          value={exchange}
          onChange={(e) => setExchange(e.target.value as "US" | "IN")}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
        >
          <option value="US">US Markets</option>
          <option value="IN">Indian Markets (NSE/BSE)</option>
        </select>
        {ollamaModels.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              Local AI
            </span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
            >
              {ollamaModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        {running ? (
          <div className="flex items-center gap-3">
            <button
              onClick={stop}
              className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              Stop
            </button>
            <span className="font-mono text-sm text-muted tabular-nums">
              {Math.floor(elapsedSecs / 60).toString().padStart(2, "0")}:{(elapsedSecs % 60).toString().padStart(2, "0")} elapsed
            </span>
            <span className="text-xs text-muted">
              (IC reports typically take 3–15 min on a local model)
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={!symbol.trim()}
              className="rounded-lg bg-brand-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Generate Report
            </button>
            {report && !running && (
              <span className="text-xs text-muted">
                Last report restored from cache ·{" "}
                <button
                  className="text-brand hover:underline"
                  onClick={() => { setReport(null); setEvents([]); }}
                >
                  Clear
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      )}

      {/* Two-column layout during/after run */}
      {(running || report || events.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Progress sidebar */}
          <div className="flex flex-col gap-4">
            <ProgressTracker
              completedAgents={completedAgents}
              totalAgents={totalAgents}
              currentStage={currentStage}
            />
            {running && (
              <div className="rounded-lg border border-border bg-surface px-4 py-3 text-xs text-muted">
                <div className="mb-2 font-medium text-foreground">Live updates</div>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {events.slice(-12).map((e, i) => (
                    <div key={i} className="leading-4">
                      <span className="text-brand">{STAGE_LABELS[e.stage]}: </span>
                      {e.message}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Report content */}
          <div className="min-w-0">
            {report ? (
              <div className="flex flex-col gap-6">
                {/* Report header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">{report.companyName}</h2>
                    <p className="text-sm text-muted">
                      {report.symbol} · {new Date(report.generatedAt).toLocaleString()} · {report.model}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {report.signals.filter((s) => s.severity === "high").length > 0 && (
                      <span className="rounded-full border border-negative/40 bg-negative/10 px-3 py-1 text-xs font-medium text-negative">
                        {report.signals.filter((s) => s.severity === "high").length} high-severity signals
                      </span>
                    )}
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
                      {report.agentFindings.length} agents · {report.questions.length} questions
                    </span>
                    {(report.agentFailures?.length ?? 0) > 0 && (
                      <span className="rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning">
                        {report.agentFailures.length} agent{report.agentFailures.length === 1 ? "" : "s"} failed
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setExportErr(null);
                        void downloadBlob("/api/export/ic-report", `ic-report-${report.symbol}-${new Date().toISOString().slice(0, 10)}.pdf`, "POST", { report })
                          .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-2"
                    >
                      ↓ Export PDF
                    </button>
                    {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
                  </div>
                </div>

                {(report.agentFailures?.length ?? 0) > 0 && (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <p className="font-medium">
                      {report.agentFailures.length} of {report.agentFindings.length + report.agentFailures.length} agents failed — the thesis below was formed without their input.
                    </p>
                    <ul className="mt-1.5 space-y-0.5 text-xs">
                      {report.agentFailures.map((f) => (
                        <li key={f.agent}>
                          <span className="font-medium">{f.agentLabel}:</span> {f.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Tab nav */}
                <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
                  {(["thesis", "valuation", "agents", "signals", "monitorables"] as const).map((tab) => {
                    const TAB_LABELS: Record<typeof tab, string> = {
                      thesis: "Thesis",
                      valuation: "Valuation",
                      agents: "Agents",
                      signals: "Signals",
                      monitorables: "Watch Items",
                    };
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`shrink-0 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                          activeTab === tab ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                        }`}
                      >
                        {TAB_LABELS[tab]}
                      </button>
                    );
                  })}
                </div>

                {/* Tab content */}
                {activeTab === "thesis" && (
                  <section>
                    <SectionHeading>Investment Thesis</SectionHeading>
                    <ThesisSection thesis={report.thesis} />
                  </section>
                )}

                {activeTab === "valuation" && (
                  <section>
                    <SectionHeading>Valuation Engine</SectionHeading>
                    <ValuationSection valuation={report.valuation} runHotCold={report.runHotCold} />
                  </section>
                )}

                {activeTab === "agents" && (
                  <section>
                    <SectionHeading>Agent Investigation Network</SectionHeading>
                    <AgentGrid findings={report.agentFindings} />
                  </section>
                )}

                {activeTab === "signals" && (
                  <section>
                    <SectionHeading>Detected Signals ({report.signals.length})</SectionHeading>
                    <SignalsGrid signals={report.signals} />
                    {report.questions.length > 0 && (
                      <div className="mt-6">
                        <h3 className="mb-3 text-sm font-semibold text-muted">Generated Questions ({report.questions.length})</h3>
                        <div className="space-y-2">
                          {report.questions.map((q) => (
                            <div key={q.id} className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
                              <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-label font-semibold uppercase ${
                                q.priority === "high" ? "bg-negative/10 text-negative" :
                                q.priority === "medium" ? "bg-warning/10 text-warning" :
                                "bg-surface-2 text-muted"
                              }`}>{q.priority}</span>
                              <span className="text-muted">{q.question}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {activeTab === "monitorables" && (
                  <section>
                    <SectionHeading>Watch Items</SectionHeading>
                    <Card>
                      <p className="mb-4 text-sm text-muted">
                        Key metrics and events to track on an ongoing basis.
                      </p>
                      <ul className="space-y-3">
                        {report.monitorables.map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/20 text-xs font-semibold text-brand">
                              {i + 1}
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}
              </div>
            ) : running ? (
              <Card className="flex items-center justify-center py-20">
                <div className="flex flex-col items-center gap-3 text-muted">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
                  <span className="text-sm">
                    {currentStage ? `${STAGE_LABELS[currentStage]}…` : "Initialising…"}
                  </span>
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      )}

      {/* Landing state */}
      {!running && !report && events.length === 0 && (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Enter a ticker to generate a full IC report</p>
              <p className="max-w-sm text-xs leading-5 text-muted">
                9 AI agents investigate your company: growth, valuation, competition, management, capital allocation,
                accounting, governance, risks, and optionality.
              </p>
            </div>
            <p className="text-xs text-muted/60">~3–15 minutes on a local model</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { step: "1", title: "Signal Detection", color: "text-negative", desc: "13 signal types including ROCE drops, margin compression, FII selling, and working capital issues" },
              { step: "2", title: "Question Generation", color: "text-warning", desc: "Converts each signal into deep analytical questions for the agent network to investigate" },
              { step: "3", title: "9-Agent Network", color: "text-brand", desc: "Business, Industry, Competition, Management, Capital Allocation, Accounting, Valuation, Governance, Risk" },
              { step: "4", title: "Thesis + Valuation", color: "text-positive", desc: "Bull/Bear/Base thesis, DCF + SOTP, run hot/cold analysis, scenario analysis, exportable IC report" },
            ].map(({ step, title, color, desc }) => (
              <Card key={step}>
                <div className="mb-2 flex items-center gap-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-label font-semibold ${color}`}>
                    {step}
                  </span>
                  <h3 className="text-sm font-semibold">{title}</h3>
                </div>
                <p className="text-xs leading-5 text-muted">{desc}</p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </PageShell>
  );
}
