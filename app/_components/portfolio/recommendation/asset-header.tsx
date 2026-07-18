import { Card } from "@/app/_components/ui";
import { formatCurrency, formatPercent } from "@/lib/format";
import { detectMarket, MARKET_LABEL } from "@/lib/market";
import { detectPortfolioAssetClass, PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import { estimateMarketStatus } from "@/lib/market-hours";
import type { Quote } from "@/lib/types";
import type { Holding } from "@/lib/portfolio/model/types";

/** Section 1 — everything about the asset itself, auto-detected, never asked of the user. */
export function AssetHeader({ quote, existingHolding }: { quote: Quote; existingHolding: Holding | null }) {
  const market = detectMarket(quote);
  const assetClass = detectPortfolioAssetClass(quote.assetType);
  const status = estimateMarketStatus(market);
  const positive = quote.change >= 0;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold">{quote.symbol}</span>
          <span className="text-xs text-muted">{quote.name}</span>
        </div>
        <span
          className={`rounded-control border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            status === "open" ? "border-positive/30 bg-positive/10 text-positive" : "border-border bg-surface-2 text-muted"
          }`}
          title="Approximate — standard exchange hours, no holiday calendar"
        >
          {status === "open" ? "Market open" : "Market closed"}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="font-mono text-lg font-bold">{formatCurrency(quote.price, quote.currency)}</span>
        <span className={`text-xs font-medium ${positive ? "text-positive" : "text-negative"}`}>
          {positive ? "+" : ""}{formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-4">
        <Field label="Asset class" value={PORTFOLIO_CLASS_LABEL[assetClass]} />
        <Field label="Exchange" value={quote.exchange ?? MARKET_LABEL[market]} />
        <Field label="Currency" value={quote.currency} />
        <Field label="Market" value={MARKET_LABEL[market]} />
      </div>

      {existingHolding && existingHolding.quantity > 0 && (
        <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs">
          <span className="text-muted">
            Existing holding: {existingHolding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} sh
            ({formatCurrency(existingHolding.valuation.valueBase)})
          </span>
          <span className="font-mono font-semibold">{existingHolding.weight.toFixed(1)}% of portfolio</span>
        </div>
      )}
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-label uppercase tracking-widest text-muted/70">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
