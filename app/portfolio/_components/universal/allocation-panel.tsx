"use client";

import { Card } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { AllocationView, PortfolioAllocation } from "@/lib/portfolio/engines/allocation";

/**
 * Allocation, on five dimensions instead of one.
 *
 * The old dashboard had exactly one breakdown: GICS sector. That view cannot say
 * "I am 70% equities", "I am 100% USD", or "I cannot sell 40% of this for a year" —
 * which are the three facts that dominate most real portfolio decisions.
 */

const CLASS_COLOR: Record<string, string> = {
  equity: "bg-brand",
  etf: "bg-sky-400",
  reit: "bg-teal-400",
  bond: "bg-emerald-400",
  crypto: "bg-amber-400",
  commodity: "bg-yellow-500",
  forex: "bg-cyan-400",
  cash: "bg-zinc-400",
  real_estate: "bg-orange-400",
  private_market: "bg-purple-400",
  alternative: "bg-pink-400",
  structured_product: "bg-indigo-400",
};

const FALLBACK = [
  "bg-brand", "bg-sky-400", "bg-emerald-400", "bg-amber-400", "bg-purple-400",
  "bg-teal-400", "bg-pink-400", "bg-orange-400", "bg-cyan-400", "bg-zinc-400",
];

function colorFor(view: AllocationView, key: string, i: number): string {
  if (view.dimension === "assetClass") return CLASS_COLOR[key] ?? FALLBACK[i % FALLBACK.length];
  return FALLBACK[i % FALLBACK.length];
}

/** A horizontal stacked bar — reads better than a pie for comparing weights. */
function AllocationBar({ view, title, hint }: { view: AllocationView; title: string; hint?: string }) {
  if (view.slices.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        <p className="text-xs text-muted">No data.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {/* Concentration on THIS dimension, not just overall. */}
        <span className="font-mono text-[11px] tabular-nums text-muted/70">
          HHI {view.hhi}
        </span>
      </div>

      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        {view.slices.map((s, i) => (
          <div
            key={s.key}
            className={colorFor(view, s.key, i)}
            style={{ width: `${s.weight}%` }}
            title={`${s.label}: ${s.weight.toFixed(1)}%`}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-1">
        {(() => {
          // Show every slice up to a generous cap; beyond it, roll the remainder
          // into one honest "+N more" line rather than silently dropping rows —
          // with 12 asset classes a fixed 6-row cutoff hid half the portfolio's
          // classes with no indication anything was missing.
          const VISIBLE = 8;
          const shown = view.slices.slice(0, VISIBLE);
          const rest = view.slices.slice(VISIBLE);
          const restWeight = rest.reduce((s, x) => s + x.weight, 0);
          const restValue = rest.reduce((s, x) => s + x.value, 0);
          const restCount = rest.reduce((s, x) => s + x.count, 0);

          return (
            <>
              {shown.map((s, i) => (
                <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm ${colorFor(view, s.key, i)}`} />
                    <span className="truncate text-foreground">{s.label}</span>
                    <span className="shrink-0 text-muted/60">({s.count})</span>
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-muted">
                    {s.weight.toFixed(1)}% · {formatCurrency(s.value)}
                  </span>
                </li>
              ))}
              {rest.length > 0 && (
                <li className="flex items-center justify-between gap-2 text-xs text-muted/70">
                  <span>+{rest.length} more ({restCount} holdings)</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {restWeight.toFixed(1)}% · {formatCurrency(restValue)}
                  </span>
                </li>
              )}
            </>
          );
        })()}
      </ul>

      {/* We say when a breakdown is incomplete rather than lumping the remainder
          into "Unknown" and presenting it as if it were a real category. */}
      {view.unclassifiedPct > 1 && (
        <p className="text-[11px] text-muted/70">
          {view.unclassifiedPct.toFixed(0)}% unclassified on this dimension.
        </p>
      )}
      {hint && <p className="text-[11px] text-muted/70">{hint}</p>}
    </div>
  );
}

export function AllocationPanel({ allocation }: { allocation: PortfolioAllocation }) {
  const factors = allocation.byFactor
    .filter((f) => Math.abs(f.exposure) >= 0.05)
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure))
    .slice(0, 6);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-5 p-5">
        <AllocationBar view={allocation.byAssetClass} title="By asset class" />
        <AllocationBar view={allocation.bySector} title="By sector" />
      </Card>

      <Card className="flex flex-col gap-5 p-5">
        <AllocationBar view={allocation.byCurrency} title="By currency" />
        <AllocationBar
          view={allocation.byLiquidity}
          title="By liquidity"
          hint="How much of the portfolio you could actually act on in a drawdown."
        />
      </Card>

      {/* Factor exposure — the replacement for the old sector-keyed factor map, which
          assigned ZERO exposure to every bond, commodity and crypto holding. */}
      {factors.length > 0 && (
        <Card className="flex flex-col gap-3 p-5 lg:col-span-2">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Macro factor exposure
            </h4>
            <p className="mt-1 text-[11px] text-muted/70">
              How the portfolio moves per unit shock to each factor. This is what the
              stress tests are computed from.
            </p>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {factors.map((f) => {
              const positive = f.exposure > 0;
              const magnitude = Math.min(Math.abs(f.exposure) * 12, 100);
              return (
                <li key={f.factor} className="flex flex-col gap-1 rounded-lg border border-border bg-surface/40 p-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs text-foreground">{f.label}</span>
                    <span className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${positive ? "text-positive" : "text-negative"}`}>
                      {positive ? "+" : ""}{f.exposure.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${positive ? "bg-positive/70" : "bg-negative/70"}`}
                      style={{ width: `${magnitude}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
