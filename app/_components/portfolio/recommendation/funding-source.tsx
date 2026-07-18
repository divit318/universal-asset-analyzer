import { Card } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { FundingSource, SellSuggestion } from "./types";

function FundingOption({
  id,
  title,
  description,
  disabled,
  selected,
  onSelect,
}: {
  id: FundingSource;
  title: string;
  description: string;
  disabled?: boolean;
  selected: boolean;
  onSelect: (s: FundingSource) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(id)}
      aria-pressed={selected}
      className={`flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${
        selected ? "border-brand/50 bg-brand/5" : "border-border bg-surface/40 hover:border-border-strong"
      } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
    >
      <span className="text-[12px] font-semibold text-foreground">{title}</span>
      <span className="text-[11px] text-muted">{description}</span>
    </button>
  );
}

/** Section 5 — Funding Source. Replaces the old Asset Class selector entirely. */
export function FundingSourcePanel({
  cashAvailable,
  fundingShortfall,
  sellSuggestions,
  sellSuggestionsCoverShortfall,
  selected,
  onSelect,
}: {
  cashAvailable: number;
  fundingShortfall: number;
  sellSuggestions: SellSuggestion[];
  sellSuggestionsCoverShortfall: boolean;
  selected: FundingSource;
  onSelect: (s: FundingSource) => void;
}) {
  const fullyCovered = fundingShortfall <= 0;
  const sellDisabled = sellSuggestions.length === 0;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Funding source</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FundingOption
          id="cash"
          title="Available Cash"
          description={
            fullyCovered
              ? `${formatCurrency(cashAvailable)} on hand covers this in full.`
              : `${formatCurrency(cashAvailable)} on hand — ${formatCurrency(fundingShortfall)} short.`
          }
          selected={selected === "cash"}
          onSelect={onSelect}
        />
        <FundingOption
          id="sell_holdings"
          title="Sell Existing Holdings"
          description={
            sellDisabled
              ? "No holdings currently recommended to sell."
              : `Sell ${sellSuggestions.length} position${sellSuggestions.length === 1 ? "" : "s"} to raise ${formatCurrency(sellSuggestions.reduce((s, x) => s + x.amount, 0))}.`
          }
          disabled={sellDisabled}
          selected={selected === "sell_holdings"}
          onSelect={onSelect}
        />
        <FundingOption
          id="optimizer_decides"
          title="Optimizer Decides"
          description={
            fullyCovered
              ? "No shortfall to fund — behaves the same as Available Cash."
              : sellSuggestionsCoverShortfall
                ? "Automatically funds the shortfall from the same sell recommendations, no review needed."
                : "The recommended sells don't fully cover the shortfall — the purchase would be funded as far as cash + sells allow."
          }
          selected={selected === "optimizer_decides"}
          onSelect={onSelect}
        />
      </div>

      {selected !== "cash" && sellSuggestions.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-surface/50 p-2">
          {sellSuggestions.map((s) => (
            <li key={s.holdingId} className="flex items-start justify-between gap-3 text-[11px]">
              <div className="min-w-0 flex-1">
                <span className="font-mono font-medium text-foreground">{s.symbol ?? s.name}</span>
                <p className="text-muted/80">{s.rationale}</p>
              </div>
              <span className="shrink-0 font-mono font-semibold text-foreground">{formatCurrency(s.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
