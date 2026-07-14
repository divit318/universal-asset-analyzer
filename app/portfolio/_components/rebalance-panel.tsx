"use client";

import type { RebalanceProposal } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";
import { InvestCashPanel } from "./invest-cash-panel";

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

          <InvestCashPanel />
        </div>
      </div>
    </div>
  );
}
