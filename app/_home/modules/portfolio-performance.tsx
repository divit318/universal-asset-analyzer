"use client";

/**
 * Module 9 — Portfolio Performance.
 *
 * XIRR against the benchmark, from `portfolioPerformance()` — the same engine
 * /portfolio uses. No performance math happens here.
 *
 * The card leads with the *cumulative* return until the portfolio is old enough
 * for an annualized one to mean anything (MIN_DAYS_TO_ANNUALIZE), then switches
 * to XIRR. A real three-day-old portfolio down 4.8% annualizes to −99.98%/yr;
 * printing that as the headline number is technically true and totally
 * misleading, so we don't.
 */

import Link from "next/link";
import { formatCurrency, toneClass } from "@/lib/format";
import { MIN_DAYS_TO_ANNUALIZE } from "@/lib/home/contracts";
import { getHomeModule } from "@/lib/home/registry";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("portfolio-performance");

function signed(n: number | null, digits = 1): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function PortfolioPerformanceModule() {
  const state = useHomeSlice("performance");
  const calibration = useHomeSlice("calibration");
  const { refreshDigest } = useHome();

  const unmet = state.data?.status === "empty" ? ("portfolio" as const) : null;

  // The decision journal's track record. "Are my calls any good?" is the same
  // question as "is my portfolio any good", one level up — so it lives here
  // rather than as a module of its own. Hidden until there are enough closed
  // decisions to say anything honest (the journal's own eligibility gate).
  const track = calibration.data?.eligible ? calibration.data.trackRecord : null;

  return (
    <ModuleShell
      definition={definition}
      state={state}
      unmet={unmet}
      minHeight={200}
      onRefresh={refreshDigest}
      isEmpty={(d) => d.status === "empty"}
      emptyMessage="No lots recorded yet."
    >
      {(d) => (
        <div className="flex flex-col gap-4">
          {/* The headline is the cumulative return when the portfolio is too
              young to annualize, and the annualized rate once it isn't. Leading
              with a -100%/yr extrapolation from three days of history would be
              arithmetically defensible and completely misleading. */}
          {d.xirrPct != null ? (
            <div className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-muted">Money-weighted return (XIRR)</span>
              <span className={`font-mono text-2xl font-semibold tabular-nums ${toneClass(d.xirrPct)}`}>
                {signed(d.xirrPct)}
                <span className="ml-1 text-xs font-normal text-muted">/yr</span>
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-micro uppercase tracking-wide text-muted">Return since inception</span>
              <span className={`font-mono text-2xl font-semibold tabular-nums ${toneClass(d.totalReturnPct)}`}>
                {signed(d.totalReturnPct)}
              </span>
              <span className="text-xs text-muted">
                {d.holdingDays < MIN_DAYS_TO_ANNUALIZE
                  ? `${d.holdingDays} day${d.holdingDays === 1 ? "" : "s"} of history — too early for an annualized (XIRR) figure.`
                  : "Not enough dated lots to solve for an annualized rate."}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-micro uppercase tracking-wide text-muted">Total return</span>
              <span className={`font-mono text-sm font-semibold tabular-nums ${toneClass(d.totalReturnPct)}`}>
                {signed(d.totalReturnPct)}
              </span>
              <span className="text-xs text-muted">{formatCurrency(d.totalReturnDollar)}</span>
            </div>

            {d.benchmark ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-micro uppercase tracking-wide text-muted">vs. {d.benchmark.symbol}</span>
                <span className={`font-mono text-sm font-semibold tabular-nums ${toneClass(d.benchmark.excessPct)}`}>
                  {signed(d.benchmark.excessPct)}
                </span>
                <span className="text-xs text-muted">
                  benchmark {signed(d.benchmark.benchmarkPct)}/yr
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="text-micro uppercase tracking-wide text-muted">vs. benchmark</span>
                <span className="font-mono text-sm text-muted">—</span>
                <span className="text-xs text-muted">
                  {d.holdingDays < MIN_DAYS_TO_ANNUALIZE ? "Needs a longer track record" : "Unavailable"}
                </span>
              </div>
            )}
          </div>

          {track && track.hitRate != null ? (
            <div className="flex flex-col gap-1 border-t border-border pt-4">
              <span className="text-micro uppercase tracking-wide text-muted">Your decision track record</span>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {Math.round(track.hitRate * 100)}% hit rate
                </span>
                <span className="text-xs text-muted">
                  across {track.scored} scored decision{track.scored === 1 ? "" : "s"}
                </span>
              </div>
              <Link href="/journal" className="text-xs text-brand hover:underline">
                Open decision journal →
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </ModuleShell>
  );
}
