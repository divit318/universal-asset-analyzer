"use client";

import { useState } from "react";
import { usePortfolio } from "@/lib/portfolio-context";
import { computeCashAllocation, type CashAllocation } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";

/**
 * Runs entirely off the report already held in PortfolioContext — the single
 * source of truth for the page. computeCashAllocation is pure (no I/O), so
 * there is no need to round-trip through an API route that would have to
 * re-fetch/re-derive its own copy of the report and could drift from what's
 * on screen.
 */
export function InvestCashPanel() {
  const { report, reportLoading } = usePortfolio();
  const [cash, setCash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CashAllocation[] | null>(null);
  const [invested, setInvested] = useState<number | null>(null);

  function compute() {
    const amount = parseFloat(cash.replace(/,/g, "").replace("$", ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid dollar amount");
      setResult(null);
      return;
    }
    if (!report || report.positionCount === 0) {
      setError("No portfolio data available");
      setResult(null);
      return;
    }
    setError(null);
    setInvested(amount);
    setResult(computeCashAllocation(amount, report));
  }

  const totalAllocated = result?.reduce((s, a) => s + a.dollarAmount, 0) ?? 0;
  const unallocated = invested != null ? Math.round((invested - totalAllocated) * 100) / 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold mb-1">Invest New Cash</p>
      <p className="text-xs text-muted mb-4">Intelligently allocate new capital across underweight positions with the highest composite scores.</p>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="10,000"
            inputMode="decimal"
            className="w-full rounded-lg border border-border bg-surface-2 pl-7 pr-3 py-2 font-mono text-sm outline-none focus:border-accent placeholder:text-muted"
            onKeyDown={(e) => { if (e.key === "Enter") compute(); }}
          />
        </div>
        <button
          onClick={compute}
          disabled={reportLoading}
          className="rounded-lg bg-accent-strong px-5 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Allocate
        </button>
      </div>
      {error && <p className="text-xs text-negative mb-2">{error}</p>}
      {result && (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {result.map((a) => (
            <div key={a.symbol} className="flex items-center justify-between px-4 py-2.5 bg-surface">
              <div>
                <span className="font-mono font-semibold text-sm text-accent">{a.symbol}</span>
                {a.shareCount != null && a.shareCount > 0 && (
                  <span className="text-xs text-muted ml-2">~{a.shareCount} shares</span>
                )}
                <p className="text-xs text-muted">{a.reason}</p>
              </div>
              <div className="text-right shrink-0">
                <span className="font-mono font-semibold text-positive text-sm block">{formatCurrency(a.dollarAmount)}</span>
                <span className="text-[10px] text-muted">→ {a.targetWeight.toFixed(1)}% of portfolio</span>
              </div>
            </div>
          ))}
          {Math.abs(unallocated) >= 0.5 && (
            <div className="px-4 py-2 bg-surface-2 text-[11px] text-muted">
              {formatCurrency(unallocated)} left uninvested — not enough underweight buy candidates to place the full amount.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
