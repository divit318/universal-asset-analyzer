"use client";

import { useState } from "react";
import type { RiskAnalytics, ScenarioImpact, CorrelationMatrix, FactorExposure } from "@/lib/portfolio-analytics";
import { ALL_SECTORS } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";

/* ---------------------------------------- Risk Metrics ---------------------------------------- */

function MetricCard({
  label, value, sub, hint, color,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">{label}</p>
      <p className={`font-mono text-xl font-bold ${color ?? ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
      {hint && <p className="text-[10px] text-muted/70 mt-0.5">{hint}</p>}
    </div>
  );
}

export function RiskMetrics({ risk }: { risk: RiskAnalytics }) {
  const betaColor = risk.beta == null ? "" : risk.beta > 1.3 ? "text-negative" : risk.beta > 1.0 ? "text-amber-400" : "text-positive";
  const sharpeValid = risk.sharpeRatio != null && Math.abs(risk.sharpeRatio) <= 5;
  const sharpeColor = !sharpeValid ? "text-muted" : risk.sharpeRatio! > 1 ? "text-positive" : risk.sharpeRatio! > 0.5 ? "text-amber-400" : "text-negative";
  const ddColor = risk.maxDrawdown == null ? "" : risk.maxDrawdown < -30 ? "text-negative" : risk.maxDrawdown < -15 ? "text-amber-400" : "text-positive";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Risk Analytics</h3>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
          risk.concentrationRisk === "high" ? "border-negative/30 bg-negative/10 text-negative"
          : risk.concentrationRisk === "medium" ? "border-amber-400/30 bg-amber-400/10 text-amber-400"
          : "border-positive/30 bg-positive/10 text-positive"
        }`}>
          {risk.concentrationRisk.charAt(0).toUpperCase() + risk.concentrationRisk.slice(1)} Concentration
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard
          label="Beta"
          value={risk.beta != null ? risk.beta.toFixed(2) : "—"}
          sub="vs S&P 500"
          hint={risk.beta != null ? risk.beta > 1 ? "Amplifies market moves" : "Dampens market moves" : undefined}
          color={betaColor}
        />
        <MetricCard
          label="Volatility"
          value={risk.annualizedVolatility != null ? `${risk.annualizedVolatility.toFixed(1)}%` : "—"}
          sub="Annualized"
          hint="SPY: ~15% typical"
        />
        <MetricCard
          label="Sharpe Ratio"
          value={sharpeValid ? risk.sharpeRatio!.toFixed(2) : "N/A"}
          sub="Risk-adjusted return"
          hint={sharpeValid
            ? risk.sharpeRatio! > 1 ? "> 1 is strong" : risk.sharpeRatio! > 0 ? "Positive but modest" : "Negative — risk exceeds return"
            : "Insufficient history for reliable Sharpe"}
          color={sharpeColor}
        />
        <MetricCard
          label="Sortino Ratio"
          value={risk.sortinoRatio != null ? risk.sortinoRatio.toFixed(2) : "—"}
          sub="Downside-adjusted"
          hint="Higher = better downside management"
        />
        <MetricCard
          label="Max Drawdown"
          value={risk.maxDrawdown != null ? `${risk.maxDrawdown.toFixed(1)}%` : "—"}
          sub="90-day peak to trough"
          color={ddColor}
        />
        <MetricCard
          label="VaR (95%)"
          value={risk.var95Pct != null ? `${risk.var95Pct.toFixed(2)}%` : "—"}
          sub={risk.var95Dollar != null ? `~${formatCurrency(risk.var95Dollar)} per day` : "Daily loss estimate"}
          hint="95% confidence 1-day loss"
        />
        <MetricCard
          label="HHI"
          value={`${risk.hhi.toLocaleString()}`}
          sub={risk.hhi < 1500 ? "Well diversified" : risk.hhi < 2500 ? "Moderate" : "Concentrated"}
          hint="< 1500 = low concentration"
          color={risk.hhi > 2500 ? "text-negative" : risk.hhi > 1500 ? "text-amber-400" : "text-positive"}
        />
        <MetricCard
          label="Top Position"
          value={`${risk.topPositionWeight.toFixed(1)}%`}
          sub={`Top sector: ${risk.topSectorWeight.toFixed(1)}%`}
          color={risk.topPositionWeight > 20 ? "text-negative" : risk.topPositionWeight > 15 ? "text-amber-400" : "text-positive"}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------- Scenario Analysis ---------------------------------------- */

function ScenarioBar({ impact }: { impact: number }) {
  const abs = Math.abs(impact);
  const clampedWidth = Math.min(abs * 2, 100);
  const color = impact >= 0 ? "bg-positive" : "bg-negative";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${clampedWidth}%` }} />
      </div>
      <span className={`font-mono text-xs font-semibold w-12 text-right shrink-0 ${impact >= 0 ? "text-positive" : "text-negative"}`}>
        {impact >= 0 ? "+" : ""}{impact.toFixed(1)}%
      </span>
    </div>
  );
}

function CustomScenarioBuilder() {
  const [sector, setSector] = useState(ALL_SECTORS[0]);
  const [shockPct, setShockPct] = useState(-25);
  const [result, setResult] = useState<ScenarioImpact | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sector, shockPct }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scenario computation failed");
      setResult(data.scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario computation failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold mb-3">Custom Scenario — &quot;What if...&quot;</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted">Sector</span>
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs"
          >
            {ALL_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-muted">Shock %</span>
          <input
            type="number"
            value={shockPct}
            onChange={(e) => setShockPct(Number(e.target.value))}
            className="w-20 rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs font-mono"
            min={-95}
            max={95}
          />
        </label>
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/15 disabled:opacity-50"
        >
          {loading ? "Computing…" : "Run scenario"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-negative">{error}</p>}
      {result && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <ScenarioBar impact={result.portfolioImpact} />
          <p className={`font-mono text-base font-bold mt-1.5 ${result.portfolioImpact >= 0 ? "text-positive" : "text-negative"}`}>
            {result.portfolioImpact >= 0 ? "+" : ""}{formatCurrency(result.dollarImpact)}
          </p>
          {result.worstHolding && (
            <p className="text-[10px] text-muted mt-1">Most exposed: <span className="font-mono">{result.worstHolding}</span></p>
          )}
        </div>
      )}
    </div>
  );
}

export function ScenarioAnalysis({ scenarios, totalValue }: { scenarios: ScenarioImpact[]; totalValue: number }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Stress Test Scenarios</h3>
      <p className="text-xs text-muted">Historical sector-based shocks applied to current portfolio weights, adjusted for current Sector Rotation momentum.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {scenarios.map((s) => (
          <div key={s.name} className={`rounded-xl border p-4 ${s.portfolioImpact < -20 ? "border-negative/30 bg-negative/5" : s.portfolioImpact < -10 ? "border-amber-400/25 bg-amber-400/5" : "border-border bg-surface"}`}>
            <p className="text-xs font-semibold mb-0.5">{s.name}</p>
            <p className="text-[10px] text-muted mb-2 leading-relaxed">{s.description}</p>
            <ScenarioBar impact={s.portfolioImpact} />
            <p className={`font-mono text-base font-bold mt-1.5 ${s.portfolioImpact >= 0 ? "text-positive" : "text-negative"}`}>
              {s.portfolioImpact >= 0 ? "+" : ""}{formatCurrency(s.dollarImpact)}
            </p>
            {s.worstHolding && (
              <p className="text-[10px] text-muted mt-1">Most exposed: <span className="font-mono">{s.worstHolding}</span></p>
            )}
          </div>
        ))}
      </div>
      <CustomScenarioBuilder />
    </div>
  );
}

/* ---------------------------------------- Correlation Heatmap ---------------------------------------- */

function corrColor(r: number): string {
  if (r >= 0.8) return "bg-negative/70";
  if (r >= 0.6) return "bg-orange-400/60";
  if (r >= 0.3) return "bg-amber-400/40";
  if (r >= 0) return "bg-accent/20";
  return "bg-positive/30";
}

export function CorrelationHeatmap({ matrix }: { matrix: CorrelationMatrix }) {
  const n = matrix.symbols.length;
  if (n < 2) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Correlation Matrix</h3>
        <span className="text-xs text-muted">Avg: {matrix.avgCorrelation.toFixed(2)}</span>
      </div>

      {matrix.highPairs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {matrix.highPairs.map((p, i) => (
            <span key={i} className="rounded-full border border-negative/25 bg-negative/8 px-2 py-0.5 text-[11px] font-mono text-negative">
              {p.a}/{p.b}: {p.r.toFixed(2)}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="text-[10px] font-mono">
          <thead>
            <tr>
              <th className="px-1 py-1 w-12" />
              {matrix.symbols.map((s) => (
                <th key={s} className="px-1 py-1 text-center text-muted font-medium rotate-0 w-10">{s.slice(0, 4)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.symbols.map((rowSym, i) => (
              <tr key={rowSym}>
                <td className="px-1 py-0.5 text-muted font-medium">{rowSym.slice(0, 4)}</td>
                {matrix.symbols.map((_, j) => {
                  const r = matrix.matrix[i][j];
                  return (
                    <td key={j} className="px-0.5 py-0.5">
                      <div className={`h-7 w-9 rounded flex items-center justify-center text-[9px] font-semibold ${i === j ? "bg-border/50 text-muted" : corrColor(r)}`}>
                        {i === j ? "—" : r.toFixed(2)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-muted flex-wrap">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-positive/30" /> Low (&lt; 0)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-accent/20" /> Moderate (0–0.3)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-amber-400/40" /> Correlated (0.3–0.6)</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-negative/70" /> High (&gt; 0.8)</span>
      </div>
    </div>
  );
}

/* ---------------------------------------- Factor Exposure ---------------------------------------- */

export function FactorExposureChart({ factors }: { factors: FactorExposure }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Factor Exposure</h3>
        <span className="text-xs text-muted">Dominant: <span className="text-foreground">{factors.topFactor}</span></span>
      </div>
      <div className="flex flex-col gap-2.5">
        {factors.tilts.map((tilt) => {
          const isPos = tilt.score >= 0;
          const pct = Math.min(Math.abs(tilt.score), 100);
          const barColor = isPos ? "bg-accent" : "bg-muted";
          const labelColor = tilt.direction === "overweight" ? "text-accent" : tilt.direction === "underweight" ? "text-negative" : "text-muted";

          return (
            <div key={tilt.factor} className="flex items-center gap-3">
              <span className="text-xs text-foreground/80 w-24 shrink-0 text-right">{tilt.factor}</span>
              {/* Diverging bar centered */}
              <div className="flex flex-1 items-center gap-0">
                <div className="flex-1 flex justify-end">
                  {!isPos && (
                    <div className={`h-3 rounded-l-full ${barColor} opacity-70`} style={{ width: `${pct}%` }} />
                  )}
                </div>
                <div className="w-px h-4 bg-border mx-1 shrink-0" />
                <div className="flex-1">
                  {isPos && (
                    <div className={`h-3 rounded-r-full ${barColor}`} style={{ width: `${pct}%` }} />
                  )}
                </div>
              </div>
              <span className={`font-mono text-xs font-medium w-10 shrink-0 ${labelColor}`}>
                {tilt.score > 0 ? "+" : ""}{tilt.score}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted">Bars diverge from center. Right = overweight, left = underweight vs neutral market.</p>
    </div>
  );
}
