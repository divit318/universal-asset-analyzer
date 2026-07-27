import { computeHoldingsOverlap } from "@/lib/compare/holdings-overlap";
import type { ClassCompareEntry } from "@/lib/compare/types";

/**
 * "Are these two funds actually different exposure, or the same mega-caps
 * wearing different tickers?" — computed entirely from each fund's disclosed
 * top holdings (already fetched, no new provider). See
 * lib/compare/holdings-overlap.ts for the overlap-% definition and its
 * top-holdings-only caveat.
 */
export function HoldingsOverlapSection({ entries, colors }: { entries: ClassCompareEntry[]; colors: readonly string[] }) {
  const overlap = computeHoldingsOverlap(entries);
  if (!overlap) return null;

  const colorOf = (symbol: string) => colors[entries.findIndex((e) => e.symbol === symbol) % colors.length];

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between bg-surface-2 px-4 py-3">
        <div>
          <span className="text-sm font-semibold">Portfolio Overlap</span>
          <span className="ml-2 text-caption text-muted">based on disclosed top holdings</span>
        </div>
        {overlap.pairOverlapPercent != null && (
          <span className="font-mono text-lg font-bold text-brand">{overlap.pairOverlapPercent}%</span>
        )}
      </div>
      <div className="flex flex-col gap-4 border-t border-border bg-surface p-4">
        {overlap.shared.length > 0 && (
          <div>
            <p className="mb-2 text-label font-semibold uppercase tracking-widest text-muted/60">Shared holdings</p>
            <ul className="flex flex-col gap-1.5">
              {overlap.shared.map((s) => (
                <li key={s.symbol} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-foreground">{s.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {Object.entries(s.weights)
                      .map(([sym, w]) => `${sym} ${w.toFixed(1)}%`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${overlap.perFund.length}, minmax(0, 1fr))` }}>
          {overlap.perFund.map((f) => (
            <div key={f.symbol}>
              <p className="font-mono text-sm font-bold" style={{ color: colorOf(f.symbol) }}>
                Unique to {f.symbol}
              </p>
              {f.unique.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1">
                  {f.unique.map((u) => (
                    <li key={u.symbol} className="text-xs text-foreground/80">
                      {u.name} <span className="text-muted">({u.weightPercent.toFixed(1)}%)</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-xs text-muted">No holdings unique to this fund among its disclosed top 10.</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
