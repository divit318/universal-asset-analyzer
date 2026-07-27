import { Card, Input } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { Stat } from "./metric-row";

export type SizingMode = "amount" | "quantity" | "pctPortfolio" | "pctCash";

export const SIZING_MODES: { key: SizingMode; label: string }[] = [
  { key: "amount", label: "Dollar Amount" },
  { key: "quantity", label: "Shares" },
  { key: "pctPortfolio", label: "% of Portfolio" },
  { key: "pctCash", label: "% of Cash" },
];

const PLACEHOLDER: Record<SizingMode, string> = {
  amount: "2,500",
  quantity: "10",
  pctPortfolio: "5",
  pctCash: "25",
};

const SUFFIX: Record<SizingMode, string | null> = {
  amount: null, // the currency code is shown instead
  quantity: "shares",
  pctPortfolio: "%",
  pctCash: "%",
};

/**
 * State 2B — revealed only when the user picks Manual Allocation. Four ways to
 * express the same number, and a live readout of what that number does. The
 * readout is deliberately the *derived consequences* of the input (shares,
 * resulting weight, cash left, whether it breaches the concentration cap) and
 * nothing else: full before/after portfolio analytics live in the collapsed
 * "Full Portfolio Impact" section below, not here.
 */
export function ManualAllocation({
  mode,
  onModeChange,
  value,
  onValueChange,
  currency,
  price,
  shares,
  weightAfter,
  cashRemaining,
  maxHoldingPct,
  loading,
}: {
  mode: SizingMode;
  onModeChange: (mode: SizingMode) => void;
  value: string;
  onValueChange: (value: string) => void;
  currency: string;
  price: number | null;
  shares: number | null;
  weightAfter: number | null;
  cashRemaining: number | null;
  maxHoldingPct: number;
  loading?: boolean;
}) {
  const withinCap = weightAfter != null ? weightAfter <= maxHoldingPct : null;
  const suffix = SUFFIX[mode];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div
        role="group"
        aria-label="Choose how to size this purchase"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-xs font-medium"
      >
        {SIZING_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              onModeChange(m.key);
              onValueChange("");
            }}
            aria-pressed={mode === m.key}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              mode === m.key ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="relative">
        {mode === "amount" && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
        )}
        <Input
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          autoFocus
          aria-label={SIZING_MODES.find((m) => m.key === mode)!.label}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={PLACEHOLDER[mode]}
          className={`text-base ${mode === "amount" ? "pl-7" : ""} ${suffix || mode === "amount" ? "pr-16" : ""}`}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">
          {mode === "amount" ? currency : suffix}
        </span>
      </div>

      {mode !== "quantity" && shares != null && (
        <span className="-mt-1 text-[11px] text-muted">
          ≈{shares.toLocaleString(undefined, { maximumFractionDigits: 4 })} shares
          {price != null && ` at ${formatCurrency(price, currency)}/share`}
        </span>
      )}

      <div className={`grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/60 pt-3 transition-opacity sm:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
        <Stat label="New portfolio weight" value={weightAfter != null ? `${weightAfter.toFixed(2)}%` : "—"} />
        <Stat
          label="Cash remaining"
          value={cashRemaining != null ? formatCurrency(cashRemaining, currency) : "—"}
          tone={cashRemaining != null && cashRemaining < 0 ? "negative" : undefined}
        />
        <Stat
          label={`Within ${maxHoldingPct}% limit`}
          value={withinCap == null ? "—" : withinCap ? "Yes" : "No"}
          tone={withinCap == null ? undefined : withinCap ? "positive" : "negative"}
        />
      </div>
    </Card>
  );
}
