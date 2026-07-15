import type { FundHolding } from "@/lib/types";

export function HoldingsTable({ holdings }: { holdings: FundHolding[] }) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
        Holdings data unavailable for this fund.
      </div>
    );
  }

  const top10Weight = holdings.slice(0, 10).reduce((s, h) => s + h.weightPercent, 0);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Top Holdings</h3>
        <span className="text-xs text-muted">Top 10 = {top10Weight.toFixed(1)}% of fund</span>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {holdings.slice(0, 10).map((h) => (
          <li key={h.symbol} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <span className="font-mono text-sm text-accent">{h.symbol}</span>
              <p className="truncate text-xs text-muted">{h.name}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-brand/60" style={{ width: `${Math.min(100, h.weightPercent * 4)}%` }} />
              </div>
              <span className="w-12 text-right font-mono text-xs tabular-nums">{h.weightPercent.toFixed(1)}%</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
