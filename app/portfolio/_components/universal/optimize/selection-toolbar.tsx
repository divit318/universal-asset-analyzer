"use client";

import { Button, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { TradeSelectionState } from "./use-trade-selection";

/**
 * Bulk selection controls + live summary (Feature 2). The evidence-based
 * buttons (Highest Impact / Alignment Improvements / Risk Reduction) are
 * disabled until per-trade impacts have loaded — they select on measured
 * data, not a guess, so there is nothing honest for them to do before then.
 *
 * Every button's appearance is derived from whether the CURRENT selection is that
 * set, never from which button was last pressed. "Select All" used to be the only
 * `secondary`-variant button here, so it rendered permanently in the raised,
 * bordered style that means "pressed" everywhere else in the app — including
 * beside "0 of 16 trades selected" and sixteen empty checkboxes. Three surfaces
 * describing one state, one of them wrong.
 */
function BulkButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      aria-pressed={active ?? false}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={active ? "border-brand/50 text-foreground" : undefined}
    >
      {children}
    </Button>
  );
}

export function SelectionToolbar({
  state,
  totalTrades,
  impactsLoaded,
}: {
  state: TradeSelectionState;
  totalTrades: number;
  impactsLoaded: boolean;
}) {
  const { summary, activeBulkAction: is } = state;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface/40 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <BulkButton onClick={state.selectAll} active={is.all}>Select All</BulkButton>
        <BulkButton onClick={state.clearAll} active={is.none}>Clear All</BulkButton>
        <BulkButton onClick={state.selectBuys} active={is.buys}>Select Only Buys</BulkButton>
        <BulkButton onClick={state.selectSells} active={is.sells}>Select Only Sells</BulkButton>
        {/* Invert is a transformation, not a state — there is no selection it
            could be "currently showing", so it never renders as active. */}
        <BulkButton onClick={state.invert}>Invert Selection</BulkButton>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <BulkButton
          onClick={state.selectHighestImpact}
          active={is.highestImpact}
          disabled={!impactsLoaded}
          title={impactsLoaded ? undefined : "Loading measured impact…"}
        >
          Select Highest Impact
        </BulkButton>
        <BulkButton
          onClick={state.selectAlignmentImprovements}
          active={is.alignmentImprovements}
          disabled={!impactsLoaded}
          title={impactsLoaded ? undefined : "Loading measured impact…"}
        >
          Select Alignment Improvements
        </BulkButton>
        <BulkButton
          onClick={state.selectRiskReduction}
          active={is.riskReduction}
          disabled={!impactsLoaded}
          title={impactsLoaded ? undefined : "Loading measured impact…"}
        >
          Select Risk Reduction
        </BulkButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-2.5 text-[11px]">
        <Badge variant={summary.count > 0 ? "brand" : "neutral"}>
          {summary.count} of {totalTrades} trades selected
        </Badge>
        <span>
          <span className="text-muted/70">Value: </span>
          <span className="font-mono font-semibold tabular-nums text-foreground">{formatCurrency(summary.gross)}</span>
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
          <span className="font-mono tabular-nums text-positive">{formatCurrency(summary.buys)}</span>
        </span>
        <span>
          <span className="text-muted/70">Sells: </span>
          <span className="font-mono tabular-nums text-negative">{formatCurrency(summary.sells)}</span>
        </span>
        <span>
          <span className="text-muted/70">Turnover: </span>
          <span className="font-mono tabular-nums text-foreground">{summary.turnoverPct.toFixed(1)}%</span>
        </span>
      </div>
    </div>
  );
}
