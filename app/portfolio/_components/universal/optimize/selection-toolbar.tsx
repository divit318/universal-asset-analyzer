"use client";

import { Button, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { TradeSelectionState } from "./use-trade-selection";

/**
 * Bulk selection controls + live summary (Feature 2). The evidence-based
 * buttons (Highest Impact / Health Improvements / Risk Reduction) are
 * disabled until per-trade impacts have loaded — they select on measured
 * data, not a guess, so there is nothing honest for them to do before then.
 */
export function SelectionToolbar({
  state,
  totalTrades,
  impactsLoaded,
}: {
  state: TradeSelectionState;
  totalTrades: number;
  impactsLoaded: boolean;
}) {
  const { summary } = state;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" variant="secondary" onClick={state.selectAll}>Select All</Button>
        <Button size="xs" variant="ghost" onClick={state.clearAll}>Clear All</Button>
        <Button size="xs" variant="ghost" onClick={state.selectBuys}>Select Only Buys</Button>
        <Button size="xs" variant="ghost" onClick={state.selectSells}>Select Only Sells</Button>
        <Button size="xs" variant="ghost" onClick={state.invert}>Invert Selection</Button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <Button size="xs" variant="ghost" disabled={!impactsLoaded} onClick={() => state.selectHighestImpact(5)} title={impactsLoaded ? undefined : "Loading measured impact…"}>
          Select Highest Impact
        </Button>
        <Button size="xs" variant="ghost" disabled={!impactsLoaded} onClick={state.selectHealthImprovements} title={impactsLoaded ? undefined : "Loading measured impact…"}>
          Select Health Improvements
        </Button>
        <Button size="xs" variant="ghost" disabled={!impactsLoaded} onClick={state.selectRiskReduction} title={impactsLoaded ? undefined : "Loading measured impact…"}>
          Select Risk Reduction
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-[11px]">
        <Badge variant={summary.count > 0 ? "brand" : "neutral"}>
          {summary.count} of {totalTrades} trades selected
        </Badge>
        <span>
          <span className="text-muted/70">Value: </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{formatCurrency(summary.totalTradeValue)}</span>
        </span>
        <span>
          <span className="text-muted/70">Net cash: </span>
          <span className={`font-mono font-semibold tabular-nums ${summary.netCash > 0 ? "text-negative" : summary.netCash < 0 ? "text-positive" : "text-muted"}`}>
            {summary.netCash > 0 ? "−" : summary.netCash < 0 ? "+" : ""}{formatCurrency(Math.abs(summary.netCash))}
          </span>
          <span className="text-muted/50"> {summary.netCash > 0 ? "required" : summary.netCash < 0 ? "generated" : ""}</span>
        </span>
        <span>
          <span className="text-muted/70">Buys: </span>
          <span className="font-mono tabular-nums text-positive">{formatCurrency(summary.netBuys)}</span>
        </span>
        <span>
          <span className="text-muted/70">Sells: </span>
          <span className="font-mono tabular-nums text-negative">{formatCurrency(summary.netSells)}</span>
        </span>
        <span>
          <span className="text-muted/70">Turnover: </span>
          <span className="font-mono tabular-nums text-foreground">{summary.turnoverPct.toFixed(1)}%</span>
        </span>
      </div>
    </div>
  );
}
