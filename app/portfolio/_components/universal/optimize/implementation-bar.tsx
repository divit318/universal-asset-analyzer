"use client";

import { Button } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { TradeSelectionState } from "./use-trade-selection";

/**
 * Bottom sticky action bar (Feature 4). Only appears once something is
 * selected — an empty bar earns nothing on screen.
 */
export function ImplementationBar({
  selection,
  onImplement,
}: {
  selection: TradeSelectionState;
  onImplement: () => void;
}) {
  const { summary } = selection;
  if (summary.count === 0) return null;

  return (
    <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur">
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-foreground">
          {summary.count} trade{summary.count === 1 ? "" : "s"} selected
        </span>
        <span className="text-[11px] text-muted">{formatCurrency(summary.gross)} of changes</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={selection.clearAll}>Clear</Button>
        <Button variant="primary" size="sm" onClick={onImplement}>
          Implement {summary.count} Trade{summary.count === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
