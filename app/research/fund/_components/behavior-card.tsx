"use client";

import { useMemo } from "react";
import type { HistoryPoint } from "@/lib/types";
import { analyzeRegimeBehavior } from "@/lib/research-engines/fund/behavior";
import { BasisMark, BasisLegend } from "./basis";

/**
 * "When does this actually work?" — behaviour by environment rather than
 * trailing returns.
 *
 * Measured in render from the two price series the page already has: the fund's
 * five years of daily history and the benchmark's, both fetched by
 * lib/research-bundle.ts for the chart above. No fetch, no AI, no chart — a
 * fourth graph would say less than the four numbers do.
 */
export function BehaviorCard({
  history,
  benchmarkHistory,
  benchmarkLabel,
}: {
  history: HistoryPoint[];
  benchmarkHistory: HistoryPoint[];
  benchmarkLabel: string;
}) {
  const r = useMemo(
    () => analyzeRegimeBehavior(history, benchmarkHistory, benchmarkLabel),
    [history, benchmarkHistory, benchmarkLabel],
  );

  // Below the module's sample floors everything comes back null; a card of
  // dashes is worse than no card.
  if (r.summary == null && r.beta == null) return null;

  const stats: { label: string; value: string; note: string }[] = [];
  if (r.upCapturePct != null) {
    stats.push({ label: "Up capture", value: `${Math.round(r.upCapturePct)}%`, note: `of ${benchmarkLabel} gains in its up months` });
  }
  if (r.downCapturePct != null) {
    stats.push({ label: "Down capture", value: `${Math.round(r.downCapturePct)}%`, note: `of its losses in down months` });
  }
  if (r.beta != null) {
    stats.push({ label: "Beta", value: r.beta.toFixed(2), note: `measured daily vs ${benchmarkLabel}` });
  }
  if (r.volatilityRatio != null && r.fundVolatilityPct != null) {
    stats.push({
      label: "Volatility",
      value: `${r.volatilityRatio.toFixed(2)}×`,
      note: `${r.fundVolatilityPct.toFixed(0)}% annualised vs the benchmark's ${r.benchmarkVolatilityPct!.toFixed(0)}%`,
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">When this works</h3>
        <p className="text-caption text-muted">
          Behaviour by environment across {(r.alignedDays / 252).toFixed(1)} years of shared trading days
          {r.monthsSampled > 0 ? ` · ${r.monthsSampled} months sampled` : ""}
        </p>
      </div>

      {r.summary && (
        <p className="text-sm leading-6 text-muted">
          {r.summary}
          <BasisMark basis="read" />
        </p>
      )}

      {stats.length > 0 && (
        <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5 bg-surface p-3">
              <dt className="text-micro font-semibold uppercase tracking-widest text-faint">{s.label}</dt>
              <dd className="font-mono text-sm tabular-nums text-foreground">
                {s.value}
                <BasisMark basis="calc" />
              </dd>
              <p className="text-micro leading-4 text-muted">{s.note}</p>
            </div>
          ))}
        </dl>
      )}

      {/* The dated episodes behind the capture ratios — "how did it behave in
          the last three bad stretches", which is the question the ratios
          summarise and readers immediately want itemised. */}
      {r.episodes.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-caption font-medium uppercase tracking-wider text-muted">
            Through the benchmark&apos;s worst stretches
          </span>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] text-left">
              <thead>
                <tr className="text-micro uppercase tracking-widest text-faint">
                  <th className="pb-1.5 font-semibold">Period</th>
                  <th className="pb-1.5 text-right font-semibold">{benchmarkLabel}</th>
                  <th className="pb-1.5 text-right font-semibold">This fund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.episodes.map((e) => (
                  <tr key={e.fromDate} className="text-sm">
                    <td className="py-1.5 font-mono text-caption text-muted">{e.fromDate} → {e.toDate}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted">{e.benchmarkPct.toFixed(1)}%</td>
                    <td className={`py-1.5 text-right font-mono tabular-nums ${e.edgePct >= 0 ? "text-positive" : "text-negative"}`}>
                      {e.fundPct.toFixed(1)}%
                      <span className="ml-1 text-micro text-faint">
                        {e.edgePct >= 0 ? "+" : ""}{e.edgePct.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border/60 pt-3">
        <p className="text-micro leading-5 text-faint">
          Capture ratios compare summed monthly moves in the months the benchmark rose or fell. Episodes are the
          benchmark&apos;s peak-to-trough slides of 8% or more within this window, with the fund&apos;s move over the
          same dates. Past behaviour under these conditions, not a forecast of the next ones.
          {r.fundMaxDrawdownPct != null && ` Its own worst peak-to-trough here was ${r.fundMaxDrawdownPct.toFixed(1)}%.`}
        </p>
        <BasisLegend />
      </div>
    </section>
  );
}
