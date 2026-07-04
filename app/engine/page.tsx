"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { downloadBlob } from "@/lib/download";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScorecardRow {
  symbol: string;
  date: string;
  name?: string;
  sector?: string;
  momentum_score: number;
  quality_score: number;
  value_score: number;
  low_vol_score: number;
  revision_score: number;
  regime_score: number;
  forecast_score: number;
  mc_upside: number;
  kelly_fraction: number;
  composite_score: number;
  signal: string;
  confidence: number;
}

interface RegimePoint {
  date: string;
  regime_label: string;
  prob_bull: number;
  prob_bear: number;
  prob_range: number;
  prob_crash: number;
  prob_recovery: number;
}

interface ForecastRow {
  horizon_days: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  prob_up: number;
}

interface McRow {
  intrinsic_p10: number;
  intrinsic_p25: number;
  intrinsic_p50: number;
  intrinsic_p75: number;
  intrinsic_p90: number;
  wacc: number;
  terminal_growth: number;
}

interface FundamentalsRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  forward_pe: number | null;
  ev_to_ebitda: number | null;
  revenue_growth_yoy: number | null;
  revenue_cagr_3y: number | null;
  eps_growth_yoy: number | null;
  eps_cagr_3y: number | null;
  roic: number | null;
  roe: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  debt_to_equity: number | null;
  net_debt_to_ebitda: number | null;
  current_ratio: number | null;
  fcf_margin: number | null;
  fcf_growth_yoy: number | null;
  dividend_yield: number | null;
  buyback_yield: number | null;
  institutional_ownership: number | null;
  earnings_surprise_pct: number | null;
  ebitda: number | null;
  free_cashflow: number | null;
}

interface OosMetrics {
  live_IC:          number | null;
  hit_rate:         number | null;
  strong_buy_alpha: number | null;
  sharpe_live:      number | null;
  n_obs:            number;
  ic_quality:       "HIGH" | "MEDIUM" | "LOW" | "DEGRADED" | "INSUFFICIENT";
  data_health:      {
    generated_at?: string;
    n_symbols_scored?: number;
    nse_status?: Record<string, string>;
    stale_fundamentals?: string[];
    live_oos?: Record<string, number | null>;
  } | null;
}

interface FeatureRow { feature: string; value: number; }
interface FactorPoint { date: string; momentum: number; quality: number; value: number; low_vol: number; revision: number; composite: number; }
interface PricePoint { date: string; close: number; volume: number; }

interface DetailData {
  symbol: string;
  scorecard: ScorecardRow | null;
  regime_history: RegimePoint[];
  forecasts: ForecastRow[];
  mc: McRow | null;
  fundamentals: FundamentalsRow | null;
  features: FeatureRow[];
  factor_history: FactorPoint[];
  prices: PricePoint[];
}

// ---------------------------------------------------------------------------
// IC Report types (mirrors lib/ic-report.ts ICReport shape)
// ---------------------------------------------------------------------------

interface ValuationApproach { method: string; priceTarget: string; impliedUpside: string; assumptions: string; confidence: string; }
interface ValuationScenario { label: string; priceTarget: string; impliedUpside: string; keyAssumptions: string[]; }
interface ICValuation {
  currentPrice: string; intrinsicValueRange: string; impliedUpside: string;
  approaches: ValuationApproach[]; scenarios: ValuationScenario[];
  dcfSensitivity: string; valuationVerdict: string;
}
interface ICSignal { id: string; category: string; severity: string; description: string; }
interface AgentFinding { agent: string; agentLabel: string; questionsAnswered: number; findings: string; confidence: string; }
interface Thesis { bull: string; bear: string; base: string; variantPerception?: string; marketExpectations?: string; keyCatalysts?: string[]; keyRisks?: string[]; keyDrivers?: string[]; }
interface RunHotCold {
  oneYearReturn: number;
  medianReturn: number;
  percentile: number;
  signal: "run_hot" | "run_cold" | "neutral";
}
interface ICReport {
  symbol: string; companyName: string; generatedAt: string; model: string;
  signals: ICSignal[]; agentFindings: AgentFinding[]; thesis: Thesis;
  valuation: ICValuation; monitorables: string[];
  runHotCold: RunHotCold | null;
}

type ICJobStatus = "queued" | "running" | "done" | "error";
interface ICJob { symbol: string; status: ICJobStatus; stage: string; report: ICReport | null; error: string | null; }

// ---------------------------------------------------------------------------
// Batch IC runner — bottom tray + full-screen report viewer
// ---------------------------------------------------------------------------

function SignalBadge({ severity, label }: { severity: string; label: string }) {
  const cls = severity === "high" ? "bg-red-500/10 border-red-500/30 text-negative"
    : severity === "medium" ? "bg-warning/10 border-warning/30 text-warning"
    : "bg-border/20 border-border text-muted";
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>{label}</span>;
}

function ICReportView({ report, currency }: { report: ICReport; currency: string }) {
  const [agentTab, setAgentTab] = useState(0);
  const v = report.valuation;

  return (
    <div className="flex flex-col gap-6 px-6 py-5 overflow-y-auto h-full text-sm">

      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold">{report.symbol}</span>
            <span className="text-muted">·</span>
            <span className="text-muted">{report.companyName}</span>
          </div>
          <span className="text-xs text-muted">
            Generated {new Date(report.generatedAt).toLocaleString()} · {report.model}
          </span>
        </div>
        {/* Valuation summary pill */}
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono text-xl font-semibold">{v.intrinsicValueRange}</span>
          <span className={`font-mono text-sm font-medium ${v.impliedUpside.startsWith("+") ? "text-positive" : "text-negative"}`}>
            {v.impliedUpside} vs {v.currentPrice}
          </span>
        </div>
      </div>

      {/* Red flag signals */}
      {report.signals.filter(s => s.severity !== "info").length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Red Flags</span>
          <div className="flex flex-col gap-1.5">
            {report.signals.filter(s => s.severity !== "info").map(s => (
              <div key={s.id} className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                <SignalBadge severity={s.severity} label={s.severity} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-xs font-medium">{s.category.replace(/_/g," ")}</span>
                  <span className="text-xs text-muted">{s.description}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thesis */}
      <div className="grid gap-3 md:grid-cols-3">
        {(["base","bull","bear"] as const).map((k) => {
          const text = report.thesis[k];
          const color = k === "bull" ? "border-positive/30 bg-positive/5" : k === "bear" ? "border-negative/30 bg-negative/5" : "border-border bg-surface-2";
          const label = k === "base" ? "Base case" : k === "bull" ? "Bull case" : "Bear case";
          return (
            <div key={k} className={`flex flex-col gap-1.5 rounded-lg border p-3 ${color}`}>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</span>
              <p className="text-xs leading-relaxed text-muted">{text}</p>
            </div>
          );
        })}
      </div>

      {/* Valuation approaches */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Valuation</span>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {v.approaches.map((a) => (
            <div key={a.method} className="flex flex-col gap-1 rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted">{a.method}</span>
                <span className={`text-[10px] font-semibold ${a.confidence === "high" ? "text-positive" : a.confidence === "low" ? "text-negative" : "text-warning"}`}>
                  {a.confidence}
                </span>
              </div>
              <span className="font-mono text-base font-semibold">{a.priceTarget}</span>
              <span className={`font-mono text-xs ${a.impliedUpside.startsWith("+") ? "text-positive" : "text-negative"}`}>{a.impliedUpside}</span>
              <p className="mt-1 text-[11px] leading-relaxed text-muted line-clamp-3">{a.assumptions}</p>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          <strong className="text-foreground">Verdict:</strong> {v.valuationVerdict}
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          <strong className="text-foreground">DCF Sensitivity:</strong> {v.dcfSensitivity}
        </div>
      </div>

      {/* Scenarios */}
      <div className="flex flex-col gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Scenarios</span>
        <div className="grid gap-2 sm:grid-cols-3">
          {v.scenarios.map((s) => {
            const bull = s.label.toLowerCase().includes("bull");
            const bear = s.label.toLowerCase().includes("bear");
            const color = bull ? "border-positive/30" : bear ? "border-negative/30" : "border-border";
            return (
              <div key={s.label} className={`flex flex-col gap-1.5 rounded-lg border bg-surface-2 p-3 ${color}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{s.label}</span>
                  <span className={`font-mono text-sm font-semibold ${s.impliedUpside.startsWith("+") ? "text-positive" : "text-negative"}`}>
                    {s.priceTarget} <span className="text-xs">({s.impliedUpside})</span>
                  </span>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {s.keyAssumptions.map((a, i) => (
                    <li key={i} className="text-[11px] text-muted before:mr-1.5 before:content-['·']">{a}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Run Hot / Cold */}
      {report.runHotCold && (
        <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs ${
          report.runHotCold.signal === "run_hot" ? "border-warning/30 bg-warning/5" :
          report.runHotCold.signal === "run_cold" ? "border-accent/30 bg-accent/5" :
          "border-border bg-surface-2"
        }`}>
          <span className={`font-semibold uppercase tracking-wide ${
            report.runHotCold.signal === "run_hot" ? "text-warning" :
            report.runHotCold.signal === "run_cold" ? "text-accent" : "text-muted"
          }`}>
            {report.runHotCold.signal.replace("_", " ")}
          </span>
          <span className="text-muted">
            1Y return {report.runHotCold.oneYearReturn.toFixed(1)}% vs own median {report.runHotCold.medianReturn.toFixed(1)}%
            · {report.runHotCold.percentile}th percentile of own history
          </span>
        </div>
      )}

      {/* Agent findings */}
      {report.agentFindings.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Agent Analysis</span>
          <div className="flex flex-wrap gap-1">
            {report.agentFindings.map((af, i) => (
              <button key={af.agent} onClick={() => setAgentTab(i)}
                className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${agentTab === i ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2"}`}>
                {af.agentLabel ?? af.agent}
              </button>
            ))}
          </div>
          {report.agentFindings[agentTab] && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs leading-relaxed text-muted whitespace-pre-wrap">
                {report.agentFindings[agentTab].findings}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Monitorables */}
      {report.monitorables.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Watch List</span>
          <ul className="grid gap-1 sm:grid-cols-2">
            {report.monitorables.map((m, i) => (
              <li key={i} className="flex items-start gap-2 rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-muted">
                <span className="mt-0.5 shrink-0 text-accent">→</span>{m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Stage → human-readable progress label
const STAGE_LABEL: Record<string, string> = {
  signals: "Detecting signals…", questions: "Generating questions…",
  agents: "Running analyst agents…", agent_complete: "Agents running…",
  thesis: "Forming thesis…", valuation: "Valuing…", done: "Complete",
};

function BatchICPanel({
  jobs, activeIdx, onSelectJob, onClose, onRemoveSymbol,
}: {
  jobs: ICJob[]; activeIdx: number;
  onSelectJob: (i: number) => void; onClose: () => void; onRemoveSymbol: (sym: string) => void;
}) {
  const activeJob = jobs[activeIdx] ?? null;
  const doneCount = jobs.filter(j => j.status === "done").length;
  const totalCount = jobs.length;

  return (
    /* Full-screen overlay with a slide-up animation */
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm animate-in slide-in-from-bottom duration-300">

      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <span className="text-sm font-semibold">IC Reports</span>
        <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted">
          {doneCount}/{totalCount}
        </span>
        {/* Progress bar */}
        <div className="flex-1 h-1 rounded-full bg-surface-2 mx-2">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: totalCount ? `${(doneCount / totalCount) * 100}%` : "0%" }}
          />
        </div>
        <button onClick={onClose}
          className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
          ✕ Close
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar — stock tabs */}
        <div className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface p-2">
          {jobs.map((job, i) => {
            const isActive = i === activeIdx;
            const statusDot = job.status === "done" ? "bg-positive"
              : job.status === "error" ? "bg-negative"
              : job.status === "running" ? "bg-accent animate-pulse"
              : "bg-border";
            return (
              <button key={job.symbol} onClick={() => onSelectJob(i)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                  isActive ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} />
                <span className="flex-1 font-mono font-medium truncate">{job.symbol}</span>
                {job.status !== "running" && (
                  <span onClick={(e) => { e.stopPropagation(); onRemoveSymbol(job.symbol); }}
                    className="shrink-0 text-[10px] opacity-0 group-hover:opacity-100 hover:text-negative cursor-pointer">×</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Main content — report or loading state */}
        <div className="flex flex-1 flex-col min-h-0 min-w-0">
          {activeJob === null && (
            <div className="flex flex-1 items-center justify-center text-sm text-muted">Select a stock</div>
          )}
          {activeJob?.status === "queued" && (
            <div className="flex flex-1 items-center justify-center flex-col gap-2 text-muted">
              <span className="text-2xl">⏳</span>
              <span className="text-sm">{activeJob.symbol} — queued</span>
            </div>
          )}
          {activeJob?.status === "running" && (
            <div className="flex flex-1 items-center justify-center flex-col gap-3 text-muted">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
              </span>
              <span className="text-sm">{activeJob.symbol}</span>
              <span className="text-xs">{STAGE_LABEL[activeJob.stage] ?? activeJob.stage}</span>
            </div>
          )}
          {activeJob?.status === "error" && (
            <div className="flex flex-1 items-center justify-center flex-col gap-2">
              <span className="text-sm text-negative">Failed: {activeJob.error}</span>
            </div>
          )}
          {activeJob?.status === "done" && activeJob.report && (
            <ICReportView report={activeJob.report} currency={
              activeJob.symbol.endsWith(".NS") || activeJob.symbol.endsWith(".BO") ? "₹" : "$"
            } />
          )}
        </div>
      </div>
    </div>
  );
}

// Bottom selection tray — shown while user is picking stocks
function SelectionTray({
  selected, onClear, onRemove, onRunBatch, running,
}: {
  selected: string[]; onClear: () => void; onRemove: (s: string) => void;
  onRunBatch: () => void; running: boolean;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 backdrop-blur-sm shadow-2xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-6 py-3">
        <span className="shrink-0 text-xs font-semibold text-muted uppercase tracking-wide">
          {selected.length} selected
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5 overflow-x-auto">
          {selected.map(sym => (
            <span key={sym}
              className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 font-mono text-xs text-accent">
              {sym}
              <button onClick={() => onRemove(sym)}
                className="ml-0.5 rounded-full text-accent/60 hover:text-accent leading-none">×</button>
            </span>
          ))}
        </div>
        <button onClick={onClear}
          className="shrink-0 text-xs text-muted hover:text-foreground transition-colors px-2">
          Clear all
        </button>
        <button onClick={onRunBatch} disabled={running || selected.length === 0}
          className="shrink-0 rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
          {running ? "Running…" : `Run IC Reports →`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNAL_COLOR: Record<string, string> = {
  STRONG_BUY:  "text-emerald-400",
  BUY:         "text-positive",
  HOLD:        "text-warning",
  SELL:        "text-negative",
  STRONG_SELL: "text-red-500",
};
const SIGNAL_BG: Record<string, string> = {
  STRONG_BUY:  "bg-emerald-400/10 border-emerald-400/30",
  BUY:         "bg-positive/10 border-positive/30",
  HOLD:        "bg-warning/10 border-warning/30",
  SELL:        "bg-negative/10 border-negative/30",
  STRONG_SELL: "bg-red-500/10 border-red-500/30",
};

const FACTOR_META: Record<string, { label: string; desc: string; formula: string }> = {
  momentum_score: {
    label: "Momentum",
    desc: "Jegadeesh-Titman 12-1 month. Skips most recent month to avoid reversal.",
    formula: "ret(252d) − ret(21d)  →  cross-sectional z-score",
  },
  quality_score: {
    label: "Quality",
    desc: "QMJ composite (Asness 2019). Profitability 40% · Safety 30% · Growth 20% · Payout 10%.",
    formula: "z(ROE, ROIC, margins, leverage, CAGR)  →  within-group avg  →  z-score",
  },
  value_score: {
    label: "Value",
    desc: "All metrics converted to yield space before averaging — avoids PE vs EV/EBITDA scale mismatch.",
    formula: "mean(1/PE, 1/EV_EBITDA, FCF_yield, div_yield)  →  z-score",
  },
  regime_score: {
    label: "Regime",
    desc: "HMM posterior probability-weighted expected return. E[R] = Σ P(regime_i) × μ_i.",
    formula: "Σ P(state) × annualised_μ(state)  /  max_μ  →  normalised to [−3, 3]",
  },
  low_vol_score: {
    label: "Low Vol",
    desc: "Low-volatility factor. Negative of 63-day realized annualised vol. Lower vol = higher raw score.",
    formula: "−σ(log_ret, 63d) × √252  →  cross-sectional z-score",
  },
  revision_score: {
    label: "Revision",
    desc: "Earnings revision momentum. Analyst beat rate and EPS growth YoY, normalised and averaged.",
    formula: "(beat_pct − 50) / 50  +  tanh(eps_growth / 50)  →  cross-sectional z-score",
  },
  forecast_score: {
    label: "Forecast",
    desc: "LightGBM quantile regression P(return > 0), calibrated via Gaussian IQR fit.",
    formula: "(prob_up − 0.5) × 2  →  [−1, 1]",
  },
};

const REGIME_COLORS: Record<string, string> = {
  Bull:     "#22c55e",
  Bear:     "#ef4444",
  Range:    "#f59e0b",
  Crash:    "#dc2626",
  Recovery: "#3b82f6",
};

const HORIZON_LABEL: Record<number, string> = {
  5: "1w", 10: "2w", 21: "1m", 63: "3m", 126: "6m",
};

// ---------------------------------------------------------------------------
// Micro components
// ---------------------------------------------------------------------------

function ZBar({ value, max = 3 }: { value: number; max?: number }) {
  const pct = ((Math.max(-max, Math.min(max, value)) + max) / (2 * max)) * 100;
  const color = value >= 0.5 ? "bg-positive" : value <= -0.5 ? "bg-negative" : "bg-warning";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative h-1.5 w-20 shrink-0 rounded-full bg-surface-2">
        <div className="absolute left-1/2 h-full w-px bg-border" />
        <div
          className={`absolute h-full rounded-full ${color}`}
          style={value >= 0
            ? { left: "50%", width: `${(pct - 50)}%` }
            : { left: `${pct}%`, width: `${50 - pct}%` }
          }
        />
      </div>
      <span className="font-mono text-xs tabular-nums">{value >= 0 ? "+" : ""}{value.toFixed(3)}</span>
    </div>
  );
}

function Pct({ v, digits = 1 }: { v: number | null; digits?: number }) {
  if (v == null || !isFinite(v)) return <span className="text-muted">—</span>;
  const color = v >= 0 ? "text-positive" : "text-negative";
  return <span className={`font-mono tabular-nums ${color}`}>{v >= 0 ? "+" : ""}{v.toFixed(digits)}%</span>;
}

function Num({ v, digits = 2, suffix = "" }: { v: number | null; digits?: number; suffix?: string }) {
  if (v == null || !isFinite(v)) return <span className="text-muted">—</span>;
  return <span className="font-mono tabular-nums">{v.toFixed(digits)}{suffix}</span>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// Tiny sparkline via SVG
function Sparkline({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80; const h = 24;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

// Probability fan chart for forecast distribution
function FanChart({ row }: { row: ForecastRow }) {
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
  const probPct = Math.round(row.prob_up * 100);
  const barColor = row.prob_up > 0.55 ? "bg-positive" : row.prob_up < 0.45 ? "bg-negative" : "bg-warning";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-semibold text-foreground">{HORIZON_LABEL[row.horizon_days] ?? `${row.horizon_days}d`}</span>
        <span className={`font-mono text-xs ${row.prob_up > 0.5 ? "text-positive" : "text-negative"}`}>
          P↑ {probPct}%
        </span>
      </div>
      {/* prob_up bar */}
      <div className="h-1 w-full rounded-full bg-surface">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${probPct}%` }} />
      </div>
      {/* quantile table */}
      <div className="grid grid-cols-5 gap-0.5 text-center text-xs">
        {(["p10","p25","p50","p75","p90"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-0.5">
            <span className="text-muted">{k}</span>
            <span className={`font-mono tabular-nums ${(row[k] ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
              {fmt(row[k] ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Regime posterior bar
function RegimeBar({ label, prob }: { label: string; prob: number }) {
  const color = REGIME_COLORS[label] ?? "#888";
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted">{label}</span>
      <div className="relative h-3 flex-1 rounded-sm bg-surface-2 overflow-hidden">
        <div className="h-full rounded-sm transition-all" style={{ width: `${prob * 100}%`, backgroundColor: color, opacity: 0.8 }} />
      </div>
      <span className="w-12 text-right font-mono text-xs tabular-nums">{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel — full mathematical working for one symbol
// ---------------------------------------------------------------------------

function DetailPanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featTab, setFeatTab] = useState<"all" | "vol" | "momentum" | "stat">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engine/detail?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setData(json as DetailData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Load on mount
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const sc = data?.scorecard;
  const fund = data?.fundamentals;
  const mc = data?.mc;
  const latestRegime = data?.regime_history?.[0];
  const factorSeries = [...(data?.factor_history ?? [])].reverse();

  const filteredFeatures = data?.features.filter((f) => {
    if (featTab === "vol")      return f.feature.includes("vol") || f.feature.includes("atr");
    if (featTab === "momentum") return f.feature.includes("return") || f.feature.includes("momentum") || f.feature.includes("rsi");
    if (featTab === "stat")     return f.feature.includes("vr_") || f.feature.includes("ou_") || f.feature.includes("hurst") || f.feature.includes("reg_");
    return true;
  }) ?? [];

  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/stocks/${symbol}`} className="font-mono font-semibold text-accent hover:underline">
            {symbol}
          </Link>
          {fund?.name && <span className="text-sm text-muted">{fund.name}</span>}
          {fund?.sector && <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{fund.sector}</span>}
          {sc && (
            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${SIGNAL_BG[sc.signal] ?? ""} ${SIGNAL_COLOR[sc.signal] ?? ""}`}>
              {sc.signal.replace("_", " ")}
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">✕</button>
      </div>

      {loading && (
        <div className="px-5 py-8 text-center text-sm text-muted">Loading mathematical detail…</div>
      )}
      {error && (
        <div className="px-5 py-4 text-sm text-negative">{error}</div>
      )}

      {data && !loading && (
        <div className="grid gap-6 p-5 md:grid-cols-2">

          {/* ── Col 1 ── */}
          <div className="flex flex-col gap-6">

            {/* Factor z-scores */}
            <div className="flex flex-col gap-3">
              <SectionHeader>Factor z-scores (cross-sectional)</SectionHeader>
              {sc && Object.entries(FACTOR_META).map(([key, meta]) => {
                const val = sc[key as keyof ScorecardRow] as number;
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <ZBar value={val} />
                    </div>
                    <p className="text-xs text-muted">{meta.desc}</p>
                    <code className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{meta.formula}</code>
                  </div>
                );
              })}
              {sc && (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Composite</span>
                    <span className="text-xs text-muted">IC-weighted Σ wᵢ · zᵢ + 0.10 · regime + 0.05 · MC_upside</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ZBar value={sc.composite_score} />
                    <span className="font-mono text-xs text-muted">conf {(sc.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Factor history sparklines */}
            {factorSeries.length > 0 && (
              <div className="flex flex-col gap-2">
                <SectionHeader>Factor history (90d sparklines)</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                  {(["momentum","quality","value","low_vol","revision","composite"] as const).map((k) => {
                    const vals = factorSeries.map((r) => r[k] ?? 0);
                    const last = vals[vals.length - 1];
                    const color = last >= 0 ? "#22c55e" : "#ef4444";
                    return (
                      <div key={k} className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs capitalize text-muted">{k.replace("_"," ")}</span>
                          <span className={`font-mono text-xs ${last >= 0 ? "text-positive" : "text-negative"}`}>
                            {last >= 0 ? "+" : ""}{last.toFixed(3)}
                          </span>
                        </div>
                        <Sparkline data={vals} color={color} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regime */}
            {(data.regime_history.length > 0) && (
              <div className="flex flex-col gap-3">
                <SectionHeader>HMM Regime Posteriors</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  5-state Gaussian HMM trained on [log_return, realised_vol_5d, log_vol_ratio]. Baum-Welch EM.
                  State labels assigned by sorting mean return across states.
                </div>
                {latestRegime && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Current:</span>
                      <span
                        className="rounded px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: (REGIME_COLORS[latestRegime.regime_label] ?? "#888") + "22", color: REGIME_COLORS[latestRegime.regime_label] ?? "#888" }}
                      >
                        {latestRegime.regime_label}
                      </span>
                      <span className="text-xs text-muted">{latestRegime.date?.slice(0, 10)}</span>
                    </div>
                    {(["Bull","Bear","Range","Crash","Recovery"] as const).map((label) => {
                      const key = `prob_${label.toLowerCase()}` as keyof RegimePoint;
                      const prob = (latestRegime[key] as number) ?? 0;
                      return <RegimeBar key={label} label={label} prob={prob} />;
                    })}
                    <div className="mt-1 rounded bg-surface-2 px-2 py-1 text-xs text-muted">
                      Regime score = Σ P(state) × μ(state) / max_μ &nbsp;·&nbsp;
                      μ: Bull +18% / Bear −12% / Range +4% / Crash −35% / Recovery +22% (annualised)
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Col 2 ── */}
          <div className="flex flex-col gap-6">

            {/* Forecast distributions */}
            {data.forecasts.length > 0 && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Probabilistic Forecasts (Quantile Regression)</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  LightGBM quantile regression (α ∈ {"{0.10,0.25,0.50,0.75,0.90}"}). Walk-forward train/test split.
                  P↑ derived from Gaussian IQR fit: σ ≈ IQR/1.349, P(X&gt;0) = Φ(p50/σ).
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {data.forecasts.map((fc) => <FanChart key={fc.horizon_days} row={fc} />)}
                </div>
              </div>
            )}

            {/* MC Valuation */}
            {mc && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Monte Carlo DCF Valuation</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  50,000 paths. OU revenue growth (θ=0.30, σ=0.08, μ_lr=5%). FCF margin noise σ=0.05.
                  Year-level GBM shock exp(0.12ε − 0.0072). Terminal: Gordon Growth Model. WACC = CAPM.
                </div>
                <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-surface p-3">
                  {(["intrinsic_p10","intrinsic_p25","intrinsic_p50","intrinsic_p75","intrinsic_p90"] as const).map((k, i) => {
                    const labels = ["P10","P25","P50","P75","P90"];
                    const v = mc[k];
                    return (
                      <div key={k} className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted">{labels[i]}</span>
                        <span className={`font-mono text-sm font-semibold ${i === 2 ? "text-foreground" : "text-muted"}`}>
                          ${v != null ? v.toFixed(0) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                    <span className="text-muted">WACC</span>
                    <span className="font-mono">{(mc.wacc * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                    <span className="text-muted">Terminal g</span>
                    <span className="font-mono">{(mc.terminal_growth * 100).toFixed(2)}%</span>
                  </div>
                  {sc && (
                    <div className="col-span-2 flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                      <span className="text-muted">Upside to P50</span>
                      <Pct v={sc.mc_upside * 100} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Kelly sizing */}
            {sc && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Kelly Position Sizing</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  Fractional Kelly (0.25×): f = 0.25 × (p·b − q) / b, capped at 15%.
                  b = |p50 return| / |p50 return × 0.5|. p = prob_up from 21d forecast.
                </div>
                <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-col">
                    <span className="text-2xl font-semibold font-mono">{(sc.kelly_fraction * 100).toFixed(1)}%</span>
                    <span className="text-xs text-muted">suggested position size</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">0%</span><span className="text-muted">15% max</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${sc.kelly_fraction > 0.08 ? "bg-positive" : sc.kelly_fraction > 0.03 ? "bg-warning" : "bg-muted"}`}
                        style={{ width: `${(sc.kelly_fraction / 0.15) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fundamentals */}
            {fund && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Fundamentals (Factor Inputs)</SectionHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {([
                    ["Forward PE",    fund.forward_pe,            "x"],
                    ["EV/EBITDA",     fund.ev_to_ebitda,          "x"],
                    ["Rev Growth",    fund.revenue_growth_yoy,    "%"],
                    ["Rev CAGR 3y",   fund.revenue_cagr_3y,       "%"],
                    ["EPS Growth",    fund.eps_growth_yoy,        "%"],
                    ["EPS CAGR 3y",   fund.eps_cagr_3y,           "%"],
                    ["ROIC",          fund.roic,                  "%"],
                    ["ROE",           fund.roe,                   "%"],
                    ["Gross Margin",  fund.gross_margin,          "%"],
                    ["Op. Margin",    fund.operating_margin,      "%"],
                    ["FCF Margin",    fund.fcf_margin,            "%"],
                    ["D/E",           fund.debt_to_equity,        "x"],
                    ["Net Debt/EBITDA", fund.net_debt_to_ebitda,  "x"],
                    ["Current Ratio", fund.current_ratio,         "x"],
                    ["Div Yield",     fund.dividend_yield,        "%"],
                    ["Buyback Yield", fund.buyback_yield,         "%"],
                    ["Inst. Ownership", fund.institutional_ownership, "%"],
                    ["EPS Surprise",  fund.earnings_surprise_pct, "%"],
                  ] as [string, number | null, string][]).map(([label, v, suffix]) => (
                    <div key={label} className="flex items-center justify-between border-b border-border/40 py-1">
                      <span className="text-muted">{label}</span>
                      {v != null && isFinite(v)
                        ? <span className="font-mono tabular-nums">{v.toFixed(2)}{suffix}</span>
                        : <span className="text-muted">—</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Full-width: Feature values ── */}
          <div className="col-span-full flex flex-col gap-3">
            <SectionHeader>Latest Feature Values (from price history)</SectionHeader>
            <div className="flex gap-1">
              {(["all","momentum","vol","stat"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFeatTab(t)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${featTab === t ? "bg-accent/20 text-accent" : "text-muted hover:bg-surface-2"}`}
                >
                  {t === "all" ? "All" : t === "momentum" ? "Momentum/Returns" : t === "vol" ? "Volatility" : "Statistical"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3 lg:grid-cols-4">
              {filteredFeatures.map((f) => (
                <div key={f.feature} className="flex items-center justify-between border-b border-border/30 py-1">
                  <span className="truncate font-mono text-xs text-muted">{f.feature}</span>
                  <span className={`font-mono tabular-nums ${f.value >= 0 ? "text-foreground" : "text-negative"}`}>
                    {f.value.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main scorecard page
// ---------------------------------------------------------------------------

export default function EnginePage() {
  const [scorecard, setScorecard]     = useState<ScorecardRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [exportErr, setExportErr]     = useState<string | null>(null);
  const [runLog, setRunLog]           = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [sortCol, setSortCol]         = useState<keyof ScorecardRow>("composite_score");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [selectedUniverse, setSelectedUniverse] = useState("nifty50");
  const [oosMetrics, setOosMetrics]   = useState<OosMetrics | null>(null);

  // Batch IC report state
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [icJobs, setIcJobs]         = useState<ICJob[]>([]);
  const [icPanelOpen, setIcPanelOpen] = useState(false);
  const [icActiveIdx, setIcActiveIdx] = useState(0);
  const [icBatchRunning, setIcBatchRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Always-current snapshot of filter/sort state for save-on-unmount
  const _s = useRef({ symbolFilter, signalFilter, sortCol, sortDir, selectedUniverse });
  _s.current = { symbolFilter, signalFilter, sortCol, sortDir, selectedUniverse };

  async function loadOosMetrics() {
    try {
      const res = await fetch("/api/engine/oos-metrics");
      if (res.ok) setOosMetrics(await res.json() as OosMetrics);
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    document.title = "Quant Engine · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  useEffect(() => { void loadOosMetrics(); }, []);

  // Restore filter/sort preferences from session on mount; save on unmount
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("uaa_engine_state");
      if (raw) {
        const st = JSON.parse(raw) as { symbolFilter?: string; signalFilter?: string; sortCol?: keyof ScorecardRow; sortDir?: "asc" | "desc"; selectedUniverse?: string };
        /* eslint-disable react-hooks/set-state-in-effect */
        if (st.symbolFilter !== undefined) setSymbolFilter(st.symbolFilter);
        if (st.signalFilter !== undefined) setSignalFilter(st.signalFilter);
        if (st.sortCol) setSortCol(st.sortCol);
        if (st.sortDir) setSortDir(st.sortDir);
        if (st.selectedUniverse) setSelectedUniverse(st.selectedUniverse);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch { /* ignore corrupt storage */ }
    return () => {
      try { sessionStorage.setItem("uaa_engine_state", JSON.stringify(_s.current)); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadScorecard() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/engine");
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setScorecard((json as { scorecard: ScorecardRow[] }).scorecard);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  async function runEngine(noForecast: boolean) {
    setRunning(true); setRunLog(""); setError(null);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe: selectedUniverse, noFetch: false, noForecast }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? "Engine failed");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let failed = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter(Boolean);
          for (const line of lines) {
            if (line.startsWith("ERROR:")) {
              failed = true;
              setError(line.replace("ERROR: ", ""));
            } else if (line === "DONE") {
              done = true;
            } else {
              setRunLog((prev) => (prev ?? "") + line + "\n");
            }
          }
        }
      }
      if (!failed) { await loadScorecard(); await loadOosMetrics(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Engine failed"); }
    finally { setRunning(false); }
  }

  function toggleSymbol(sym: string) {
    setSelectedSymbols(prev =>
      prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]
    );
  }

  function clearSelection() { setSelectedSymbols([]); }

  async function runBatchIC() {
    if (selectedSymbols.length === 0) return;
    // Initialise jobs as queued
    const jobs: ICJob[] = selectedSymbols.map(sym => ({
      symbol: sym, status: "queued", stage: "", report: null, error: null,
    }));
    setIcJobs(jobs);
    setIcPanelOpen(true);
    setIcActiveIdx(0);
    setIcBatchRunning(true);
    abortRef.current = new AbortController();

    // Run sequentially — IC report is LLM-heavy, parallel would hit rate limits
    for (let i = 0; i < jobs.length; i++) {
      if (abortRef.current.signal.aborted) break;
      const sym = jobs[i].symbol;

      // Mark as running and auto-select this tab
      setIcJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "running", stage: "signals" } : j));
      setIcActiveIdx(i);

      try {
        const res = await fetch("/api/ic-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: sym }),
          signal: abortRef.current.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let report: ICReport | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const ev = JSON.parse(line.slice(5).trim()) as { stage: string; report?: ICReport; message?: string };
              if (ev.stage === "done" && ev.report) {
                report = ev.report;
              }
              // Update stage label in real time
              setIcJobs(prev => prev.map((j, idx) =>
                idx === i ? { ...j, stage: ev.stage } : j
              ));
            } catch { /* malformed SSE line */ }
          }
        }

        setIcJobs(prev => prev.map((j, idx) =>
          idx === i ? { ...j, status: report ? "done" : "error", report, error: report ? null : "No report received", stage: "done" } : j
        ));
      } catch (e) {
        if ((e as Error).name === "AbortError") break;
        setIcJobs(prev => prev.map((j, idx) =>
          idx === i ? { ...j, status: "error", error: e instanceof Error ? e.message : "Failed", stage: "error" } : j
        ));
      }
    }
    setIcBatchRunning(false);
  }

  function toggleSort(col: keyof ScorecardRow) {
    if (sortCol === col) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const filtered = scorecard
    .filter((r) => {
      if (signalFilter !== "ALL" && r.signal !== signalFilter) return false;
      if (symbolFilter && !r.symbol.includes(symbolFilter.toUpperCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const av = typeof a[sortCol] === "number" ? (a[sortCol] as number) : 0;
      const bv = typeof b[sortCol] === "number" ? (b[sortCol] as number) : 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  const COLS: [keyof ScorecardRow, string][] = [
    ["composite_score", "Composite"],
    ["momentum_score",  "Momentum z"],
    ["quality_score",   "Quality z"],
    ["value_score",     "Value z"],
    ["low_vol_score",   "Low Vol z"],
    ["revision_score",  "Revision z"],
    ["regime_score",    "Regime"],
    ["forecast_score",  "Forecast"],
    ["mc_upside",       "MC Upside"],
    ["kelly_fraction",  "Kelly"],
  ];

  const signals = ["ALL","STRONG_BUY","BUY","HOLD","SELL","STRONG_SELL"];

  const signalDist = scorecard.reduce<Record<string, number>>((acc, r) => {
    acc[r.signal] = (acc[r.signal] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10 pb-24">

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Quant Engine</h1>
            <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-purple-400">
              Systematic
            </span>
          </div>
          <p className="text-sm text-muted">
            10-factor quantitative scorecard — momentum, quality, value, regime, forecasts, MC valuation.
            Click any row for full mathematical working. Select rows to run batch IC reports.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedUniverse}
            onChange={(e) => setSelectedUniverse(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <optgroup label="India">
              <option value="nifty50">Nifty 50</option>
              <option value="india_largecap">India Large-Cap (~100)</option>
              <option value="india_midcap">India Mid-Cap (~100)</option>
              <option value="india_smallcap">India Small-Cap (~100)</option>
              <option value="full_india">India Large + Mid (~200)</option>
              <option value="india_best">India Best Recommendations (~200) ★</option>
            </optgroup>
            <optgroup label="US">
              <option value="us_largecap">US Large-Cap (~100)</option>
              <option value="us_midcap">US Mid-Cap (~100)</option>
              <option value="us_smallcap">US Small-Cap (~100)</option>
              <option value="us_growth">US Growth Tech (~80)</option>
              <option value="full_us">US Full (~250)</option>
            </optgroup>
            <optgroup label="Funds">
              <option value="etf">ETFs (~50)</option>
              <option value="mf">Mutual Funds (~30)</option>
            </optgroup>
            <optgroup label="Global">
              <option value="global">Global US + India (~220)</option>
            </optgroup>
          </select>
          <button onClick={loadScorecard} disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loading ? "Loading…" : "Load Scorecard"}
          </button>
          <button onClick={() => void runEngine(true)} disabled={running}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
            {running ? "Running…" : "Run Engine (fast)"}
          </button>
          <button onClick={() => void runEngine(false)} disabled={running}
            className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
            {running ? "Running…" : "Full Run + Forecasts"}
          </button>
          {scorecard.length > 0 && (
            <button
              onClick={() => {
                setExportErr(null);
                void downloadBlob("/api/export/engine", `quant-engine-${new Date().toISOString().slice(0, 10)}.xlsx`, "POST", { rows: scorecard })
                  .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              ↓ Export Excel
            </button>
          )}
          {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
        </div>
      </div>

      {/* OOS Metrics Panel */}
      {oosMetrics && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted">Live OOS Validation</span>
            {/* IC Quality traffic light */}
            {(() => {
              const q = oosMetrics.ic_quality;
              const dot = q === "HIGH" ? "bg-emerald-400" : q === "MEDIUM" ? "bg-warning" : q === "INSUFFICIENT" ? "bg-border" : "bg-red-500";
              const label = q === "HIGH" ? "Signal Reliable" : q === "MEDIUM" ? "Signal Caution" : q === "LOW" ? "Signal Weak" : q === "DEGRADED" ? "Signal Degraded" : "Insufficient Data";
              return (
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className="text-xs font-medium">{label}</span>
                </div>
              );
            })()}
            {oosMetrics.ic_quality === "DEGRADED" && (
              <span className="rounded bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-xs text-negative font-medium">
                ⚠ IC below floor — review model
              </span>
            )}
            <button onClick={() => void loadOosMetrics()} className="ml-auto text-xs text-muted hover:text-foreground">↻ refresh</button>
          </div>
          <div className="grid grid-cols-2 gap-0 divide-x divide-border sm:grid-cols-4">
            {([
              { label: "Live IC", value: oosMetrics.live_IC, fmt: (v: number) => v.toFixed(4), color: (v: number) => v >= 0.06 ? "text-positive" : v >= 0.02 ? "text-warning" : "text-negative" },
              { label: "Hit Rate", value: oosMetrics.hit_rate, fmt: (v: number) => `${(v * 100).toFixed(1)}%`, color: (v: number) => v >= 0.55 ? "text-positive" : v >= 0.50 ? "text-warning" : "text-negative" },
              { label: "SB Alpha", value: oosMetrics.strong_buy_alpha, fmt: (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`, color: (v: number) => v >= 0 ? "text-positive" : "text-negative" },
              { label: "Sharpe Live", value: oosMetrics.sharpe_live, fmt: (v: number) => v.toFixed(3), color: (v: number) => v >= 0.5 ? "text-positive" : v >= 0.3 ? "text-warning" : "text-negative" },
            ] as const).map(({ label, value, fmt, color }) => (
              <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
                <span className="text-xs text-muted">{label}</span>
                {value !== null && isFinite(value)
                  ? <span className={`font-mono text-sm font-semibold tabular-nums ${(color as (v: number) => string)(value)}`}>{(fmt as (v: number) => string)(value)}</span>
                  : <span className="font-mono text-sm text-muted">—</span>
                }
              </div>
            ))}
          </div>
          {oosMetrics.n_obs > 0 && (
            <div className="border-t border-border px-4 py-2 text-xs text-muted">
              {oosMetrics.n_obs} observations (84d rolling)
              {oosMetrics.data_health?.stale_fundamentals && oosMetrics.data_health.stale_fundamentals.length > 0 && (
                <span className="ml-3 text-warning">
                  {oosMetrics.data_health.stale_fundamentals.length} stale fundamentals
                </span>
              )}
              {oosMetrics.data_health?.generated_at && (
                <span className="ml-3">· health: {new Date(oosMetrics.data_health.generated_at).toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
      )}
      {(running || runLog) && (
        <div className="flex flex-col gap-0 rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            {running && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
            )}
            <span className="text-sm font-medium">
              {running ? `Running [${selectedUniverse}]…` : `Completed [${selectedUniverse}]`}
            </span>
            {runLog && (
              <span className="ml-auto text-xs text-muted">
                {runLog.split("\n").filter(Boolean).length} steps
              </span>
            )}
          </div>
          {runLog && (
            <div
              className="max-h-64 overflow-y-auto p-3 text-xs flex flex-col gap-0.5"
              ref={(el) => { if (el) el.scrollTop = el.scrollHeight; }}
            >
              {runLog.split("\n").filter(Boolean).map((line, i) => {
                const isErr = /error|fail|exception/i.test(line);
                const isOk  = /done|success|complete|saved|✓/i.test(line);
                const isWarn = /warn|skip|stale/i.test(line);
                const icon  = isErr ? "✗" : isOk ? "✓" : isWarn ? "⚠" : "·";
                const cls   = isErr ? "text-negative" : isOk ? "text-positive" : isWarn ? "text-warning" : "text-muted";
                return (
                  <div key={i} className={`flex gap-2 font-mono leading-5 ${cls}`}>
                    <span className="shrink-0 select-none">{icon}</span>
                    <span className="break-all">{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Scorecard summary strip */}
      {scorecard.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{scorecard.length} stocks scored</span>
              {scorecard[0]?.date && (
                <span className="text-xs text-muted">
                  · {new Date(scorecard[0].date).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </span>
              )}
            </div>
            {scorecard[0]?.date && (() => {
              const ageMs = Date.now() - new Date(scorecard[0].date).getTime();
              const ageH = ageMs / 3_600_000;
              if (ageH > 24) return <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-0.5 text-xs text-warning">Stale — {Math.floor(ageH / 24)}d old</span>;
              return <span className="rounded-full border border-positive/30 bg-positive/10 px-2.5 py-0.5 text-xs text-positive">Fresh</span>;
            })()}
          </div>
          {/* Signal distribution */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Signal distribution</span>
            {(["STRONG_BUY","BUY","HOLD","SELL","STRONG_SELL"] as const).map((sig) => {
              const count = signalDist[sig] ?? 0;
              if (!count) return null;
              return (
                <button
                  key={sig}
                  onClick={() => setSignalFilter(signalFilter === sig ? "ALL" : sig)}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    signalFilter === sig ? `${SIGNAL_BG[sig] ?? ""} ${SIGNAL_COLOR[sig] ?? ""}` : "border-border text-muted hover:bg-surface-2"
                  }`}
                >
                  <span className={signalFilter !== sig ? "text-muted" : SIGNAL_COLOR[sig]}>{sig.replace("_", " ")}</span>
                  <span className="font-mono">{count}</span>
                </button>
              );
            })}
            {signalFilter !== "ALL" && (
              <button onClick={() => setSignalFilter("ALL")} className="text-xs text-accent hover:underline">
                Show all
              </button>
            )}
          </div>
        </div>
      )}

      {scorecard.length > 0 ? (
        <div className="flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input type="text" placeholder="Filter symbol…" value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex flex-wrap gap-1">
              {signals.map((s) => (
                <button key={s} onClick={() => setSignalFilter(s)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    signalFilter === s
                      ? s === "ALL" ? "border-accent bg-accent/10 text-accent" : `${SIGNAL_BG[s] ?? ""} ${SIGNAL_COLOR[s] ?? ""}`
                      : "border-border text-muted hover:bg-surface-2"
                  }`}>
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-muted">{filtered.length} symbols</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3 w-8">
                    <input type="checkbox" className="cursor-pointer accent-accent"
                      checked={filtered.length > 0 && filtered.every(r => selectedSymbols.includes(r.symbol))}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedSymbols(prev => [...new Set([...prev, ...filtered.map(r => r.symbol)])]);
                        else setSelectedSymbols(prev => prev.filter(s => !filtered.map(r => r.symbol).includes(s)));
                      }}
                      title="Select/deselect all visible"
                    />
                  </th>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  {COLS.map(([col, label]) => (
                    <th key={col} onClick={() => toggleSort(col)}
                      className="cursor-pointer px-4 py-3 text-right font-medium hover:text-foreground">
                      {label}{sortCol === col ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Signal</th>
                  <th className="px-4 py-3 text-right font-medium">Conf</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.symbol}
                    className={`cursor-pointer bg-surface transition-colors hover:bg-surface-2 ${expanded === row.symbol ? "bg-surface-2" : ""} ${selectedSymbols.includes(row.symbol) ? "bg-accent/5" : ""}`}
                    onClick={() => setExpanded(expanded === row.symbol ? null : row.symbol)}
                  >
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" className="cursor-pointer accent-accent"
                          checked={selectedSymbols.includes(row.symbol)}
                          onChange={() => toggleSymbol(row.symbol)}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <Link href={`/stocks/${row.symbol}`} className="font-mono font-semibold text-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}>
                            {row.symbol}
                          </Link>
                          {row.name && <span className="text-xs text-muted truncate max-w-[140px]">{row.name}</span>}
                        </div>
                      </td>
                      {/* Composite with bar */}
                      <td className="px-4 py-3">
                        <ZBar value={row.composite_score} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.momentum_score >= 0 ? "+" : ""}{row.momentum_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.quality_score >= 0 ? "+" : ""}{row.quality_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.value_score >= 0 ? "+" : ""}{row.value_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{(row.low_vol_score ?? 0) >= 0 ? "+" : ""}{(row.low_vol_score ?? 0).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{(row.revision_score ?? 0) >= 0 ? "+" : ""}{(row.revision_score ?? 0).toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.regime_score >= 0 ? "+" : ""}{row.regime_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.forecast_score >= 0 ? "+" : ""}{row.forecast_score.toFixed(3)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${row.mc_upside >= 0 ? "text-positive" : "text-negative"}`}>
                        {row.mc_upside >= 0 ? "+" : ""}{(row.mc_upside * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{(row.kelly_fraction * 100).toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${SIGNAL_COLOR[row.signal] ?? "text-muted"}`}>
                          {row.signal.replace("_"," ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted">
                        {(row.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {expanded === row.symbol ? "▲ hide" : "▼ show"}
                      </td>
                  </tr>
                ))}
                {expanded && (
                  <tr key={`${expanded}-detail`}>
                    <td colSpan={COLS.length + 5} className="p-2">
                      <DetailPanel symbol={expanded} onClose={() => setExpanded(null)} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && !running ? (
        <div className="flex flex-col gap-6">
          {/* Empty state CTA */}
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <circle cx="10" cy="10" r="2.5" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">No scorecard for this universe</p>
              <p className="max-w-sm text-xs leading-5 text-muted">
                Select a universe and run the engine to score stocks.
                Fast run takes ~2–5 min. Full run with forecasts takes ~10–20 min.
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => void runEngine(true)} disabled={running}
                className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
                Run Engine (fast)
              </button>
              <button onClick={() => void runEngine(false)} disabled={running}
                className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
                Full Run + Forecasts
              </button>
            </div>
          </div>

          {/* Pipeline explanation */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { step: "1", title: "Data fetch", desc: "Price history + fundamentals per symbol" },
              { step: "2", title: "Factor scores", desc: "Momentum, quality, value, low-vol, revision z-scores" },
              { step: "3", title: "HMM regime", desc: "5-state regime detection (Bull/Bear/Range/Crash/Recovery)" },
              { step: "4", title: "MC valuation", desc: "50,000-path Monte Carlo DCF per symbol" },
              { step: "5", title: "Composite", desc: "IC-weighted signal + Kelly fraction" },
            ].map((s) => (
              <div key={s.step} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[10px] font-semibold text-muted">
                    {s.step}
                  </span>
                  <span className="text-xs font-semibold text-foreground">{s.title}</span>
                </div>
                <p className="text-xs leading-4 text-muted">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Bottom tray — visible while selecting */}
      <SelectionTray
        selected={selectedSymbols}
        onClear={clearSelection}
        onRemove={toggleSymbol}
        onRunBatch={() => void runBatchIC()}
        running={icBatchRunning}
      />

      {/* Full-screen IC report panel */}
      {icPanelOpen && (
        <BatchICPanel
          jobs={icJobs}
          activeIdx={icActiveIdx}
          onSelectJob={setIcActiveIdx}
          onRemoveSymbol={(sym) => {
            setIcJobs(prev => prev.filter(j => j.symbol !== sym));
            setSelectedSymbols(prev => prev.filter(s => s !== sym));
          }}
          onClose={() => {
            setIcPanelOpen(false);
            abortRef.current?.abort();
          }}
        />
      )}
    </div>
  );
}
