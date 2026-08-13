"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { factorContributors, type AllocationSlice, type AllocationView, type PortfolioAllocation } from "@/lib/portfolio/engines/allocation";
import { FACTOR_SHOCK_UNIT, type Holding } from "@/lib/portfolio/model/types";

/**
 * Allocation, on five dimensions instead of one.
 *
 * The old dashboard had exactly one breakdown: GICS sector. That view cannot say
 * "I am 70% equities", "I am 100% USD", or "I cannot sell 40% of this for a year" —
 * which are the three facts that dominate most real portfolio decisions.
 *
 * Every row here is a DRILL-DOWN, not a label (2026-08-10 audit): "Technology
 * 39.9%" must be able to answer "which holdings?", and "46.2% unclassified" must
 * be able to answer "which, and why?" — inline, without leaving the dashboard.
 * The dashboard is a navigation layer into the portfolio, not a static report.
 */

/**
 * Categorical palette — 8 hues, fixed order, validated against this app's dark
 * card surface (bg-surface-2, #1a1d23) with the dataviz skill's validator: passes
 * the lightness band, chroma floor, CVD-adjacent separation (worst pair ΔE 8.4,
 * the legal floor for a categorical set carrying a legend as secondary encoding),
 * the normal-vision floor (worst pair ΔE 19.3, well above the 15 minimum), and
 * 3:1+ contrast against the surface for every slot. Re-verified for light mode
 * (2026-08-08 audit): every slot also clears 3:1 on white (worst #c98500 at
 * 3.07), so the set is genuinely theme-neutral and deliberately NOT swapped.
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

/** The hatch pattern the "unclassified" swatch and bar segment share. */
const HATCH =
  "[background-image:repeating-linear-gradient(45deg,transparent,transparent_1px,color-mix(in_srgb,var(--foreground)_25%,transparent)_1px,color-mix(in_srgb,var(--foreground)_25%,transparent)_2px)]";

type HoldingMap = Map<string, Holding>;

/**
 * Why a holding was (or could not be) classified on a dimension. Only geography
 * carries a first-class provenance attribute today; the other dimensions fall
 * back to an honest generic reason for the unclassified drill-down.
 */
function classificationBasis(h: Holding, dimension: string): string | null {
  if (dimension === "geography") return h.attributes.geographyBasis ?? null;
  return null;
}

function unclassifiedReason(h: Holding, dimension: string, dimLabel: string): string {
  return classificationBasis(h, dimension) ?? `No ${dimLabel.toLowerCase()} data available for this holding.`;
}

/** One holding inside an expanded slice: link into Research when it has a ticker. */
function MemberRow({ h, detail }: { h: Holding; detail: string | null }) {
  return (
    <li className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[11px]">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {h.symbol ? (
            <Link
              href={`/research?symbol=${encodeURIComponent(h.symbol)}`}
              className="rounded-sm font-mono font-medium text-foreground hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {h.symbol}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground">{h.name}</span>
          )}
          {h.symbol && h.name && h.name.toUpperCase() !== h.symbol.toUpperCase() && (
            <span className="truncate text-muted/60">{h.name}</span>
          )}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted">
          {h.weight.toFixed(1)}% · {formatCurrency(h.valuation.valueBase)}
        </span>
      </div>
      {detail && <p className="text-[10px] leading-snug text-muted/50">{detail}</p>}
    </li>
  );
}

/**
 * The expanded body of a slice: a reconciliation HEADER first (so "what am I
 * looking at" is answered before the list starts), then its member holdings,
 * largest first. The header is the bridge between the two questions the panel
 * answers — the bar says "how is the portfolio distributed", the members say
 * "what specifically creates this distribution", and the header states that
 * the second sums to the first.
 */
function SliceMembers({
  ids,
  byId,
  dimension,
  showBasis,
  note,
}: {
  ids: string[];
  byId: HoldingMap;
  dimension: string;
  showBasis: boolean;
  /** Extra context for slices that need it (broad funds, intentional unclassified). */
  note?: React.ReactNode;
}) {
  const dimLabel = DIMENSION_LABEL[dimension] ?? dimension;
  const members = ids.map((id) => byId.get(id)).filter((h): h is Holding => h != null);
  if (members.length === 0) {
    return <p className="ml-6 mt-1 text-[11px] text-muted/70">Holding details unavailable.</p>;
  }
  const sumW = members.reduce((s, h) => s + h.weight, 0);
  const sumV = members.reduce((s, h) => s + h.valuation.valueBase, 0);
  return (
    <div className="ml-[7px] mt-1 flex flex-col gap-1 border-l border-border/60 pb-1 pl-3.5">
      {members.length > 1 && (
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted/60">
          {members.length} holdings ·{" "}
          <span className="font-mono tabular-nums">
            {sumW.toFixed(1)}% · {formatCurrency(sumV)}
          </span>
        </p>
      )}
      {note && <div className="text-[10px] leading-snug text-muted/60">{note}</div>}
      <ul className="flex flex-col gap-1">
        {members.map((h) => (
          <MemberRow
            key={h.id}
            h={h}
            detail={showBasis ? unclassifiedReason(h, dimension, dimLabel) : null}
          />
        ))}
      </ul>
    </div>
  );
}

/** Shared expandable-row chrome: chevron, swatch, label, count, weight/value. */
function SliceRow({
  swatch,
  label,
  labelClass = "text-foreground",
  count,
  right,
  open,
  onToggle,
  children,
}: {
  swatch: React.ReactNode;
  label: string;
  labelClass?: string;
  count?: number;
  right: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-mx-1.5 flex w-[calc(100%+12px)] items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            aria-hidden
            className={`shrink-0 text-[9px] text-muted/60 transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          {swatch}
          <span className={`truncate ${labelClass}`}>{label}</span>
          {count != null && <span className="shrink-0 text-muted/60">({count})</span>}
        </span>
        <span className="shrink-0 font-mono tabular-nums text-muted">{right}</span>
      </button>
      {open && children}
    </li>
  );
}

/** A horizontal stacked bar — reads better than a pie for comparing weights. */
function AllocationBar({
  view,
  title,
  hint,
  byId,
}: {
  view: AllocationView;
  title: string;
  hint?: string;
  byId: HoldingMap;
}) {
  // Which rows are expanded. Keyed by slice key ("__unclassified" for the
  // remainder row) so toggling one row never disturbs another.
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const unclassifiedPct = view.unclassifiedPct;

  if (view.slices.length === 0 && unclassifiedPct <= 0.05) {
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
  // below it. The "+N more" row now EXPANDS in place to the full remaining list
  // (each row a drill-down like any other) instead of leaving the reader to
  // wonder what is hidden.
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
  // has no sector". A part-to-whole chart whose parts do not sum to the whole
  // is the most basic way to mislead with one, so the remainder is drawn and
  // labelled like every other category — and, since the 46.2%-unclassified
  // audit, it opens to show exactly WHICH holdings it is and WHY each one
  // could not be classified.
  const classifiedTotal = shown.reduce((s, x) => s + x.weight, 0) + restWeight;

  // "Diversified" on the sector bar is NOT a sector — it is the wrapper-level
  // slice broad funds are honestly filed under (their true sector spread is the
  // Intelligence tab's look-through). Saying so at the row, not only in the
  // panel hint, because "Diversified 30.8%" read alone invites the opposite
  // conclusion: that a third of the book is genuinely spread across sectors.
  const isBroadFunds = (s: AllocationSlice) => view.dimension === "sector" && s.label === "Diversified";

  const renderSlice = (s: AllocationSlice, i: number | null) => (
    <SliceRow
      key={s.key}
      swatch={
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-sm ${i == null || colorFor(i) == null ? "bg-muted/40" : ""}`}
          style={i != null && colorFor(i) != null ? { backgroundColor: colorFor(i)! } : undefined}
        />
      }
      label={isBroadFunds(s) ? "Diversified (broad funds)" : s.label}
      count={s.count}
      right={`${s.weight.toFixed(1)}% · ${formatCurrency(s.value)}`}
      open={open.has(s.key)}
      onToggle={() => toggle(s.key)}
    >
      <SliceMembers
        ids={s.holdingIds ?? []}
        byId={byId}
        dimension={view.dimension}
        showBasis={view.dimension === "geography"}
        note={
          isBroadFunds(s) ? (
            <>
              These are broad funds counted as ONE slice — this is wrapper-level exposure,
              not a sector. Their underlying sector spread is on the{" "}
              <Link
                href="/portfolio?tab=intelligence"
                className="text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Intelligence tab&apos;s look-through
              </Link>
              .
            </>
          ) : undefined
        }
      />
    </SliceRow>
  );

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
            // Hatch stripes derive from --foreground so they read as "lighter
            // than the bar" in dark AND "darker than the bar" in light — the
            // old rgb(255 255 255/…) stripes vanished on a white canvas.
            className="bg-muted/15 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,color-mix(in_srgb,var(--foreground)_12%,transparent)_2px,color-mix(in_srgb,var(--foreground)_12%,transparent)_4px)]"
            style={{ width: `${unclassifiedPct}%` }}
            title={`Not classified on this dimension: ${unclassifiedPct.toFixed(1)}%`}
          />
        )}
      </div>

      <ul className="flex flex-col gap-0.5">
        {shown.map((s, i) => renderSlice(s, i))}

        {/* The overflow: one honest rollup row that expands to the COMPLETE
            remaining list, rather than leaving "+4 more" as a dead end. */}
        {rest.length > 0 && !showAll && (
          <li>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              aria-expanded={false}
              className="-mx-1.5 flex w-[calc(100%+12px)] items-center justify-between gap-2 rounded-md px-1.5 py-1 text-left text-xs text-muted/70 transition-colors hover:bg-surface-2/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="shrink-0 text-[9px] text-muted/60">▶</span>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-sm bg-muted/40" />
                Show {rest.length} more ({restCount} holdings)
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {restWeight.toFixed(1)}% · {formatCurrency(restValue)}
              </span>
            </button>
          </li>
        )}
        {rest.length > 0 && showAll && (
          <>
            {rest.map((s) => renderSlice(s, null))}
            <li>
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="-mx-1.5 rounded-md px-1.5 py-1 text-left text-[11px] text-brand transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Show fewer
              </button>
            </li>
          </>
        )}

        {/* Named for what it IS — "no sector", not "Unknown" — so it is never
            mistaken for a category the portfolio is actually allocated to. And
            expandable like every other row: an unexplained "46.2% unclassified"
            was the single most distrust-inducing row on the dashboard, so this
            opens into the exact holdings and each one's reason.

            For GEOGRAPHY, when every member carries a stated classification
            basis, the row says "intentionally unclassified": cash has no
            country by design and a multi-region fund is not forced into one —
            that is a modelling decision, not missing data, and a row that
            reads like broken data undermines every figure around it. */}
        {unclassifiedPct > 0.05 && (() => {
          const members = (view.unclassifiedIds ?? [])
            .map((id) => byId.get(id))
            .filter((h): h is Holding => h != null);
          const intentional =
            view.dimension === "geography" &&
            members.length > 0 &&
            members.every((h) => classificationBasis(h, view.dimension) != null);
          return (
            <SliceRow
              swatch={<span aria-hidden className={`h-2 w-2 shrink-0 rounded-sm bg-muted/15 ${HATCH}`} />}
              label={intentional ? "Intentionally unclassified" : "Not applicable / unclassified"}
              labelClass="italic text-muted/70"
              count={view.unclassifiedIds?.length}
              right={`${unclassifiedPct.toFixed(1)}%`}
              open={open.has("__unclassified")}
              onToggle={() => toggle("__unclassified")}
            >
              <SliceMembers
                ids={view.unclassifiedIds ?? []}
                byId={byId}
                dimension={view.dimension}
                showBasis
                note={
                  view.dimension === "geography" ? (
                    <>
                      Cash has no geographic exposure by design (its currency exposure is in the
                      Currency bar), and a diversified multi-region fund is not forced into one
                      country. Each holding&apos;s classification basis is stated below.
                    </>
                  ) : undefined
                }
              />
            </SliceRow>
          );
        })()}
      </ul>

      {hint && <p className="text-[11px] text-muted/70">{hint}</p>}
    </div>
  );
}

export function AllocationPanel({
  allocation,
  holdings,
}: {
  allocation: PortfolioAllocation;
  /** The report's own holdings — what the expanded rows join against. */
  holdings: Holding[];
}) {
  const byId = useMemo<HoldingMap>(() => new Map(holdings.map((h) => [h.id, h])), [holdings]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-5 p-5">
        <AllocationBar view={allocation.byAssetClass} title="By asset class" byId={byId} />
        <AllocationBar
          view={allocation.bySector}
          title="By sector"
          byId={byId}
          hint="Broad funds count as one Diversified slice here; their look-through sector spread is on the Intelligence tab."
        />
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
          byId={byId}
          hint="Single names by issuer country; funds by their mandate's investment region. Expand a row to see each holding and the basis for its classification."
        />
        <AllocationBar view={allocation.byCurrency} title="By currency" byId={byId} />
      </Card>

      <Card className="flex flex-col gap-5 p-5 lg:col-span-2">
        <AllocationBar
          view={allocation.byLiquidity}
          title="By liquidity"
          byId={byId}
          hint="How much of the portfolio you could actually act on in a drawdown."
        />
      </Card>
    </div>
  );
}

/** The shock each factor's exposure is measured against, in words. */
function shockPhrase(factor: string, label: string): string {
  const unit = FACTOR_SHOCK_UNIT[factor as keyof typeof FACTOR_SHOCK_UNIT];
  if (unit === "pp") return `a +1 percentage-point shock to ${label.toLowerCase()}`;
  if (unit === "severity") return `a full ${label.toLowerCase()} event`;
  return `a +1% move in ${label.toLowerCase()}`;
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
 *
 * Each tile EXPANDS (2026-08-11 pass): "+1.33" is a sensitivity, and a
 * sensitivity without its shock definition and its contributing holdings is a
 * number the reader has to take on faith. The expansion states both, using the
 * same per-holding terms the engine summed (factorContributors).
 */
export function MacroFactorPanel({
  allocation,
  holdings = [],
  onOpenRiskLab,
}: {
  allocation: PortfolioAllocation;
  /** The report's holdings — lets each factor name its top contributors. */
  holdings?: Holding[];
  /** Hands off into the Risk Lab tab, whose stress tests use these exposures. */
  onOpenRiskLab?: () => void;
}) {
  const [openFactor, setOpenFactor] = useState<string | null>(null);
  const factors = allocation.byFactor
    .filter((f) => Math.abs(f.exposure) >= 0.05)
    .sort((a, b) => Math.abs(b.exposure) - Math.abs(a.exposure))
    .slice(0, 6);

  if (factors.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Macro factor exposure
          </h4>
          <p className="mt-1 text-[11px] text-muted/70">
            Expected % move of the whole portfolio per unit shock to each factor.
            Click a factor for what that means and which holdings create it.
          </p>
        </div>
        {onOpenRiskLab && (
          <button
            type="button"
            onClick={onOpenRiskLab}
            className="shrink-0 rounded-sm text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Stress-test these in Risk Lab →
          </button>
        )}
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {factors.map((f) => {
          const positive = f.exposure > 0;
          const magnitude = Math.min(Math.abs(f.exposure) * 12, 100);
          const open = openFactor === f.factor;
          const contributors = open ? factorContributors(holdings, f.factor) : [];
          return (
            <li key={f.factor} className="flex flex-col rounded-lg border border-border bg-surface/40">
              <button
                type="button"
                onClick={() => setOpenFactor(open ? null : f.factor)}
                aria-expanded={open}
                className="flex flex-col gap-1 rounded-lg p-2.5 text-left transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
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
              </button>
              {open && (
                <div className="flex flex-col gap-1 border-t border-border/60 p-2.5 text-[10px] leading-snug text-muted/70">
                  <p>
                    {shockPhrase(f.factor, f.label)} moves this portfolio about{" "}
                    <strong className={positive ? "text-positive" : "text-negative"}>
                      {positive ? "+" : ""}{f.exposure.toFixed(2)}%
                    </strong>
                    . The Risk Lab&apos;s scenarios are combinations of exactly these shocks.
                  </p>
                  {contributors.length > 0 && (
                    <p>
                      Mostly from{" "}
                      {contributors
                        .map((c) => `${c.symbol ?? c.name} (${c.contribution > 0 ? "+" : ""}${c.contribution.toFixed(2)})`)
                        .join(", ")}
                      .
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
