"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio-context";
import type { PortfolioReport } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";
import { RiskMetrics, ScenarioAnalysis, CorrelationHeatmap, FactorExposureChart } from "./risk-panel";
import { GapAnalysisPanel } from "./gap-analysis";
import { NewPositionsPanel } from "./new-positions-panel";

/* ─────────────── Question section wrapper ─────────────── */

function IntelSection({
  question,
  answer,
  importance,
  defaultOpen = false,
  children,
}: {
  question: string;
  answer: string;
  importance: "high" | "medium" | "low";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor = importance === "high" ? "bg-negative" : importance === "medium" ? "bg-warning" : "bg-positive";

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface-2 transition-colors"
      >
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{question}</p>
          <p className="text-xs text-foreground/70 mt-0.5">{answer}</p>
        </div>
        <span className={`text-muted transition-transform shrink-0 ${open ? "rotate-180" : ""}`}>▾</span>
      </button>
      {open && (
        <div className="border-t border-border px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Risk summary card ─────────────── */

function RiskSummaryCard({ report }: { report: PortfolioReport }) {
  const r = report.risk;
  const beta = r.beta ?? 0;
  const vol  = r.annualizedVolatility ?? 0;

  const betaColor = beta > 1.3 ? "text-negative" : beta > 1.0 ? "text-warning" : "text-positive";
  const volColor  = vol > 30 ? "text-negative" : vol > 20 ? "text-warning" : "text-positive";

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Market Beta</p>
        <p className={`font-mono text-2xl font-bold ${betaColor}`}>{r.beta?.toFixed(2) ?? "—"}</p>
        <p className="text-[11px] text-muted mt-0.5">
          {beta > 1 ? `${((beta - 1) * 100).toFixed(0)}% more volatile than market` : "Less volatile than market"}
        </p>
        {beta > 1 && (
          <p className="text-[10px] text-muted mt-1">
            Top contributors: {report.positions
              .sort((a, b) => (b.weight - a.weight))
              .slice(0, 2)
              .map((p) => p.symbol)
              .join(", ")}
          </p>
        )}
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Annualized Volatility</p>
        <p className={`font-mono text-2xl font-bold ${volColor}`}>{r.annualizedVolatility?.toFixed(1) ?? "—"}%</p>
        <p className="text-[11px] text-muted mt-0.5">SPY typically ~15% annually</p>
      </div>
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Max Drawdown (90d)</p>
        <p className={`font-mono text-2xl font-bold ${(r.maxDrawdown ?? 0) < -20 ? "text-negative" : "text-warning"}`}>
          {r.maxDrawdown?.toFixed(1) ?? "—"}%
        </p>
        <p className="text-[11px] text-muted mt-0.5">Peak-to-trough over 90 days</p>
        {r.var95Dollar != null && (
          <p className="text-[10px] text-muted mt-1">Daily VaR (95%): ~{formatCurrency(Math.abs(r.var95Dollar))}</p>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Concentration summary ─────────────── */

function ConcentrationSummary({ report }: { report: PortfolioReport }) {
  const r = report.risk;
  const level = r.concentrationRisk;
  const color = level === "high" ? "text-negative" : level === "medium" ? "text-warning" : "text-positive";
  const topPositions = [...report.positions]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className={`font-mono text-3xl font-bold ${color}`}>{r.hhi.toLocaleString()}</span>
        <div>
          <p className="text-xs font-semibold">HHI Concentration Index</p>
          <p className="text-[11px] text-muted">{level === "low" ? "< 1,500 = well diversified" : level === "medium" ? "1,500–2,500 = moderate concentration" : "> 2,500 = highly concentrated"}</p>
        </div>
        <span className={`ml-auto rounded-full border px-3 py-1 text-xs font-bold capitalize ${
          level === "high" ? "border-negative/30 bg-negative/10 text-negative"
          : level === "medium" ? "border-warning/30 bg-warning/10 text-warning"
          : "border-positive/30 bg-positive/10 text-positive"
        }`}>{level}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-[10px] font-semibold text-muted uppercase tracking-widest">Top 3 Positions by Weight</p>
        {topPositions.map((p) => (
          <div key={p.symbol} className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold w-10">{p.symbol}</span>
            <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className={p.weight > 15 ? "h-full bg-negative rounded-full" : "h-full bg-accent/60 rounded-full"}
                style={{ width: `${Math.min(p.weight * 4, 100)}%` }}
              />
            </div>
            <span className={`font-mono text-xs w-10 text-right ${p.weight > 15 ? "text-negative" : ""}`}>
              {p.weight.toFixed(1)}%
            </span>
            {p.weight > 15 && <span className="text-[10px] text-negative">overweight</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────── Benchmark comparison ─────────────── */

function BenchmarkCard({ benchmark }: { benchmark: PortfolioReport["benchmark"] }) {
  if (!benchmark) return (
    <p className="text-sm text-muted">Benchmark data unavailable.</p>
  );

  const alpha = benchmark.alpha;
  const isOut = benchmark.relativePerformance === "outperforming";
  const isIn  = benchmark.relativePerformance === "in-line";
  const label = benchmark.relativePerformance === "outperforming" ? "Outperforming SPY"
    : benchmark.relativePerformance === "underperforming" ? "Underperforming SPY"
    : "In line with SPY";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div>
          <p className="text-[10px] text-muted uppercase tracking-widest">Your Portfolio</p>
          <p className={`font-mono text-2xl font-bold ${benchmark.portfolioReturn >= 0 ? "text-positive" : "text-negative"}`}>
            {benchmark.portfolioReturn >= 0 ? "+" : ""}{benchmark.portfolioReturn.toFixed(1)}%
          </p>
          <p className="text-[11px] text-muted">Total return (cost basis)</p>
        </div>
        {benchmark.spyReturn1y != null && (
          <>
            <div className="text-muted text-lg">vs</div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-widest">S&P 500 (1Y)</p>
              <p className={`font-mono text-2xl font-bold ${benchmark.spyReturn1y >= 0 ? "text-positive" : "text-negative"}`}>
                {benchmark.spyReturn1y >= 0 ? "+" : ""}{benchmark.spyReturn1y.toFixed(1)}%
              </p>
              <p className="text-[11px] text-muted">SPY 1-year return</p>
            </div>
          </>
        )}
        {alpha != null && (
          <div className={`ml-auto rounded-xl border px-4 py-3 text-center ${isOut ? "border-positive/25 bg-positive/8" : isIn ? "border-border bg-surface" : "border-negative/25 bg-negative/8"}`}>
            <p className={`font-mono text-xl font-bold ${isOut ? "text-positive" : isIn ? "" : "text-negative"}`}>
              {alpha >= 0 ? "+" : ""}{alpha.toFixed(1)}%
            </p>
            <p className="text-[10px] text-muted">Alpha vs SPY</p>
            <p className={`text-[11px] font-semibold mt-0.5 ${isOut ? "text-positive" : isIn ? "text-muted" : "text-negative"}`}>{label}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Main Intelligence Tab ─────────────── */

export function IntelligenceTab() {
  const { report, reportLoading } = usePortfolio();

  if (reportLoading && !report) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="flex flex-col gap-6">

      {/* ── New Position Ideas (AI, objective-aware) ── */}
      <div className="rounded-xl border border-accent/20 bg-accent/3 p-5">
        <NewPositionsPanel />
      </div>

      <div className="flex flex-col gap-3">

      <IntelSection
        question="What's my worst case?"
        answer={`${report.scenarios.length} stress scenarios — worst: ${report.scenarios.reduce((w, s) => s.portfolioImpact < w.portfolioImpact ? s : w, report.scenarios[0])?.name ?? "—"} (${report.scenarios.reduce((w, s) => s.portfolioImpact < w.portfolioImpact ? s : w, report.scenarios[0])?.portfolioImpact.toFixed(1) ?? "—"}%)`}
        importance="high"
        defaultOpen
      >
        <ScenarioAnalysis scenarios={report.scenarios} />
      </IntelSection>

      <IntelSection
        question="Why is my portfolio risky?"
        answer={`Beta ${report.risk.beta?.toFixed(2) ?? "—"} · Vol ${report.risk.annualizedVolatility?.toFixed(1) ?? "—"}% · ${report.risk.concentrationRisk} concentration`}
        importance="high"
        defaultOpen
      >
        <div className="space-y-5">
          <RiskSummaryCard report={report} />
          <ConcentrationSummary report={report} />
          <RiskMetrics risk={report.risk} />
        </div>
      </IntelSection>

      <IntelSection
        question="What factors are driving my returns?"
        answer={`Overweight: ${report.factors.topFactor} · Underweight: ${report.factors.bottomFactor}`}
        importance="medium"
      >
        <FactorExposureChart factors={report.factors} />
      </IntelSection>

      <IntelSection
        question="How correlated are my holdings?"
        answer={`Avg correlation ${report.correlation?.avgCorrelation.toFixed(2) ?? "—"} · ${(report.correlation?.highPairs.length ?? 0)} high-correlation pairs`}
        importance={report.correlation?.avgCorrelation != null && report.correlation.avgCorrelation > 0.6 ? "high" : "low"}
      >
        {report.correlation != null && report.correlation.symbols.length >= 2
          ? <CorrelationHeatmap matrix={report.correlation} />
          : <p className="text-sm text-muted">Need at least 2 positions with price history to compute correlation.</p>
        }
      </IntelSection>

      <IntelSection
        question="What exposures am I missing?"
        answer={`${report.gaps.missing.length} missing sectors · diversification score ${report.gaps.concentrationScore}/100`}
        importance={report.gaps.missing.filter((m) => m.priority === "high").length > 0 ? "high" : "medium"}
      >
        <GapAnalysisPanel gaps={report.gaps} />
      </IntelSection>

      <IntelSection
        question="How do I compare to the benchmark?"
        answer={report.benchmark?.relativePerformance ?? "Benchmark data loading…"}
        importance="low"
      >
        <BenchmarkCard benchmark={report.benchmark} />
      </IntelSection>

      </div>
    </div>
  );
}
