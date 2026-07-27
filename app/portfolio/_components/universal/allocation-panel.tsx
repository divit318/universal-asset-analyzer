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

/**
 * Categorical palette — 8 hues, fixed order, validated against this app's dark
 * card surface (bg-surface-2, #1a1d23) with the dataviz skill's validator: passes
 * the lightness band, chroma floor, CVD-adjacent separation (worst pair ΔE 8.4,
 * the legal floor for a categorical set carrying a legend as secondary encoding),
 * the normal-vision floor (worst pair ΔE 19.3, well above the 15 minimum), and
 * 3:1+ contrast against the surface for every slot.
 *
 * Assigned POSITIONALLY (slice order — every AllocationView is pre-sorted by
 * weight descending) and NEVER cycled: slot i always means "the i-th largest
 * slice in THIS breakdown," so two adjacent segments in the same bar are never
 * within a few degrees of hue of each other. Capped at 8 — the same cap the
 * legend below already applies — because re-cycling the 8 hues for a 9th+ slice
 * would silently reintroduce the near-duplicate colors this palette exists to
 * eliminate; the overflow instead folds into one neutral "+N more" segment that
 * matches the legend's own rollup row exactly.
 */
const CATEGORICAL_HEX = [
  "#3987e5", // blue
  "#008300", // green
  "#d55181", // magenta
  "#c98500", // yellow
  "#199e70", // aqua
  "#d95926", // orange
  "#9085e9", // violet
  "#e66767", // red
];

/** Slices beyond this fold into one neutral segment/row — kept in one place so the bar and the legend below it can never disagree about where the cutoff is. */
const VISIBLE_SLICES = 8;

/** Hex for slot `i`, or `null` past the cap (render with the neutral "more" tone instead). */
function colorFor(i: number): string | null {
  return i < CATEGORICAL_HEX.length ? CATEGORICAL_HEX[i] : null;
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

  // Show every slice up to the shared cap; beyond it, roll the remainder into
  // one honest "+N more" segment/row rather than silently dropping it — with 12
  // asset classes a fixed 6-row cutoff hid half the portfolio's classes with no
  // indication anything was missing. The bar and the legend slice the SAME array
  // at the SAME cap, so a segment in the bar always has exactly one matching row
  // below it — previously the bar rendered every slice while the legend capped
  // at 8, so a portfolio with 9+ categories had bar segments with no legend entry.
  const shown = view.slices.slice(0, VISIBLE_SLICES);
  const rest = view.slices.slice(VISIBLE_SLICES);
  const restWeight = rest.reduce((s, x) => s + x.weight, 0);
  const restValue = rest.reduce((s, x) => s + x.value, 0);
  const restCount = rest.reduce((s, x) => s + x.count, 0);

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
        {shown.map((s, i) => (
          <div
            key={s.key}
            style={{ width: `${s.weight}%`, backgroundColor: colorFor(i)! }}
            title={`${s.label}: ${s.weight.toFixed(1)}%`}
          />
        ))}
        {restWeight > 0 && (
          <div
            className="bg-muted/40"
            style={{ width: `${restWeight}%` }}
            title={`${rest.length} more: ${restWeight.toFixed(1)}%`}
          />
        )}
      </div>

      <ul className="flex flex-col gap-1">
        {shown.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: colorFor(i)! }} />
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
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm bg-muted/40" />
              +{rest.length} more ({restCount} holdings)
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {restWeight.toFixed(1)}% · {formatCurrency(restValue)}
            </span>
          </li>
        )}
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
