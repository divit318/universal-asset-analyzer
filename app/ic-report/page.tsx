"use client";

import { useState, useRef, useCallback } from "react";
import type { ICReport, ICProgressEvent, ICReportStage } from "@/lib/ic-report";
import type { AgentFinding } from "@/lib/ic-agents";
import type { DetectedSignal } from "@/lib/ic-signals";

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
  medium: "border-amber-400/40 bg-amber-400/10 text-amber-400",
  low: "border-positive/40 bg-positive/10 text-positive",
};

const CONF_STYLE = {
  high: "text-positive",
  medium: "text-amber-400",
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
            <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase">{s.severity}</span>
          </div>
          <p className="leading-5">{s.description}</p>
        </div>
      ))}
    </div>
  );
}

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
              <span className={`text-xs font-semibold uppercase ${CONF_STYLE[f.confidence]}`}>
                {f.confidence}
              </span>
            </div>
            <ul className="space-y-1">
              {f.keyInsights.slice(0, expanded === f.agent ? undefined : 2).map((ins, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted">
                  <span className="mt-0.5 shrink-0 text-accent">→</span>
                  <span>{ins}</span>
                </li>
              ))}
            </ul>
            {f.keyInsights.length > 2 && (
              <span className="mt-2 block text-xs text-accent">
                {expanded === f.agent ? "Show less" : `+${f.keyInsights.length - 2} more`}
              </span>
            )}
          </button>
          {expanded === f.agent && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs leading-5 text-muted">{f.findings}</p>
              {f.dataLimitations && (
                <p className="mt-2 rounded-md bg-surface-2 px-2 py-1.5 text-xs text-amber-400">
                  ⚠ {f.dataLimitations}
                </p>
              )}
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
    { key: "base" as const, label: "Base Case", color: "text-accent" },
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
          { title: "Key Drivers", items: thesis.keyDrivers, color: "text-accent" },
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

function ValuationSection({ valuation }: { valuation: ICReport["valuation"] }) {
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
    </div>
  );
}

function ProgressTracker({
  events,
  completedAgents,
  totalAgents,
  currentStage,
}: {
  events: StreamEvent[];
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

          return (
            <div key={stage} className="flex items-center gap-3">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
                isDone ? "border-positive bg-positive/20 text-positive" :
                isActive ? "border-accent bg-accent/20 text-accent animate-pulse" :
                "border-border text-muted"
              }`}>
                {isDone ? "✓" : i + 1}
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
                      className="h-full rounded-full bg-accent transition-all"
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
  const [running, setRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<ICReportStage | null>(null);
  const [completedAgents, setCompletedAgents] = useState(0);
  const [totalAgents, setTotalAgents] = useState(0);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [report, setReport] = useState<ICReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addEvent = useCallback((event: StreamEvent) => {
    setEvents((prev) => [...prev, event]);
  }, []);

  async function run() {
    if (!symbol.trim()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

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
        body: JSON.stringify({ symbol: symbol.trim().toUpperCase(), exchange }),
        signal: abortRef.current.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error("Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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

            if (event.stage === "agents" && event.message.includes("Dispatching")) {
              const match = event.message.match(/(\d+) agents/);
              if (match) setTotalAgents(parseInt(match[1]));
            }

            if (event.stage === "agent_complete") {
              setCompletedAgents((c) => c + 1);
            }

            if (event.stage === "done" && event.report) {
              setReport(event.report);
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
    }
  }

  function stop() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const [activeTab, setActiveTab] = useState<"signals" | "agents" | "thesis" | "valuation" | "monitorables">("thesis");

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      {/* Header */}
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Investment Committee Report</h1>
        <p className="max-w-3xl text-sm text-muted">
          Full equity research pipeline: signal detection → question generation → 9-agent investigation → thesis formation → valuation → IC report.
        </p>
      </header>

      {/* Input */}
      <div className="flex flex-wrap gap-3">
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !running && run()}
          placeholder="Ticker — e.g. AAPL or RELIANCE"
          className="w-64 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
        />
        <select
          value={exchange}
          onChange={(e) => setExchange(e.target.value as "US" | "IN")}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent"
        >
          <option value="US">US Markets</option>
          <option value="IN">Indian Markets (NSE/BSE)</option>
        </select>
        {running ? (
          <button
            onClick={stop}
            className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={run}
            disabled={!symbol.trim()}
            className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Generate Report
          </button>
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
              events={events}
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
                      <span className="text-accent">{STAGE_LABELS[e.stage]}: </span>
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
                  <div className="flex gap-2">
                    {report.signals.filter((s) => s.severity === "high").length > 0 && (
                      <span className="rounded-full border border-negative/40 bg-negative/10 px-3 py-1 text-xs font-medium text-negative">
                        {report.signals.filter((s) => s.severity === "high").length} high-severity signals
                      </span>
                    )}
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted">
                      {report.agentFindings.length} agents · {report.questions.length} questions
                    </span>
                  </div>
                </div>

                {/* Tab nav */}
                <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1">
                  {(["thesis", "valuation", "agents", "signals", "monitorables"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`shrink-0 rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                        activeTab === tab ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"
                      }`}
                    >
                      {tab === "monitorables" ? "Monitorables" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
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
                    <ValuationSection valuation={report.valuation} />
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
                              <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                q.priority === "high" ? "bg-negative/10 text-negative" :
                                q.priority === "medium" ? "bg-amber-400/10 text-amber-400" :
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
                    <SectionHeading>Monitorables</SectionHeading>
                    <Card>
                      <p className="mb-4 text-sm text-muted">
                        Key metrics and events to track on an ongoing basis.
                      </p>
                      <ul className="space-y-3">
                        {report.monitorables.map((item, i) => (
                          <li key={i} className="flex gap-3 text-sm">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs font-semibold text-accent">
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
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-accent" />
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { title: "Signal Detection", desc: "13 signal types: ROCE drop, margin compression, FII selling, working capital deterioration, and more" },
            { title: "Question Generation", desc: "Converts each signal into analytical questions that go deeper than the surface data" },
            { title: "9-Agent Investigation", desc: "Business, Industry, Competition, Management, Capital Allocation, Accounting, Valuation, Governance, Risk agents run in parallel" },
            { title: "Thesis + Valuation", desc: "Bull/Bear/Base thesis, variant perception, DCF + relative valuation, scenario analysis, IC report" },
          ].map(({ title, desc }) => (
            <Card key={title}>
              <h3 className="mb-2 text-sm font-semibold">{title}</h3>
              <p className="text-xs leading-5 text-muted">{desc}</p>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
