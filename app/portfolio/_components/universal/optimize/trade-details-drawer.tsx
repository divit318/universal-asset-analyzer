"use client";

import { Drawer } from "@/app/_components/dialog";
import { Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import { ImpactRow } from "../impact-display";
import type { TargetWeight } from "@/lib/portfolio/engines/optimize";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";

/**
 * Trade Details Drawer (Feature 11). Reasoning and trade size come straight
 * from the optimizer's own TargetWeight — the same "reason" string shown in
 * the table row, just with room to breathe. Impact is the SAME per-trade
 * measurement that powers "Select Highest Impact" (computeTradeImpacts()) —
 * not a second calculation.
 *
 * An optimizer trade resizes an EXISTING holding to a target weight; it isn't
 * a competition between candidate instruments the way a Decision Center
 * gap-fill recommendation is, so there's no honest "alternatives considered"
 * list to show here — the drawer says that plainly instead of fabricating one.
 */
export function TradeDetailsDrawer({
  trade,
  impact,
  open,
  onClose,
}: {
  trade: TargetWeight | null;
  impact: ImpactEstimate | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!trade) return null;

  return (
    <Drawer open={open} onClose={onClose} label={`Trade details: ${trade.symbol ?? trade.name}`} className="max-w-md">
      <div className="flex flex-col gap-5 p-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Badge variant={trade.action === "BUY" ? "positive" : "negative"}>{trade.action}</Badge>
            <h2 className="text-base font-semibold text-foreground">{trade.symbol ?? trade.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>

        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">Reasoning</span>
          <p className="mt-1 text-sm leading-relaxed text-foreground">{trade.reason}</p>
        </div>

        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">Trade size</span>
          <div className="mt-1.5 flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Asset class</span>
              <span className="font-medium text-foreground">{PORTFOLIO_CLASS_LABEL[trade.assetClass]}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Weight</span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {trade.currentWeight.toFixed(1)}% → {trade.targetWeight.toFixed(1)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Amount</span>
              <span className={`font-mono font-semibold tabular-nums ${trade.dollarDelta > 0 ? "text-positive" : "text-negative"}`}>
                {trade.dollarDelta > 0 ? "+" : "−"}{formatCurrency(Math.abs(trade.dollarDelta))}
              </span>
            </div>
          </div>
        </div>

        <div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Measured effect if this trade alone were executed
          </span>
          {impact ? (
            <div className="mt-1.5"><ImpactRow impact={impact} /></div>
          ) : (
            <p className="mt-1.5 text-xs text-muted">Still measuring…</p>
          )}
        </div>

        <p className="rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px] leading-relaxed text-muted">
          This trade resizes an existing holding to its target weight — there&apos;s no
          alternative instrument being compared here, since it isn&apos;t a new position.
          Recommendations that DO compare candidate alternatives (e.g. which bond ETF
          to add) live on the Decisions tab.
        </p>
      </div>
    </Drawer>
  );
}
