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

import { Card, Badge } from "@/app/_components/ui";
import { formatPercent, formatSignedCurrency, toneClass } from "@/lib/format";
import type { Contributor, GroupContribution, ReturnAttribution } from "@/lib/portfolio/engines/attribution";

/** pp = percentage points of the PORTFOLIO's return, not the position's own. */
const pp = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}pp`;

/**
 * A contributor row. The bar is scaled to the largest ABSOLUTE contribution in
 * the panel, so gains and losses are comparable at a glance and a −0.4pp drag is
 * visibly half a +0.8pp carry.
 */
function ContributorRow({ c, scale }: { c: Contributor; scale: number }) {
  const width = scale > 0 ? Math.min((Math.abs(c.contributionPct) / scale) * 100, 100) : 0;
  const positive = c.contributionPct >= 0;

  return (
    <li className="flex flex-col gap-1">
      {/* flex-wrap, and the metadata is allowed to shrink.
          Four things share this row — name, weight, own return, and the money/pp
          pair — and at 390px the combination could not fit. With `shrink-0` on the
          metadata and only the name truncating, the row had a hard minimum width
          that pushed the whole card 57px past the viewport and gave the entire page
          a horizontal scrollbar on a phone. Wrapping degrades to two lines instead,
          which loses nothing. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono font-medium text-foreground">{c.symbol ?? c.name}</span>
          {/* Weight AND own return, because weight alone makes the most
              informative rows unreadable. A written-down holding shows "0.0% wt"
              beside a −$6,950 drag, and the obvious question — how does 0% of a
              portfolio lose seven thousand dollars? — is answered only by its own
              return of −92%: it used to be a real position. */}
          <span className="whitespace-nowrap text-[10px] text-muted/60">
            {c.weight.toFixed(1)}% wt
            {c.ownReturnPct != null && (
              <span className={toneClass(c.ownReturnPct)}> · {formatPercent(c.ownReturnPct, 1)}</span>
            )}
          </span>
        </span>
        <span className="flex items-baseline gap-2 whitespace-nowrap font-mono tabular-nums">
          <span className="text-[10px] text-muted/70">{formatSignedCurrency(c.pnl)}</span>
          <span className={`font-semibold ${toneClass(c.contributionPct)}`}>{pp(c.contributionPct)}</span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${positive ? "bg-positive/70" : "bg-negative/70"}`}
          style={{ width: `${width}%` }}
        />
      </div>
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
}: {
  attribution: ReturnAttribution | null;
  /** The report's headline return, for the reconciliation note. */
  totalReturnPct: number;
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
  const carrying = a.carrying.slice(0, TOP_N);
  const dragging = a.dragging.slice(0, TOP_N);
  // One shared scale across BOTH columns, so a bar's length means the same thing on
  // the left as on the right. Scaling each column to its own maximum would make the
  // largest drag look exactly as big as the largest carry.
  const scale = Math.max(
    ...[...carrying, ...dragging].map((c) => Math.abs(c.contributionPct)),
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

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-positive">
            Carrying the portfolio
          </h4>
          {carrying.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {carrying.map((c) => <ContributorRow key={c.id} c={c} scale={scale} />)}
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
              {dragging.map((c) => <ContributorRow key={c.id} c={c} scale={scale} />)}
            </ul>
          ) : (
            <p className="text-[11px] text-muted/70">
              Nothing is down. Every position with a cost basis is above it.
            </p>
          )}
        </div>
      </div>

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
