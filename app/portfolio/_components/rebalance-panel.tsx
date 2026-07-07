"use client";

import { useState } from "react";
import type { RebalanceProposal } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";

function TradeRow({ trade }: { trade: RebalanceProposal["trades"][number] }) {
  const isBuy = trade.action === "BUY";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${isBuy ? "border-positive/25 bg-positive/5" : "border-negative/20 bg-negative/5"}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${isBuy ? "bg-positive/20 text-positive" : "bg-negative/15 text-negative"}`}>
        {isBuy ? "+" : "−"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold text-sm">{trade.symbol}</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${isBuy ? "text-positive" : "text-negative"}`}>
            {trade.action}
          </span>
        </div>
        <p className="text-xs text-muted truncate">{trade.reason}</p>
      </div>
      <div className="text-right shrink-0">
        <p className={`font-mono text-sm font-semibold ${isBuy ? "text-positive" : "text-negative"}`}>
          {isBuy ? "+" : "−"}{formatCurrency(trade.dollarAmount)}
        </p>
        {trade.sharesApprox != null && (
          <p className="text-xs text-muted font-mono">~{trade.sharesApprox} shares</p>
        )}
        <p className="text-xs text-muted">
          {trade.fromWeight.toFixed(1)}% → {trade.toWeight.toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

function SectorChange({ change }: { change: RebalanceProposal["sectorChanges"][number] }) {
  const delta = change.to - change.from;
  const color = delta > 0 ? "text-positive" : "text-negative";
  const bgFrom = "bg-accent/40";
  const bgTo = delta > 0 ? "bg-positive/50" : "bg-negative/50";
  const maxW = Math.max(change.from, change.to);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground/80">{change.sector}</span>
        <span className={`font-mono font-medium ${color}`}>
          {delta > 0 ? "+" : ""}{delta.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${bgFrom} rounded-full`} style={{ width: `${(change.from / maxW) * 100}%` }} />
        </div>
        <span className="text-[10px] text-muted w-8 text-right font-mono">{change.from.toFixed(0)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 h-2 bg-surface-2 rounded-full overflow-hidden">
          <div className={`absolute inset-y-0 left-0 ${bgTo} rounded-full`} style={{ width: `${(change.to / maxW) * 100}%` }} />
        </div>
        <span className="text-[10px] text-muted w-8 text-right font-mono">{change.to.toFixed(0)}%</span>
      </div>
    </div>
  );
}

function InvestCash({ onResult }: { onResult: (allocations: unknown[]) => void }) {
  const [cash, setCash] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ symbol: string; name: string; dollarAmount: number; shareCount: number | null; reason: string }[] | null>(null);

  async function compute() {
    const amount = parseFloat(cash.replace(/,/g, "").replace("$", ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid dollar amount");
      return;
    }
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portfolio/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashAmount: amount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setResult(json.allocations);
      onResult(json.allocations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-semibold mb-3">Invest New Cash</p>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="10,000"
            className="w-full rounded-lg border border-border bg-surface-2 pl-7 pr-3 py-2 font-mono text-sm outline-none focus:border-accent placeholder:text-muted"
          />
        </div>
        <button
          onClick={() => void compute()}
          disabled={loading}
          className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "…" : "Allocate"}
        </button>
      </div>
      {error && <p className="text-xs text-negative mb-2">{error}</p>}
      {result && (
        <div className="space-y-2">
          {result.map((a, i) => (
            <div key={i} className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
              <div>
                <span className="font-mono font-semibold text-accent">{a.symbol}</span>
                {a.shareCount != null && <span className="text-muted text-xs ml-2">~{a.shareCount} shares</span>}
                <p className="text-xs text-muted">{a.reason}</p>
              </div>
              <span className="font-mono font-semibold text-positive">{formatCurrency(a.dollarAmount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function RebalancePanel({ rebalance }: { rebalance: RebalanceProposal }) {
  const hasTrades = rebalance.trades.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Trades</p>
          <p className="font-mono text-2xl font-bold">{rebalance.trades.length}</p>
        </div>
        <div className="rounded-xl border border-positive/25 bg-positive/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Buy Total</p>
          <p className="font-mono text-xl font-bold text-positive">{formatCurrency(rebalance.buyTotal)}</p>
        </div>
        <div className="rounded-xl border border-negative/20 bg-negative/5 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Sell Total</p>
          <p className="font-mono text-xl font-bold text-negative">{formatCurrency(rebalance.sellTotal)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1">Est. Risk Reduction</p>
          <p className="font-mono text-xl font-bold">
            {rebalance.estimatedRiskReduction != null
              ? `${rebalance.estimatedRiskReduction.toFixed(0)}%`
              : "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Trades */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Recommended Trades</h3>
          {hasTrades ? (
            <div className="flex flex-col gap-2">
              {rebalance.trades.map((t, i) => <TradeRow key={i} trade={t} />)}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface px-5 py-6 text-center">
              <p className="text-sm text-muted">Portfolio is well balanced — no significant rebalancing needed.</p>
            </div>
          )}
        </div>

        {/* Sector changes + Invest cash */}
        <div className="flex flex-col gap-4">
          {rebalance.sectorChanges.length > 0 && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h3 className="text-sm font-semibold mb-3">Sector Impact</h3>
              <div className="flex flex-col gap-3">
                {rebalance.sectorChanges.slice(0, 5).map((c, i) => (
                  <SectorChange key={i} change={c} />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-muted">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-accent/40" />Current</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-positive/50" />After rebalance</span>
              </div>
            </div>
          )}

          <InvestCash onResult={() => {}} />
        </div>
      </div>
    </div>
  );
}
