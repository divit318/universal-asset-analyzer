"use client";

import { Dialog } from "@/app/_components/dialog";
import type { PortfolioReport } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";

interface TradeImpactModalProps {
  symbol: string;
  name: string;
  allocationPct: number;
  dollarAmount: number;
  report: PortfolioReport;
  onClose: () => void;
}

interface MetricRow {
  label: string;
  before: number | null;
  after: number | null;
  unit?: string;
  lowerIsBetter?: boolean;
  format?: "integer" | "decimal" | "percent";
}

function delta(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return after - before;
}

function formatVal(v: number | null, fmt: "integer" | "decimal" | "percent" = "decimal", unit = ""): string {
  if (v == null) return "—";
  if (fmt === "integer") return `${Math.round(v)}${unit}`;
  if (fmt === "percent") return `${v.toFixed(1)}%`;
  return `${v.toFixed(1)}${unit}`;
}

function MetricRowDisplay({ row }: { row: MetricRow }) {
  const d = delta(row.before, row.after);
  const improved = d != null && (row.lowerIsBetter ? d < -0.5 : d > 0.5);
  const worsened = d != null && (row.lowerIsBetter ? d > 0.5 : d < -0.5);
  const fmt = row.format ?? "decimal";
  const unit = row.unit ?? "";

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted w-36 shrink-0">{row.label}</span>
      <div className="flex items-center gap-3 flex-1 justify-end">
        <span className="font-mono text-xs">{formatVal(row.before, fmt, unit)}</span>
        <span className="text-muted text-xs">→</span>
        {row.after != null ? (
          <span className={`font-mono text-xs font-semibold ${
            improved ? "text-positive" : worsened ? "text-negative" : "text-foreground"
          }`}>
            {formatVal(row.after, fmt, unit)}
          </span>
        ) : <span className="text-xs text-muted">—</span>}
        {d != null && Math.abs(d) > 0.5 && (
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            improved
              ? "bg-positive/10 text-positive"
              : worsened
              ? "bg-negative/10 text-negative"
              : "text-muted"
          }`}>
            {d > 0 ? "+" : ""}{formatVal(d, fmt, unit)}
          </span>
        )}
      </div>
    </div>
  );
}

export function TradeImpactModal({ symbol, name, allocationPct, dollarAmount, report, onClose }: TradeImpactModalProps) {
  // Compute after-state
  const newTotal  = report.totalValue + dollarAmount;
  const newHHI    = (() => {
    const newWeights = report.positions.map((p) => (p.value / newTotal) * 100);
    // Add new position
    newWeights.push((dollarAmount / newTotal) * 100);
    return Math.round(newWeights.reduce((s, w) => s + w * w, 0));
  })();
  const newTopPos = Math.max(
    ...report.positions.map((p) => (p.value / newTotal) * 100),
    (dollarAmount / newTotal) * 100,
  );
  // Sector concentration: rough estimate
  const newPositionCount = report.positionCount + 1;
  const currentHealthApprox = report.health.total;
  // A new diversifying position typically improves health by a few points
  const diversifyBonus = report.gaps?.concentrationScore != null && report.gaps.concentrationScore < 60 ? 3 : 1;
  const newHealthEst = Math.min(100, currentHealthApprox + diversifyBonus);

  // Volatility rough estimate: adding new position reduces vol slightly
  const hhiReduction = (report.risk.hhi - newHHI) / 100;
  const volDelta = report.risk.annualizedVolatility != null ? -(hhiReduction * 0.25) : null;

  const rows: MetricRow[] = [
    { label: "Portfolio Value",       before: report.totalValue,             after: newTotal,                                format: "integer", unit: "" },
    { label: "Position Count",        before: report.positionCount,          after: newPositionCount,                        format: "integer" },
    { label: "New Position Weight",   before: null,                          after: allocationPct,                           format: "percent" },
    { label: "Health Score",          before: currentHealthApprox,           after: newHealthEst,                            format: "integer", lowerIsBetter: false },
    { label: "HHI Concentration",     before: report.risk.hhi,               after: newHHI,                                  format: "integer", lowerIsBetter: true },
    { label: "Top Position Weight",   before: report.risk.topPositionWeight, after: Math.round(newTopPos * 10) / 10,         format: "percent", lowerIsBetter: true },
    { label: "Annualized Volatility", before: report.risk.annualizedVolatility, after: volDelta != null && report.risk.annualizedVolatility != null ? report.risk.annualizedVolatility + volDelta : null, format: "percent", lowerIsBetter: true },
  ];

  return (
    <Dialog open onClose={onClose} title={`Trade Impact Preview — ${symbol}`} className="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* Summary header */}
        <div className="rounded-lg border border-accent/30 bg-accent/8 px-4 py-3">
          <p className="text-xs text-muted mb-0.5">Buying {symbol} — {name}</p>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-lg font-bold text-positive">+{formatCurrency(dollarAmount)}</span>
            <span className="text-sm text-muted">{allocationPct}% of portfolio</span>
          </div>
        </div>

        {/* Before / After table */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Before → After</p>
            <div className="flex gap-3 text-[10px] text-muted">
              <span className="text-positive">↑ Improves</span>
              <span className="text-negative">↓ Worsens</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-1">
            {rows.map((row) => (
              <MetricRowDisplay key={row.label} row={row} />
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted/60 text-center">
          Impact estimates are approximations. Actual results depend on market conditions at time of execution.
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Close
          </button>
          <a
            href={`/research?symbol=${symbol}`}
            className="flex-1 rounded-lg bg-accent-strong py-2.5 text-sm font-medium text-background text-center transition-opacity hover:opacity-90"
          >
            Research {symbol} →
          </a>
        </div>
      </div>
    </Dialog>
  );
}
