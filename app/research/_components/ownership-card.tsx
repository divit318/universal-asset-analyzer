"use client";

import type { OwnershipData } from "@/lib/types";
import { describeOwnership } from "@/lib/ownership-insight";
import { Reveal } from "@/app/_components/reveal";
import { ValueBar } from "@/app/_components/value-bar";

function pct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(decimals)}%`;
}

function compact(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function MetricBox({
  label,
  value,
  sub,
  barValue,
  barColorClass = "bg-accent/60",
  highlight,
  index,
}: {
  label: string;
  value: string;
  sub?: string;
  barValue?: number;
  barColorClass?: string;
  highlight?: "positive" | "negative" | "neutral";
  index: number;
}) {
  const valueClass =
    highlight === "positive"
      ? "text-positive"
      : highlight === "negative"
        ? "text-negative"
        : "text-foreground";

  return (
    <Reveal index={index} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-xl font-semibold ${valueClass}`}>{value}</span>
      {barValue != null && <ValueBar value={barValue} barClassName={barColorClass} height="h-1.5" />}
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </Reveal>
  );
}

/**
 * Deterministic (non-AI) ownership interpretation — modeled on India's
 * TrendInsight (ownership-timeline.tsx), scoped to what Yahoo's ownership
 * snapshot actually provides. Yahoo has no historical shareholding series
 * (screener.in does, which is why India gets a timeline and the US doesn't)
 * — this reads institutional conviction, insider alignment, and retail
 * positioning from the current snapshot instead of a trend.
 */
function OwnershipInsight({ ownership }: { ownership: OwnershipData }) {
  const insights = describeOwnership(ownership);
  if (insights.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Ownership Analysis</span>
      {insights.map((ins, i) => (
        <Reveal key={i} as="p" index={i} className="text-xs leading-5 text-muted">{ins}</Reveal>
      ))}
    </div>
  );
}

export function OwnershipCard({ ownership }: { ownership: OwnershipData }) {
  const {
    institutionsPctHeld,
    insidersPctHeld,
    institutionsCount,
    shortPctOfFloat,
    shortRatio,
    sharesShort,
  } = ownership;
  const topHolders = ownership.topHolders ?? [];

  const shortPct = shortPctOfFloat != null ? shortPctOfFloat * 100 : null;
  const shortHighlight =
    shortPct == null ? "neutral" : shortPct > 10 ? "negative" : shortPct > 5 ? "neutral" : "positive";

  // Yahoo occasionally reports institutional ownership above 100% (13F
  // double-counting). A progress bar cannot honestly show >100%, so the raw
  // figure renders with a footnote and no bar.
  const instOverCounted = institutionsPctHeld != null && institutionsPctHeld > 1;
  // Whole column is dropped when no holder reports a share count (all dashes
  // reads as broken data, not as sparse data).
  const hasShares = (ownership.topHolders ?? []).some((h) => h.shares != null);

  return (
    <div className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-medium">Ownership &amp; Short Interest</h3>
        <p className="text-xs text-muted">Institutional holdings, insider stake, short sellers</p>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricBox
          index={0}
          label="Institutional"
          value={pct(institutionsPctHeld)}
          barValue={institutionsPctHeld != null && !instOverCounted ? institutionsPctHeld * 100 : undefined}
          barColorClass="bg-accent/60"
          sub={
            instOverCounted
              ? ">100% — 13F double-counting artifact"
              : institutionsCount != null ? `${institutionsCount.toLocaleString()} holders` : undefined
          }
        />
        <MetricBox
          index={1}
          label="Insiders"
          // A 0.3% stake renders as a sub-pixel sliver; give any nonzero stake
          // a minimum visible width. Value text stays exact — the bar is a cue.
          value={pct(insidersPctHeld)}
          barValue={insidersPctHeld != null ? Math.max(insidersPctHeld * 100, insidersPctHeld > 0 ? 2 : 0) : undefined}
          barColorClass="bg-warning/70"
          sub="officers & directors"
        />
        <MetricBox
          index={2}
          label="Short % Float"
          value={pct(shortPctOfFloat)}
          barValue={shortPct != null ? Math.min(shortPct * 2, 100) : undefined}
          barColorClass={
            shortHighlight === "negative"
              ? "bg-negative"
              : shortHighlight === "neutral"
                ? "bg-warning/70"
                : "bg-positive"
          }
          highlight={shortHighlight}
          sub={sharesShort != null ? `${compact(sharesShort)} shares short` : undefined}
        />
        <MetricBox
          index={3}
          label="Days to Cover"
          value={shortRatio != null ? `${shortRatio.toFixed(1)}d` : "—"}
          sub="short interest ratio"
          // 5 days to cover is unremarkable for a large-cap. Red is reserved
          // for genuinely elevated squeeze/covering risk (>10 days).
          highlight={
            shortRatio == null ? "neutral" : shortRatio > 10 ? "negative" : "neutral"
          }
        />
      </div>

      {/* Ownership Analysis — institutional conviction, insider alignment, short interest */}
      <OwnershipInsight ownership={ownership} />

      {/* Top institutional holders table */}
      {topHolders.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted">
            Top Institutional Holders
          </h4>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2/50">
                  <th className="px-3 py-2 text-left font-medium text-muted">Institution</th>
                  <th className="px-3 py-2 text-right font-medium text-muted">% Held</th>
                  {hasShares && (
                    <th className="hidden px-3 py-2 text-right font-medium text-muted sm:table-cell">
                      Shares
                    </th>
                  )}
                  <th className="hidden px-3 py-2 text-right font-medium text-muted sm:table-cell">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topHolders.map((h, i) => (
                  <Reveal key={i} as="tr" index={i} className="bg-surface transition-colors hover:bg-surface-2/40">
                    <td className="px-3 py-2 font-medium">{h.name}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {h.pctHeld != null ? pct(h.pctHeld, 2) : "—"}
                    </td>
                    {hasShares && (
                      <td className="hidden px-3 py-2 text-right font-mono text-muted sm:table-cell">
                        {compact(h.shares)}
                      </td>
                    )}
                    <td className="hidden px-3 py-2 text-right font-mono text-muted sm:table-cell">
                      {h.value != null ? `$${compact(h.value)}` : "—"}
                    </td>
                  </Reveal>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
