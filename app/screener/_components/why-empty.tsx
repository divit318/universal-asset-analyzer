"use client";

/**
 * The panel that replaces "Nothing matched".
 *
 * An empty screen is a question, and every screener in the market answers it with
 * a shrug. The user set eight filters, one or two of them are responsible, and
 * the fix is usually a couple of percent of slack on a single number — all of
 * which is computable, and none of which was being said.
 *
 * Two genuinely different situations, deliberately worded differently, because
 * conflating them is how a tool loses trust:
 *
 *  - **One filter is binding.** Everything else matches plenty; this one bound is
 *    unreachable. There is an exact threshold that fixes it, and clicking it
 *    applies it. This is a promise the engine can keep.
 *
 *  - **Several filters are jointly infeasible.** No single change helps, because
 *    dropping any one of them still leaves the others excluding everything. Here
 *    the honest answer is *which filter admits the fewest names on its own* —
 *    offering a threshold would send the user to relax a number and get nothing
 *    again.
 *
 * See lib/screener/filter-engine.ts#diagnose for why the solo counts exist.
 */

import type { FilterDiagnostic } from "@/lib/screener/filter-engine";
import type { MetricDef } from "@/lib/assets/types";
import { formatMetricValue } from "@/lib/screener/format";

interface Props {
  diagnostics: FilterDiagnostic[];
  /** For formatting a suggested threshold in the metric's own units. */
  metricFor: (key: string) => MetricDef | null;
  /** Apply a relaxed bound. Undefined for classes/filters where it isn't offered. */
  onRelax: (key: string, bound: "min" | "max", value: number) => void;
  onClearAll: () => void;
}

export function WhyEmpty({ diagnostics, metricFor, onRelax, onClearAll }: Props) {
  if (diagnostics.length === 0) return null;

  const actionable = diagnostics.filter((d) => d.relaxTo != null && d.bound != null);
  const jointlyInfeasible = actionable.length === 0;
  const tightest = diagnostics[0];

  /** A suggested threshold, rendered in the metric's own units and scale. */
  const format = (key: string, value: number) => {
    const metric = metricFor(key);
    return metric ? formatMetricValue(metric, value) : String(Number(value.toPrecision(4)));
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3.5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Nothing matched — here&apos;s why</p>
        <p className="text-xs leading-relaxed text-muted">
          {jointlyInfeasible ? (
            <>
              No single filter is responsible: your filters are collectively
              impossible, so loosening just one of them still returns nothing.{" "}
              <span className="font-medium text-fg">{tightest.label}</span> is the
              tightest — on its own it only admits{" "}
              <span className="font-medium text-fg">{tightest.soloSurvivors}</span>{" "}
              {tightest.soloSurvivors === 1 ? "asset" : "assets"} out of the whole
              universe.
            </>
          ) : (
            <>
              Everything else you asked for matches plenty. One bound is out of
              reach — relax it and you have results.
            </>
          )}
        </p>
      </div>

      {actionable.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {actionable.map((d) => (
            <li key={d.key} className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => onRelax(d.key, d.bound!, d.relaxTo!)}
                className="rounded-md border border-brand/40 bg-brand/10 px-2 py-1 font-medium text-brand transition-colors hover:bg-brand/20"
              >
                Set {d.label} {d.bound === "min" ? "≥" : "≤"} {format(d.key, d.relaxTo!)}
              </button>
              <span className="text-muted">
                unblocks {d.survivorsWithoutIt}{" "}
                {d.survivorsWithoutIt === 1 ? "asset" : "assets"} that clear every
                other filter
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col gap-1 border-t border-warning/20 pt-2 text-xs">
          {diagnostics.slice(0, 5).map((d) => (
            <li key={d.key} className="flex items-center justify-between gap-3">
              <span className="text-muted">{d.label} alone admits</span>
              <span className="font-medium tabular-nums">{d.soloSurvivors}</span>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onClearAll}
        className="self-start text-xs text-muted underline underline-offset-2 hover:text-brand"
      >
        Or clear all filters and start again
      </button>
    </div>
  );
}
