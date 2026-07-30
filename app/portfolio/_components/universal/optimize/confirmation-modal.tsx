"use client";

import { Dialog } from "@/app/_components/dialog";
import { Button, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { StateRow } from "../impact-display";
import type { TradeSelectionState } from "./use-trade-selection";
import type { PreviewResponse } from "./use-preview";

/**
 * Confirmation before implementation (Feature 5). Holdings are never mutated
 * without this step — Cancel/Escape/backdrop-click all leave the real
 * portfolio untouched.
 */
export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  selection,
  preview,
  submitting,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  selection: TradeSelectionState;
  preview: PreviewResponse | null;
  submitting: boolean;
}) {
  const { summary, selectedTrades } = selection;

  return (
    <Dialog open={open} onClose={submitting ? () => {} : onClose} title="Confirm trade implementation" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="text-muted">Trades selected</span>
          <span className="text-right font-mono font-semibold text-foreground">{summary.count}</span>
          <span className="text-muted">Capital deployed (buys)</span>
          <span className="text-right font-mono font-semibold text-positive">{formatCurrency(summary.buys)}</span>
          <span className="text-muted">Capital received (sells)</span>
          <span className="text-right font-mono font-semibold text-negative">{formatCurrency(summary.sells)}</span>
          <span className="text-muted">Net exposure</span>
          <span className="text-right font-mono font-semibold text-foreground">
            {summary.netCash > 0 ? "+" : ""}{formatCurrency(summary.netCash)}
          </span>
          {/* The last thing shown before the irreversible button is where the
              money comes from. A selection whose buys exceed its sells is funded
              out of the cash balance, and one that exceeds THAT too cannot be
              executed as shown — the executor caps its cash draw at what exists
              and the excess buys would inflate tracked value out of nothing. */}
          <span className="text-muted">Cash after settlement</span>
          <span className={`text-right font-mono font-semibold ${summary.shortfall > 0 ? "text-negative" : "text-foreground"}`}>
            {formatCurrency(summary.cashAfter)}
          </span>
        </div>

        {summary.shortfall > 0 && (
          <p className="rounded-lg border border-negative/30 bg-negative/[0.06] px-3 py-2 text-[11px] leading-relaxed text-negative">
            This selection buys {formatCurrency(summary.shortfall)} more than its sells plus your{" "}
            {formatCurrency(summary.cashAvailable)} cash balance can fund. Deselect some buys, or add
            cash, before implementing.
          </p>
        )}

        {preview && (
          <div className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-surface/40 px-3 py-1">
            <span className="pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              Expected portfolio state
            </span>
            <StateRow label="Portfolio health" before={preview.before.health.total} after={preview.after.health.total} decimals={0} />
            <StateRow
              label="Annualized volatility"
              before={preview.before.risk.annualizedVolatility}
              after={preview.after.risk.annualizedVolatility}
              suffix="%"
              higherIsBetter={false}
            />
            <StateRow
              label="Illiquid share"
              before={preview.before.risk.illiquidPct}
              after={preview.after.risk.illiquidPct}
              suffix="%"
              higherIsBetter={false}
            />
          </div>
        )}

        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-surface/30 px-3 py-2 text-[11px]">
          {selectedTrades.map((t) => (
            <li key={t.holdingId} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Badge variant={t.action === "BUY" ? "positive" : "negative"}>{t.action}</Badge>
                <span className="text-foreground">{t.symbol ?? t.name}</span>
                {t.partialPct < 100 && <span className="text-muted/70">({t.partialPct}%)</span>}
              </span>
              <span className="font-mono tabular-nums text-muted">
                {formatCurrency(Math.abs(t.dollarDelta * (t.partialPct / 100)))}
              </span>
            </li>
          ))}
        </ul>

        <p className="text-[11px] leading-relaxed text-muted">
          You are about to update your portfolio holdings. These changes will permanently modify your
          portfolio. This action can be undone.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={submitting}>
            {submitting ? "Implementing…" : `Implement ${summary.count} Trade${summary.count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
