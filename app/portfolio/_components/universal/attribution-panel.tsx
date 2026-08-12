"use client";

/**
 * Return attribution — where the result came from, and whether that is healthy.
 *
 * The page previously had two facts about return: a total, and a per-holding P&L
 * column. Neither answers what a portfolio review actually opens with — "what is
 * carrying this, what is dragging it, and is the result broad or is it one bet?"
 *
 * The concentration-of-return figure is the reason this panel leads with a
 * sentence rather than a table. A +12% result in which three names produced 85% of
 * the movement is a materially different portfolio from a +12% result spread over
 * twenty, and the difference is invisible in any ranking. An allocator asks about
 * it before they ask anything else about a good year.
 */

import { useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency, formatPercent, formatSignedCurrency, toneClass } from "@/lib/format";
import type { Contributor, GroupContribution, ReturnAttribution } from "@/lib/portfolio/engines/attribution";
import type { HoldingDayMove } from "@/lib/portfolio/report";

/** pp = percentage points of the PORTFOLIO's return, not the position's own. */
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}pp`;

/**
 * Which figure the rows lead with. All three are already computed per
 * contributor — the toggle only changes which one is emphasized and which the
 * bars are scaled to, never the decomposition itself, so the reconciliation
 * footer stays true in every mode.
 *
 *   contribution — pp of the PORTFOLIO's return (the default; these sum to the total)
 *   return       — the position's own % return on its cost
 *   pnl          — the position's P&L in money
 */
type RowMetric = "contribution" | "return" | "pnl";

const METRIC_LABEL: Record<RowMetric, string> = {
  contribution: "Contribution",
  return: "Return",
  pnl: "P&L",
};

function metricValue(c: Contributor, metric: RowMetric): number | null {
  if (metric === "contribution") return c.contributionPct;
  if (metric === "return") return c.ownReturnPct;
  return c.pnl;
}

function metricText(c: Contributor, metric: RowMetric): string {
  if (metric === "contribution") return pp(c.contributionPct);
  if (metric === "return") return c.ownReturnPct != null ? formatPercent(c.ownReturnPct, 1) : "—";
  return formatSignedCurrency(c.pnl);
}

/**
 * A contributor row. The bar is scaled to the largest ABSOLUTE contribution in
 * the panel, so gains and losses are comparable at a glance and a −0.4pp drag is
 * visibly half a +0.8pp carry.
 *
 * The row EXPANDS into its own arithmetic — cost → value → P&L → ÷ shared cost
 * base → contribution — because "+2.08pp" is a claim, and the audit trail is
 * what turns a claim into a number the reader can check. The expansion also
 * separates TODAY's session move from the whole-period contribution: the two
 * were only distinguishable by cross-referencing the Holdings tab, and a +2pp
 * period carry that fell 3% today is exactly the case that matters.
 */
function ContributorRow({
  c,
  scale,
  totalCostBase,
  dayMove,
  metric,
}: {
  c: Contributor;
  scale: number;
  totalCostBase: number;
  dayMove: HoldingDayMove | null;
  metric: RowMetric;
}) {
  const [open, setOpen] = useState(false);
  const v = metricValue(c, metric) ?? 0;
  const width = scale > 0 ? Math.min((Math.abs(v) / scale) * 100, 100) : 0;
  const positive = v >= 0;

  return (
    <li className="flex flex-col gap-1">
      {/* flex-wrap, and the metadata is allowed to shrink.
          Four things share this row — name, weight, own return, and the money/pp
          pair — and at 390px the combination could not fit. With `shrink-0` on the
          metadata and only the name truncating, the row had a hard minimum width
          that pushed the whole card 57px past the viewport and gave the entire page
          a horizontal scrollbar on a phone. Wrapping degrades to two lines instead,
          which loses nothing. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="-mx-1 flex w-[calc(100%+8px)] flex-wrap items-baseline justify-between gap-x-2 rounded-md px-1 py-0.5 text-left text-xs transition-colors hover:bg-surface-2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            aria-hidden
            className={`shrink-0 text-[8px] text-muted/50 transition-transform ${open ? "rotate-90" : ""}`}
          >
            ▶
          </span>
          <span className="truncate font-mono font-medium text-foreground">{c.symbol ?? c.name}</span>
          {/* Weight AND own return, because weight alone makes the most
              informative rows unreadable. A written-down holding shows "0.0% wt"
              beside a −$6,950 drag, and the obvious question — how does 0% of a
              portfolio lose seven thousand dollars? — is answered only by its own
              return of −92%: it used to be a real position. */}
          <span className="whitespace-nowrap text-[10px] text-muted/60">
            {c.weight.toFixed(1)}% wt
            {/* Own return in the metadata only when it isn't already the headline figure. */}
            {c.ownReturnPct != null && metric !== "return" && (
              <span className={toneClass(c.ownReturnPct)}> · {formatPercent(c.ownReturnPct, 1)}</span>
            )}
          </span>
        </span>
        <span className="flex items-baseline gap-2 whitespace-nowrap font-mono tabular-nums">
          {/* Secondary figure: whichever of $/pp the toggle is NOT leading with,
              so the pair always shows money AND portfolio effect. */}
          <span className="text-[10px] text-muted/70">
            {metric === "pnl" ? pp(c.contributionPct) : formatSignedCurrency(c.pnl)}
          </span>
          <span className={`font-semibold ${toneClass(v)}`}>{metricText(c, metric)}</span>
        </span>
      </button>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${positive ? "bg-positive/70" : "bg-negative/70"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      {open && (
        <div className="mt-0.5 flex flex-col gap-1 rounded-lg border border-border/60 bg-surface/40 p-2.5 text-[11px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums">
            <dt className="font-sans text-muted/70">Cost basis</dt>
            <dd className="text-right text-foreground">{formatCurrency(c.costBase)}</dd>
            <dt className="font-sans text-muted/70">Current value</dt>
            <dd className="text-right text-foreground">{formatCurrency(c.valueBase)}</dd>
            <dt className="font-sans text-muted/70">P&amp;L</dt>
            <dd className={`text-right ${toneClass(c.pnl)}`}>
              {formatSignedCurrency(c.pnl)}
              {c.ownReturnPct != null && ` (${formatPercent(c.ownReturnPct, 1)} on its own cost)`}
            </dd>
            {dayMove?.dayChange && (
              <>
                <dt className="font-sans text-muted/70">Today&apos;s session</dt>
                <dd className={`text-right ${toneClass(dayMove.dayChange.value)}`}>
                  {formatPercent(dayMove.dayChange.value, 2)}
                  {dayMove.dayDollar != null && ` · ${formatSignedCurrency(dayMove.dayDollar)}`}
                </dd>
              </>
            )}
          </dl>
          {/* The actual division, spelled out. This is the whole point of the
              expansion: contribution = this position's P&L over the SAME cost
              base the portfolio's total return is measured on. */}
          <p className="border-t border-border/40 pt-1 leading-relaxed text-muted/70">
            Contribution: {formatSignedCurrency(c.pnl)} ÷ {formatCurrency(totalCostBase)} total cost
            base = <strong className={toneClass(c.contributionPct)}>{pp(c.contributionPct)}</strong> of
            the portfolio&apos;s return, over the whole holding period
            {dayMove?.dayChange ? " (today's session move above is not part of this figure's basis)" : ""}.
            {" "}This position produced {c.shareOfMovementPct.toFixed(1)}% of all the portfolio&apos;s
            gross movement.
          </p>
          {c.symbol && (
            <Link
              href={`/research?symbol=${encodeURIComponent(c.symbol)}`}
              className="self-start text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              Open {c.symbol} in Research →
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

function GroupRow({ g, scale }: { g: GroupContribution; scale: number }) {
  const width = scale > 0 ? Math.min((Math.abs(g.contributionPct) / scale) * 100, 100) : 0;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-foreground">{g.label}</span>
        <span className={`shrink-0 font-mono font-semibold tabular-nums ${toneClass(g.contributionPct)}`}>
          {pp(g.contributionPct)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${g.contributionPct >= 0 ? "bg-positive/60" : "bg-negative/60"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </li>
  );
}

/** The judgement sentence. This is the part a PM reads; the tables are the audit trail. */
function BreadthVerdict({ a }: { a: ReturnAttribution }) {
  // "Nothing has moved" is not "movement is evenly spread".
  //
  // Both leave top3SharePct at 0, and the broad/narrow bands alone read the first
  // as the second: a brand-new portfolio still exactly at cost was reported as a
  // green "Broad result" with "0.0 effective drivers" that was "broadly sourced,
  // so it reflects the portfolio rather than a handful of names". Zero drivers
  // described as diversification is self-contradictory, and it was the first thing
  // a new user would have seen on this panel.
  if (a.grossMovement <= 0) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface/40 p-3.5">
        <Badge variant="neutral">Nothing to attribute yet</Badge>
        <p className="text-[11px] leading-relaxed text-muted">
          Every holding with a recorded cost basis is sitting exactly at it, so there is no
          gain or loss to trace to a source. This fills in as positions move.
        </p>
      </div>
    );
  }

  const narrow = a.top3SharePct >= 70;
  const broad = a.top3SharePct <= 40;
  const tone = narrow ? "warning" : broad ? "positive" : "neutral";

  return (
    <div
      className={`flex flex-col gap-1.5 rounded-lg border p-3.5 ${
        narrow ? "border-warning/25 bg-warning/[0.04]" : "border-border bg-surface/40"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tone}>
          {narrow ? "Narrow result" : broad ? "Broad result" : "Moderately broad"}
        </Badge>
        <span className="font-mono text-[11px] tabular-nums text-muted">
          {a.effectiveDrivers.toFixed(1)} effective drivers
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        The three largest movers account for{" "}
        <strong className="text-foreground">{a.top3SharePct.toFixed(0)}%</strong> of all the
        movement in this portfolio, across{" "}
        <strong className="text-foreground">{a.winners}</strong> position
        {a.winners === 1 ? "" : "s"} up and <strong className="text-foreground">{a.losers}</strong>{" "}
        down.{" "}
        {narrow
          ? "A result this concentrated tells you about a few holdings, not about the portfolio — and the same concentration works in reverse when those names turn."
          : broad
            ? "The result is broadly sourced, so it reflects the portfolio rather than a handful of names."
            : "Reasonably distributed, with a few names still doing most of the work."}
      </p>
    </div>
  );
}

export function AttributionPanel({
  attribution,
  totalReturnPct,
  realizedPnl = 0,
  dayMoves = [],
}: {
  attribution: ReturnAttribution | null;
  /** The report's headline return, for the reconciliation note. */
  totalReturnPct: number;
  /**
   * Per-holding session moves from the same report, so an expanded contributor
   * can show today's move beside its whole-period contribution — the two are
   * different quantities and were previously indistinguishable here.
   */
  dayMoves?: HoldingDayMove[];
  /**
   * Realized P&L in the headline that this decomposition structurally cannot show.
   *
   * A closed position has no weight and no current value, so it has no contribution
   * bar — but its banked gain or loss IS in the headline. That made this panel's
   * total differ from the tile above it by exactly the realized amount, with no note
   * explaining why: the reconciliation copy below only ever fired for holdings
   * missing a cost basis. Measured live, attribution read −0.9793% against a
   * headline of −1.0854%, a silent $9,819.50 discrepancy.
   */
  realizedPnl?: number;
}) {
  // Both columns' caps lift together: "the rest is hidden" is a single fact
  // about the panel, not one per column.
  const [showAll, setShowAll] = useState(false);
  // Which figure leads each row. Contribution is the default because it is the
  // only one of the three that sums to the headline.
  const [metric, setMetric] = useState<RowMetric>("contribution");

  if (!attribution) {
    return (
      <Card className="p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
          Return attribution
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted/70">
          No holding has a recorded cost basis, so there is no return to decompose. A
          contribution cannot be computed without knowing what was paid.
        </p>
      </Card>
    );
  }

  const a = attribution;
  const TOP_N = 6;
  const carrying = showAll ? a.carrying : a.carrying.slice(0, TOP_N);
  const dragging = showAll ? a.dragging : a.dragging.slice(0, TOP_N);
  const hiddenCount = a.carrying.length + a.dragging.length - carrying.length - dragging.length;
  const dayBySymbol = new Map(dayMoves.map((m) => [m.symbol.toUpperCase(), m]));
  const dayFor = (c: Contributor) =>
    c.symbol ? dayBySymbol.get(c.symbol.toUpperCase()) ?? null : null;
  // One shared scale across BOTH columns, so a bar's length means the same thing on
  // the left as on the right. Scaling each column to its own maximum would make the
  // largest drag look exactly as big as the largest carry. Recomputed for whichever
  // figure the toggle currently leads with.
  const scale = Math.max(
    ...[...carrying, ...dragging].map((c) => Math.abs(metricValue(c, metric) ?? 0)),
    0.0001,
  );
  const MATERIAL_PP = 0.01;
  /** Any visible divergence from the tile above must be explained, not just an
   *  exclusion-driven one. 0.005pp is half the smallest displayed digit. */
  const differsFromHeadline = Math.abs(a.totalReturnPct - totalReturnPct) >= 0.005;
  const materialGroups = a.byAssetClass.filter((g) => Math.abs(g.contributionPct) >= MATERIAL_PP);
  const immaterialCount = a.byAssetClass.length - materialGroups.length;
  const groupScale = Math.max(...materialGroups.map((g) => Math.abs(g.contributionPct)), 0.0001);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Return attribution
          </h3>
          <p className="mt-1 text-[11px] text-muted/70">
            Each position&apos;s contribution to the portfolio&apos;s own return, in
            percentage points. These sum to the total.
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-lg font-bold tabular-nums ${toneClass(a.totalReturnPct)}`}>
            {formatPercent(a.totalReturnPct, 2)}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {formatSignedCurrency(a.totalPnl)}
          </span>
        </div>
      </div>

      <BreadthVerdict a={a} />

      {/* Which figure the rows lead with. A quiet segmented control, not tabs —
          it changes emphasis and bar scaling only, never the decomposition. */}
      <div
        role="group"
        aria-label="Row figure"
        className="flex items-center gap-0.5 self-start rounded-lg border border-border bg-surface/40 p-0.5"
      >
        {(Object.keys(METRIC_LABEL) as RowMetric[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            aria-pressed={metric === m}
            className={`rounded-md px-2 py-0.5 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
              metric === m
                ? "bg-surface-2 font-semibold text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {METRIC_LABEL[m]}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-positive">
            Carrying the portfolio
          </h4>
          {carrying.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {carrying.map((c) => (
                <ContributorRow key={c.id} c={c} scale={scale} totalCostBase={a.totalCostBase} dayMove={dayFor(c)} metric={metric} />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted/70">Nothing is up.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-negative">
            Dragging it back
          </h4>
          {dragging.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {dragging.map((c) => (
                <ContributorRow key={c.id} c={c} scale={scale} totalCostBase={a.totalCostBase} dayMove={dayFor(c)} metric={metric} />
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-muted/70">
              Nothing is down. Every position with a cost basis is above it.
            </p>
          )}
        </div>
      </div>

      {/* The rest of the decomposition on demand — a capped list with no count of
          what it hid invited the reading "only these twelve moved". */}
      {(hiddenCount > 0 || showAll) && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="self-start text-[11px] text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
        >
          {showAll
            ? "Show top contributors only"
            : `Show ${hiddenCount} more contributor${hiddenCount === 1 ? "" : "s"}`}
        </button>
      )}

      {/* Only the classes that actually moved the portfolio. Four consecutive rows
          reading "+0.00pp" are not information — they are the reader's attention
          spent on confirming that cash and forex did nothing. The count of what was
          omitted is stated so the view is still complete. */}
      {materialGroups.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            By asset class
          </h4>
          <ul className="flex flex-col gap-2">
            {materialGroups.map((g) => <GroupRow key={g.key} g={g} scale={groupScale} />)}
          </ul>
          {immaterialCount > 0 && (
            <p className="text-[10px] text-muted/60">
              {immaterialCount} other asset class{immaterialCount === 1 ? "" : "es"} contributed
              less than 0.01pp each.
            </p>
          )}
        </div>
      )}

      {/* Reconciliation and exclusions, stated rather than left to be noticed.
          A decomposition the reader cannot check against the headline is a
          decomposition the reader has to take on trust. */}
      <p className="text-[10px] leading-relaxed text-muted/60">
        {/* Fires whenever this total differs from the headline for ANY reason, not
            only for holdings missing a cost basis. Gating it on the exclusion list
            meant the commonest cause — a closed position's banked P&L, which has no
            contribution bar because it has no weight — went unmentioned. */}
        {differsFromHeadline && (
          <>
            This total ({formatPercent(a.totalReturnPct, 2)}) differs from the headline (
            {formatPercent(totalReturnPct, 2)}) because{" "}
            {[
              Math.abs(realizedPnl) >= 0.01 &&
                `${formatSignedCurrency(realizedPnl)} of it is realized P&L on positions that have been sold — they have no current weight, so no contribution bar`,
              a.excluded.length > 0 &&
                `${a.excluded.length} holding${a.excluded.length === 1 ? "" : "s"} (${a.excluded
                  .reduce((s, e) => s + e.weight, 0)
                  .toFixed(1)}% of the portfolio) have no recorded cost basis, so their contribution is unknown rather than zero`,
            ]
              .filter(Boolean)
              .join("; and ")}
            .{" "}
          </>
        )}
        Contributions are measured against the same cost base as the return itself, so they add
        up exactly. Sector figures cover only the sector-classified part of the book.
      </p>
    </Card>
  );
}
