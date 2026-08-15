"use client";

import { Dialog } from "@/app/_components/dialog";
import { Button, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { StateRow } from "../impact-display";
import type { CashPlanResponse, NarratedItem } from "./types";

export function CashConfirmationModal({
  open,
  onClose,
  onConfirm,
  plan,
  selectedItems,
  totalSelected,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  plan: CashPlanResponse;
  selectedItems: NarratedItem[];
  totalSelected: number;
  submitting: boolean;
}) {
  // The engine apportions item amounts so they sum to `cashAmount` exactly (see
  // allocateToExactTotal), so this can no longer go negative — a modal that
  // offered to spend $3,001 of a $3,000 deposit and called the shortfall
  // "Remaining as cash: -$1.00" was reporting the overspend, not causing it. The
  // cent-level rounding here only stops a float residual rendering as "-$0.00".
  const remainingAsCash = Math.round((plan.cashAmount - totalSelected) * 100) / 100;

  return (
    <Dialog open={open} onClose={submitting ? () => {} : onClose} title="Confirm cash deployment" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="text-muted">New cash deposited</span>
          <span className="text-right font-mono font-semibold text-foreground">{formatCurrency(plan.cashAmount)}</span>
          <span className="text-muted">Positions to buy</span>
          <span className="text-right font-mono font-semibold text-foreground">{selectedItems.length}</span>
          <span className="text-muted">Capital deployed</span>
          <span className="text-right font-mono font-semibold text-positive">{formatCurrency(totalSelected)}</span>
          <span className="text-muted">Remaining as cash</span>
          <span className="text-right font-mono font-semibold text-foreground">{formatCurrency(remainingAsCash)}</span>
        </div>

        <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-surface/40 px-3 py-1">
          <span className="pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Expected portfolio state
          </span>
          {/* The bare 0-100 alignment score — deliberately no letter grade (the
              alignment engine has none) and nullable on both sides: an unscorable
              book has no score, and StateRow drops the row rather than inventing
              a number. */}
          <StateRow
            label="Portfolio alignment"
            before={plan.before.alignment.score}
            after={plan.after.alignment.score}
            decimals={0}
          />
          <StateRow
            label="Annualized volatility"
            before={plan.before.risk.annualizedVolatility}
            after={plan.after.risk.annualizedVolatility}
            suffix="%"
            higherIsBetter={false}
          />
          <StateRow
            label="Illiquid share"
            before={plan.before.risk.illiquidPct}
            after={plan.after.risk.illiquidPct}
            suffix="%"
            higherIsBetter={false}
          />
        </div>

        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px]">
          {selectedItems.map((item) => (
            <li key={item.symbol ?? item.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge variant="positive">BUY</Badge>
                <span className="text-foreground">{item.symbol ?? item.name}</span>
              </span>
              <span className="font-mono tabular-nums text-muted">{formatCurrency(item.dollarAmount)}</span>
            </li>
          ))}
        </ul>

        <p className="text-[11px] leading-relaxed text-muted">
          This deposits the cash and buys the positions above. This permanently modifies your portfolio,
          but the action can be undone.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Deploying…" : `Deploy ${formatCurrency(plan.cashAmount)}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
