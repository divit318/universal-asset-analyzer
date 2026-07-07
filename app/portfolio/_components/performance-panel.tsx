"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { PortfolioPerformance } from "@/lib/portfolio-performance";

/** Fraction (0.061) → "6.1%". */
function pct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null || Number.isNaN(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

function toneClass(v: number | null | undefined): string {
  if (v == null) return "text-muted";
  return v > 0 ? "text-positive" : v < 0 ? "text-negative" : "text-muted";
}

function Metric({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-micro font-semibold uppercase tracking-widest text-faint">{label}</span>
      <span className={`font-mono text-lg font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</span>
      {sub != null && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

/**
 * Money-weighted performance + honest benchmark-relative return, computed from
 * the lot ledger. Answers "what's my real return, and am I beating the S&P?" —
 * which the cost-vs-value hero bar above cannot.
 */
export function PerformancePanel() {
  const [perf, setPerf] = useState<PortfolioPerformance | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty" | "error">("loading");

  useEffect(() => {
    let alive = true;
    void fetch("/api/portfolio/performance")
      .then(async (r) => {
        const json = await r.json();
        if (!alive) return;
        if (json?.empty) return setState("empty");
        setPerf(json as PortfolioPerformance);
        setState("ready");
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "empty" || state === "error") return null;
  if (state === "loading" || !perf) {
    return <div className="h-28 animate-pulse rounded-card border border-border bg-surface" />;
  }

  const b = perf.benchmark;
  // Same-cash-flows comparison: your value vs what the index would be worth.
  const vsIndex =
    b && b.currentValue > 0 ? (perf.currentValue - b.currentValue) / b.currentValue : null;
  const shortHistory = perf.holdingDays < 30;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Performance</h3>
        <span className="text-xs text-muted">
          money-weighted · {perf.holdingDays}d since first buy
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Metric
          label="Total Return"
          tone={toneClass(perf.totalPnl)}
          value={`${perf.totalPnl >= 0 ? "+" : ""}${formatCurrency(perf.totalPnl)}`}
          sub={<span className={toneClass(perf.totalReturnPct)}>{pct(perf.totalReturnPct)} on cost</span>}
        />
        <Metric
          label="Return (XIRR)"
          tone={toneClass(perf.xirr)}
          value={perf.xirr == null ? "—" : pct(perf.xirr)}
          sub={shortHistory ? "annualized — short history" : "annualized"}
        />
        {b ? (
          <Metric
            label={`vs ${b.symbol}`}
            tone={toneClass(vsIndex)}
            value={pct(vsIndex)}
            sub={
              vsIndex == null
                ? "—"
                : vsIndex >= 0
                  ? `ahead of the ${b.symbol}`
                  : `behind the ${b.symbol}`
            }
          />
        ) : (
          <Metric label="vs Benchmark" value="—" sub="no benchmark" />
        )}
        <Metric
          label="Realized / Unrealized"
          value={
            <span className="flex items-baseline gap-1.5 text-base">
              <span className={toneClass(perf.realizedPnl)}>{formatCurrency(perf.realizedPnl)}</span>
              <span className="text-faint">/</span>
              <span className={toneClass(perf.unrealizedPnl)}>{formatCurrency(perf.unrealizedPnl)}</span>
            </span>
          }
          sub="banked / at risk"
        />
      </div>

      {b && vsIndex != null && (
        <p className="border-t border-border pt-3 text-xs leading-5 text-muted">
          The same cash, invested on the same dates into {b.symbol}, would be worth{" "}
          <span className="font-medium text-foreground">{formatCurrency(b.currentValue)}</span> today — your holdings
          are worth <span className="font-medium text-foreground">{formatCurrency(perf.currentValue)}</span>.
        </p>
      )}
    </div>
  );
}
