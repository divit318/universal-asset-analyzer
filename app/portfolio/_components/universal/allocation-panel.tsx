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

/**
 * Human label for an `AllocationView.dimension`.
 *
 * The dimension has to appear next to the HHI — a bare "HHI" collides with the Risk
 * Lab's position-level HHI, which reads 689 while the asset-class one reads 3440 —
 * but the raw field is a camelCase identifier, and "assetClass HHI 3440" is a
 * developer's variable name on a user's screen.
 */
const DIMENSION_LABEL: Record<string, string> = {
  assetClass: "Class",
  sector: "Sector",
  geography: "Region",
  currency: "Currency",
  liquidity: "Liquidity",
};

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

  // The unclassified remainder is a SEGMENT, not just a footnote.
  //
  // `groupBy` routes value it cannot key into `unclassifiedPct` and creates no
  // slice for it, so the bar's segments summed to only the classified share —
  // a book that is 45% bonds, crypto and cash rendered a sector bar 55% full
  // and 45% empty track, which reads as "no data here" rather than "this 45%
  // has no sector". The legend rows had the same gap: they summed to 55% with
  // nothing accounting for the difference. A part-to-whole chart whose parts do
  // not sum to the whole is the most basic way to mislead with one, so the
  // remainder is now drawn and labelled like every other category.
  const unclassifiedPct = view.unclassifiedPct;
  const classifiedTotal = shown.reduce((s, x) => s + x.weight, 0) + restWeight;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h4>
        {/* Concentration on THIS dimension, not just overall.
            Stated as "of classified" because that is what it measures: the
            weights fed to computeHHI are shares of TOTAL value, so a dimension
            with a large unclassified share yields a LOWER (more diversified-
            looking) HHI than its classified holdings actually justify. Saying so
            is cheaper than silently under-reporting concentration. */}
        <span
          className="cursor-help font-mono text-[11px] tabular-nums text-muted/70"
          title={
            unclassifiedPct > 1
              ? `Herfindahl-Hirschman Index over the ${classifiedTotal.toFixed(0)}% of value classified on this dimension. Below 1500 is diversified, above 2500 is concentrated. The ${unclassifiedPct.toFixed(0)}% unclassified is not counted, so true concentration is at least this high.`
              : "Herfindahl-Hirschman Index, 0-10000. Below 1500 is diversified, above 2500 is concentrated."
          }
        >
          {/* Qualified by DIMENSION, never a bare "HHI". The Risk Lab shows a
              position-level HHI, and on the real book that read 689 ("Low") beside
              this one's 3440 — both correct, both labelled "HHI", on one page. */}
          {DIMENSION_LABEL[view.dimension] ?? view.dimension} HHI {view.hhi}
          {unclassifiedPct > 1 && <span className="text-muted/50"> of {classifiedTotal.toFixed(0)}%</span>}
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
        {unclassifiedPct > 0.05 && (
          <div
            // Hatched rather than a flat tone, so it never reads as a real
            // category the way a solid grey segment would.
            className="bg-muted/15 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgb(255_255_255/0.12)_2px,rgb(255_255_255/0.12)_4px)]"
            style={{ width: `${unclassifiedPct}%` }}
            title={`Not classified on this dimension: ${unclassifiedPct.toFixed(1)}%`}
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
        {/* Named for what it IS — "no sector", not "Unknown" — so it is never
            mistaken for a category the portfolio is actually allocated to. */}
        {unclassifiedPct > 0.05 && (
          <li className="flex items-center justify-between gap-2 text-xs text-muted/70">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-sm bg-muted/15 [background-image:repeating-linear-gradient(45deg,transparent,transparent_1px,rgb(255_255_255/0.25)_1px,rgb(255_255_255/0.25)_2px)]"
              />
              <span className="truncate italic">Not applicable / unclassified</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">{unclassifiedPct.toFixed(1)}%</span>
          </li>
        )}
      </ul>

      {hint && <p className="text-[11px] text-muted/70">{hint}</p>}
    </div>
  );
}

export function AllocationPanel({ allocation }: { allocation: PortfolioAllocation }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-5 p-5">
        <AllocationBar view={allocation.byAssetClass} title="By asset class" />
        <AllocationBar view={allocation.bySector} title="By sector" />
      </Card>

      <Card className="flex flex-col gap-5 p-5">
        {/* Geography was computed by the allocation engine, SCORED as a health
            dimension ("Geographic Diversification") and used by the
            recommendation engine to raise an international-exposure gap — and
            rendered nowhere. The user was being graded and advised on a
            breakdown they had no way to look at. */}
        <AllocationBar
          view={allocation.byGeography}
          title="By geography"
          hint="Where the underlying businesses and assets are, not where they are listed."
        />
        <AllocationBar view={allocation.byCurrency} title="By currency" />
      </Card>

      <Card className="flex flex-col gap-5 p-5 lg:col-span-2">
        <AllocationBar
          view={allocation.byLiquidity}
          title="By liquidity"
          hint="How much of the portfolio you could actually act on in a drawdown."
        />
      </Card>
    </div>
  );
}

/**
 * Factor exposure — the replacement for the old sector-keyed factor map, which
 * assigned ZERO exposure to every bond, commodity and crypto holding.
 *
 * Rendered separately from `AllocationPanel` rather than as its sixth card: the
 * five bars above it answer "what is this made of", which the dashboard's opening
 * narrative makes claims about and so must be verifiable early, while this answers
 * "what will move it next" and belongs at the end of the scroll, handing off into
 * the Risk Lab tab that computes its stress tests from these same exposures.
 */
export function MacroFactorPanel({ allocation }: { allocation: PortfolioAllocation }) {
  const factors = allocation.byFactor
    .filter((f) => Math.abs(f.exposure) >= 0.05)
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure))
    .slice(0, 6);

  if (factors.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-5">
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
  );
}
