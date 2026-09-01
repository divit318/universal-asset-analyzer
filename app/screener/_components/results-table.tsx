"use client";

/**
 * The results table. Columns come from the Asset Registry, so there is exactly
 * one table in the app rather than one per screening universe — an ETF screen
 * renders expense ratio and AUM, a bond screen renders duration and credit
 * rating, and this component doesn't know the difference.
 */

import { Fragment, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { askAi } from "@/app/_components/ask-ai";
import { getAssetClass, getMetric, universeLabel } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { scoreMeterTone } from "@/lib/recommendation";
import { formatMetricValue } from "@/lib/screener/format";
import { OwnershipCell } from "./ownership-cell";
import { MARGINAL_SLACK } from "@/lib/screener/filter-engine";
import type { RankedCandidate } from "@/lib/screener/types";
import { Badge } from "@/app/_components/ui";
import { BrandEmptyState } from "@/app/_components/brand";
import { HoldingsTable } from "@/app/_components/holdings-table";

interface Props {
  assetClass: AssetClassId;
  rows: RankedCandidate[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  watchlisted: Set<string>;
  onWatch: (row: RankedCandidate) => void;
  /** Symbols already held, so a screen can't re-suggest what you own. */
  owned: Set<string>;
  /** Symbols staged for a batch action. */
  staged: Set<string>;
  onToggleStaged: (symbol: string) => void;
  /** Why the table would be empty — drives an accurate empty state. */
  emptyState?: ResultsEmptyState;
}

/**
 * Help text for the columns whose names are otherwise ambiguous.
 *
 * The table showed `#`, `Rank` and `Overall` adjacent to each other — three
 * numbers, two of them 0-100 and one a position, with `Rank` sounding exactly
 * like the position that `#` already was. `rankScore` is now labelled "Match"
 * across every asset-class registry, and these tooltips state the difference at
 * the point of confusion.
 */
const COLUMN_HELP: Record<string, string> = {
  rankScore:
    "How well this asset matches the ACTIVE screen — the template's own ranking factors, shrunk toward the middle when factor data is missing. Sorting default. Not the same as Overall.",
  overallScore:
    "The general-purpose screen score: quality, value, growth, financial health and momentum, with sector-aware thresholds. Independent of which template you ran.",
  valueScore: "Valuation dimension of the Overall screen score, 0-100, sector-relative.",
  growthScore: "Growth dimension of the Overall screen score, 0-100, sector-relative.",
  qualityScore: "Quality dimension of the Overall screen score, 0-100, sector-relative.",
  financialHealthScore: "Balance-sheet dimension of the Overall screen score, 0-100.",
};

/**
 * Colour the match score with the canonical 3-step meter grammar
 * (lib/recommendation.ts scoreMeterTone). Previously a private 75/55/35 band
 * table here, so a 76 turned green in this table while the same number needed
 * 78 to reach the top tier anywhere else.
 */

/**
 * The Match score as a number + a small bar. The bar exists for scanability:
 * fifty three-digit numbers in a column are read one at a time, but fifty bar
 * lengths are read as a shape — where the ranking falls off a cliff is visible
 * without reading anything. Zero confidence (no factor had data) renders as an
 * em dash with no bar, like every other unknown.
 */
function MatchScore({ row }: { row: RankedCandidate }) {
  if (row.confidence === 0) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span aria-hidden className="h-1 w-9 overflow-hidden rounded-full bg-surface-3">
        <span
          className={`block h-full rounded-full ${scoreMeterTone(row.rankScore).bar}`}
          style={{ width: `${Math.max(0, Math.min(100, row.rankScore))}%` }}
        />
      </span>
      <span className={`font-semibold ${scoreMeterTone(row.rankScore).text}`}>{row.rankScore}</span>
    </span>
  );
}

function cellValue(assetClass: AssetClassId, row: RankedCandidate, key: string): string {
  if (key === "rankScore") {
    // Zero confidence means not one ranking factor had data, so `rankScore`
    // fell through to 0 — which the score colouring then paints red, reading as
    // "the worst asset in the universe" when it actually means "we know nothing
    // about it". An unknown score is an em dash, like every other unknown.
    return row.confidence === 0 ? "—" : String(row.rankScore);
  }
  if (key === "price") {
    return row.price == null
      ? "—"
      : row.price >= 1000
        ? row.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : row.price.toFixed(row.price < 10 ? 4 : 2);
  }
  if (key === "changePercent") {
    return row.changePercent == null ? "—" : `${row.changePercent.toFixed(2)}%`;
  }

  const metric = getMetric(assetClass, key);
  if (!metric) return "—";
  if (metric.options) return row.attributes[key] ?? "—";
  return formatMetricValue(metric, row.metrics[key] ?? null);
}

function MatchDetail({ row }: { row: RankedCandidate }) {
  const router = useRouter();
  const { passed, strengths, warnings } = row.match;

  return (
    <div className="grid gap-4 border-t border-border bg-surface-2/50 px-4 py-3 text-xs md:grid-cols-3">
      <div>
        <p className="mb-1.5 font-medium">Why it matched</p>
        {row.binding ? (
          <p className="mb-1.5 text-[11px] leading-relaxed text-muted">
            Closest to failing:{" "}
            <span className="font-medium text-fg">{row.binding.label}</span>{" "}
            ({row.binding.detail})
            {row.binding.slack < MARGINAL_SLACK ? " — only just cleared it." : "."}
          </p>
        ) : null}
        {passed.length === 0 ? (
          <p className="text-muted">
            No filters were active — this is the full ranked universe, not a filtered screen.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {passed.map((p) => (
              <li key={p.label} className="flex justify-between gap-3 text-muted">
                <span>{p.label}</span>
                <span className="font-medium text-fg">{p.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 font-medium">Strengths</p>
        {strengths.length === 0 ? (
          <p className="text-muted">Nothing in the top quartile of the universe on the ranked factors.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {strengths.map((s) => (
              <li key={s.label} className="text-muted">
                <span className="font-medium text-fg">{s.label}</span> — {s.detail}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-1.5 font-medium">Warnings</p>
        {warnings.length === 0 ? (
          <p className="text-muted">No risk flags fired.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="text-amber-500 light:text-amber-700">
                {w}
              </li>
            ))}
          </ul>
        )}
        {row.confidence < 60 ? (
          <p className="mt-2 text-[11px] text-muted">
            Score confidence {row.confidence}% — several ranking factors have no data for this asset, so
            treat the rank as provisional.
          </p>
        ) : null}
      </div>

      {row.topHoldings && row.topHoldings.length > 0 ? (
        <div className="md:col-span-3">
          <HoldingsTable holdings={row.topHoldings} />
        </div>
      ) : null}

      {/* The user expanded this row because the match made them curious —
          the natural continuation is a grounded read from the copilot, with
          the row's screen context attached. Lives here, in the expanded
          detail, not on every row: it appears exactly when someone is
          already digging into one result. */}
      <div className="md:col-span-3">
        <button
          type="button"
          onClick={() => askAi(router, { source: "screener", symbol: row.symbol, name: row.name })}
          className="flex items-center gap-1.5 text-xs font-medium text-brand transition-opacity hover:opacity-80 focus-visible:underline"
        >
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Ask AI for a read on {row.symbol}
        </button>
      </div>
    </div>
  );
}

/**
 * Why the table is empty. There are four different reasons and they need four
 * different messages.
 *
 * The old empty state said one thing for all of them: "Every filter you set
 * excludes assets whose value is unknown… Try loosening the tightest one." On a
 * cold start — which is the very first thing a new user sees, and lasts for the
 * ~13 minutes the universe takes to build — that text was simply false. No
 * filters were set. It blamed the user for a condition that did not exist and
 * sent them to adjust controls that were already empty, while the real answer
 * ("the data is still loading") was never mentioned.
 */
export type ResultsEmptyState =
  /** The universe is still being assembled. Nothing is wrong. */
  | { kind: "building"; ready: number; total: number }
  /** The universe failed to assemble. The user cannot fix this with filters. */
  | { kind: "universe-error"; error: string }
  /** Universe is ready, no filters set, and the screen has not been run yet. */
  | { kind: "not-run" }
  /** Universe is ready and the filters genuinely excluded everything. */
  | { kind: "no-matches"; activeFilterCount: number }
  /**
   * Excluded everything, *and* the engine worked out which filter is responsible
   * — so the WhyEmpty panel above is already saying it, with a one-click fix.
   * Repeating a generic "try loosening the tightest one" underneath would be
   * noise directly below a button that names the exact threshold.
   */
  | { kind: "diagnosed" };

function EmptyResults({
  def,
  state,
}: {
  /** `label` is the universe's display name (universeLabel), e.g. "India Equities" — not the bare class label. */
  def: { label: string; noun: string };
  state: ResultsEmptyState;
}) {
  const body = (() => {
    switch (state.kind) {
      case "building":
        return {
          title: `Building the ${def.label} universe`,
          detail:
            state.total > 0
              ? `Fetching fundamentals for ${state.total.toLocaleString()} assets — ${state.ready.toLocaleString()} done. Results appear as soon as it finishes; you can leave this page and come back.`
              : "Fetching the asset list and their fundamentals. Results appear as soon as it finishes.",
        };
      case "universe-error":
        return {
          title: "The universe could not be built",
          detail: `${state.error} Use "Refresh data" to try again — this is a data-source problem, not a filter problem.`,
        };
      case "not-run":
        return {
          title: `Ready — pick a template or set a filter`,
          detail: `The ${def.label} universe is loaded. Start from a template above, or set any filter and run the screen.`,
        };
      case "diagnosed":
        return null;
      case "no-matches":
        return {
          title: "Nothing matched",
          detail:
            state.activeFilterCount > 0
              ? `${state.activeFilterCount === 1 ? "Your active filter was" : `All ${state.activeFilterCount} active filters were`} applied and no ${def.noun} passed. A filter also excludes assets whose value is unknown, so a metric this universe is thin on can empty the table — try loosening the tightest one.`
              : `No ${def.noun} passed. Try a different template or universe.`,
        };
    }
  })();

  if (!body) return null;

  // A screen with no rows is the largest expanse of nothing in the app and the
  // first thing a new user sees (the universe takes ~13 minutes to build). It
  // gets the mark — animating for "building", resolved for every other kind,
  // because the resolved diamond means "done" (see BrandEmptyState).
  return (
    <BrandEmptyState title={body.title} detail={body.detail} loading={state.kind === "building"}>
      <Badge variant="neutral">{def.label}</Badge>
    </BrandEmptyState>
  );
}

export function ResultsTable({
  assetClass,
  rows,
  sortKey,
  sortDir,
  onSort,
  watchlisted,
  onWatch,
  owned,
  staged,
  onToggleStaged,
  emptyState = { kind: "no-matches", activeFilterCount: 0 },
}: Props) {
  const def = getAssetClass(assetClass);
  const [expanded, setExpanded] = useState<string | null>(null);
  /**
   * Keyboard cursor. -1 = nothing focused, which is the resting state: the table
   * must not steal arrow keys from the page until the user opts in by pressing
   * j/k or clicking into it.
   */
  const [cursor, setCursor] = useState(-1);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const arrow = (key: string) => (sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "");

  /*
   * Keyboard-first review, which is how anyone works through a ranked list at
   * volume: j/k to move, space to stage, x to expand, w to watch, Enter to open
   * Research. Bound on the tbody rather than the document so it can never
   * hijack typing in a filter input — the single most common way keyboard
   * shortcuts go wrong in a screener.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (rows.length === 0) return;
    const move = (delta: number) => {
      e.preventDefault();
      const next = Math.min(rows.length - 1, Math.max(0, (cursor < 0 ? -1 : cursor) + delta));
      setCursor(next);
      bodyRef.current?.querySelectorAll("tr[data-row]")[next]?.scrollIntoView({ block: "nearest" });
    };

    switch (e.key) {
      case "j":
      case "ArrowDown":
        return move(1);
      case "k":
      case "ArrowUp":
        return move(-1);
      case " ": {
        if (cursor < 0) return;
        e.preventDefault();
        return onToggleStaged(rows[cursor].symbol);
      }
      case "x": {
        if (cursor < 0) return;
        e.preventDefault();
        const sym = rows[cursor].symbol;
        return setExpanded((cur) => (cur === sym ? null : sym));
      }
      case "w": {
        if (cursor < 0) return;
        e.preventDefault();
        return onWatch(rows[cursor]);
      }
      case "Enter": {
        if (cursor < 0) return;
        e.preventDefault();
        window.location.href = `/research?symbol=${encodeURIComponent(rows[cursor].symbol)}`;
        return;
      }
      default:
        return;
    }
  };

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[900px] text-sm">
        {/* Uppercase micro-headers — the same label tier the rest of UAA uses
            for column/section headings, which also stops the header row reading
            as just another data row at this density. */}
        <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">
              <button type="button" onClick={() => onSort("symbol")} className="hover:text-fg">
                Symbol{arrow("symbol")}
              </button>
            </th>
            {/* Table-level extra (like the actions column, not a registry
                metric): the 12-quarter SEBI ownership sparkline for India. */}
            {assetClass === "indiaEquity" && (
              <th className="px-3 py-2 text-left font-medium" title="Disclosed promoter/FII/DII over up to 12 quarters (SEBI shareholding pattern via screener.in)">
                Ownership 12Q
              </th>
            )}
            {def.columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 font-medium ${col.align === "left" ? "text-left" : "text-right"}`}
                title={COLUMN_HELP[col.key]}
              >
                <button type="button" onClick={() => onSort(col.key)} className="hover:text-fg">
                  {col.label}
                  {arrow(col.key)}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>

        <tbody
          ref={bodyRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          aria-label="Screen results. Press j and k to move, space to stage, x to expand, w to watch, Enter to research."
          className="outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
        >
          {rows.map((row, rowIndex) => {
            const isOpen = expanded === row.symbol;
            const isCursor = rowIndex === cursor;
            const isStaged = staged.has(row.symbol);
            const hasWarnings = row.match.warnings.length > 0;

            return (
              <Fragment key={row.symbol}>
                <tr
                  data-row
                  onClick={() => setCursor(rowIndex)}
                  className={`border-b border-border transition-colors hover:bg-surface-2/50 ${
                    isCursor ? "bg-brand/[0.07] ring-1 ring-inset ring-brand/25" : ""
                  } ${isStaged ? "bg-brand/[0.04]" : ""}`}
                >
                  <td className="px-3 py-2 text-xs text-muted">{row.rank}</td>

                  <td className="px-3 py-2">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpanded(isOpen ? null : row.symbol)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setExpanded(isOpen ? null : row.symbol);
                        }
                      }}
                      aria-expanded={isOpen}
                      className="flex flex-col items-start text-left"
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        <Link
                          href={`/research?symbol=${encodeURIComponent(row.symbol)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="transition-colors hover:text-brand"
                        >
                          {row.symbol}
                        </Link>
                        {hasWarnings ? (
                          <span
                            className="text-amber-500 light:text-amber-700"
                            title={`${row.match.warnings.length} warning(s)`}
                            aria-label={`${row.match.warnings.length} warnings`}
                          >
                            ⚠
                          </span>
                        ) : null}
                        {/*
                          * Marginal pass. A name sitting on your ROIC floor is one
                          * quarter from leaving the screen, and a name clearing
                          * every bound by miles is a different proposition — the
                          * table said "matched" for both. Only shown when it's
                          * actually close, so it means something when it appears.
                          */}
                        {/*
                          * Already held. A screener that keeps surfacing what you
                          * own is wasting the scarcest thing in the process —
                          * attention — and this is the cheapest possible fix.
                          */}
                        {owned.has(row.symbol) ? (
                          <span
                            className="rounded border border-positive/40 bg-positive/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-positive"
                            title="You already hold this"
                          >
                            held
                          </span>
                        ) : null}
                        {row.binding && row.binding.slack < MARGINAL_SLACK ? (
                          <span
                            className="rounded border border-warning/40 bg-warning/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-warning"
                            title={`Only just cleared your ${row.binding.label} filter — ${row.binding.detail}`}
                          >
                            marginal
                          </span>
                        ) : null}
                      </span>
                      <span className="max-w-[220px] truncate text-xs text-muted">{row.name}</span>
                    </div>
                  </td>

                  {assetClass === "indiaEquity" && (
                    <td className="px-3 py-2">
                      <OwnershipCell
                        hist={row.attributes.ownHist ?? null}
                        trend={row.attributes.ownTrend ?? null}
                        asOf={row.attributes.ownershipAsOf ?? null}
                      />
                    </td>
                  )}
                  {def.columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 tabular-nums ${col.align === "left" ? "text-left" : "text-right"}`}
                    >
                      {col.key === "rankScore" ? <MatchScore row={row} /> : cellValue(assetClass, row, col.key)}
                    </td>
                  ))}

                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <Link
                        href={`/research?symbol=${encodeURIComponent(row.symbol)}`}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand"
                      >
                        Research
                      </Link>
                      <button
                        type="button"
                        onClick={() => onToggleStaged(row.symbol)}
                        aria-pressed={isStaged}
                        title={isStaged ? "Unstage" : "Stage for a batch action (space)"}
                        className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                          isStaged
                            ? "border-brand/50 bg-brand/10 text-brand"
                            : "border-border text-muted hover:border-brand hover:text-brand"
                        }`}
                      >
                        {isStaged ? "✓" : "+"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onWatch(row)}
                        disabled={watchlisted.has(row.symbol)}
                        className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-40"
                      >
                        {watchlisted.has(row.symbol) ? "Watching" : "Watch"}
                      </button>
                    </div>
                  </td>
                </tr>

                {isOpen ? (
                  <tr>
                    <td colSpan={def.columns.length + (assetClass === "indiaEquity" ? 4 : 3)} className="p-0">
                      <MatchDetail row={row} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 ? <EmptyResults def={{ label: universeLabel(assetClass), noun: def.noun }} state={emptyState} /> : null}
    </div>
  );
}
