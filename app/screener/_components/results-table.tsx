"use client";

/**
 * The results table. Columns come from the Asset Registry, so there is exactly
 * one table in the app rather than seven — an ETF screen renders expense ratio
 * and AUM, a bond screen renders duration and credit rating, and this component
 * doesn't know the difference.
 */

import { Fragment, useState } from "react";
import Link from "next/link";
import { getAssetClass, getMetric } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";
import { formatMetricValue } from "@/lib/screener/format";
import type { RankedCandidate } from "@/lib/screener/types";
import { Badge } from "@/app/_components/ui";
import { HoldingsTable } from "@/app/_components/holdings-table";

interface Props {
  assetClass: AssetClassId;
  rows: RankedCandidate[];
  sortKey: string;
  sortDir: "asc" | "desc";
  onSort: (key: string) => void;
  watchlisted: Set<string>;
  onWatch: (row: RankedCandidate) => void;
  /** Why the table would be empty — drives an accurate empty state. */
  emptyState?: ResultsEmptyState;
}

/** Colour the rank score the way the rest of the app colours scores. */
function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-500";
  if (score >= 55) return "text-sky-500";
  if (score >= 35) return "text-amber-500";
  return "text-rose-500";
}

function cellValue(assetClass: AssetClassId, row: RankedCandidate, key: string): string {
  if (key === "rankScore") return String(row.rankScore);
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
  const { passed, strengths, warnings } = row.match;

  return (
    <div className="grid gap-4 border-t border-border bg-surface-2/50 px-4 py-3 text-xs md:grid-cols-3">
      <div>
        <p className="mb-1.5 font-medium">Why it matched</p>
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
              <li key={w} className="text-amber-600 dark:text-amber-500">
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
  | { kind: "no-matches"; activeFilterCount: number };

function EmptyResults({
  def,
  state,
}: {
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
      case "no-matches":
        return {
          title: "Nothing matched",
          detail:
            state.activeFilterCount > 0
              ? `${state.activeFilterCount === 1 ? "Your active filter was" : `All ${state.activeFilterCount} active filters were`} applied and no ${def.noun} passed. A filter also excludes assets whose value is unknown, so a metric this universe is thin on can empty the table — try loosening the tightest one.`
              : `No ${def.noun} passed. Try a different template or asset class.`,
        };
    }
  })();

  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <p className="text-sm font-medium">{body.title}</p>
      <p className="max-w-md text-xs text-muted">{body.detail}</p>
      <Badge variant="neutral">{def.label}</Badge>
    </div>
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
  emptyState = { kind: "no-matches", activeFilterCount: 0 },
}: Props) {
  const def = getAssetClass(assetClass);
  const [expanded, setExpanded] = useState<string | null>(null);

  const arrow = (key: string) => (sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : "");

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="border-b border-border bg-surface-2 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">#</th>
            <th className="px-3 py-2 text-left font-medium">
              <button type="button" onClick={() => onSort("symbol")} className="hover:text-fg">
                Symbol{arrow("symbol")}
              </button>
            </th>
            {def.columns.map((col) => (
              <th
                key={col.key}
                className={`px-3 py-2 font-medium ${col.align === "left" ? "text-left" : "text-right"}`}
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

        <tbody>
          {rows.map((row) => {
            const isOpen = expanded === row.symbol;
            const hasWarnings = row.match.warnings.length > 0;

            return (
              <Fragment key={row.symbol}>
                <tr className="border-b border-border transition-colors hover:bg-surface-2/50">
                  <td className="px-3 py-2 text-xs text-muted">{row.rank}</td>

                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : row.symbol)}
                      aria-expanded={isOpen}
                      className="flex flex-col items-start text-left"
                    >
                      <span className="flex items-center gap-1.5 font-medium">
                        {row.symbol}
                        {hasWarnings ? (
                          <span
                            className="text-amber-500"
                            title={`${row.match.warnings.length} warning(s)`}
                            aria-label={`${row.match.warnings.length} warnings`}
                          >
                            ⚠
                          </span>
                        ) : null}
                      </span>
                      <span className="max-w-[220px] truncate text-xs text-muted">{row.name}</span>
                    </button>
                  </td>

                  {def.columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 tabular-nums ${col.align === "left" ? "text-left" : "text-right"} ${
                        col.key === "rankScore" ? `font-semibold ${scoreTone(row.rankScore)}` : ""
                      }`}
                    >
                      {cellValue(assetClass, row, col.key)}
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
                    <td colSpan={def.columns.length + 3} className="p-0">
                      <MatchDetail row={row} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 ? <EmptyResults def={def} state={emptyState} /> : null}
    </div>
  );
}
