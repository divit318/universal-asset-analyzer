"use client";

import type { OwnershipData } from "@/lib/types";

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

function ProgressBar({ value, color = "bg-blue-500" }: { value: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={`h-full rounded-full ${color} transition-all`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function MetricBox({
  label,
  value,
  sub,
  barValue,
  barColor,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  barValue?: number;
  barColor?: string;
  highlight?: "positive" | "negative" | "neutral";
}) {
  const valueClass =
    highlight === "positive"
      ? "text-positive"
      : highlight === "negative"
        ? "text-negative"
        : "text-foreground";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-xl font-semibold ${valueClass}`}>{value}</span>
      {barValue != null && <ProgressBar value={barValue} color={barColor} />}
      {sub && <span className="text-xs text-muted">{sub}</span>}
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

  // Short interest risk level
  const shortPct = shortPctOfFloat != null ? shortPctOfFloat * 100 : null;
  const shortHighlight =
    shortPct == null ? "neutral" : shortPct > 10 ? "negative" : shortPct > 5 ? "neutral" : "positive";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-medium">Ownership &amp; Short Interest</h3>
        <p className="text-xs text-muted">Institutional holdings, insider stake, short sellers</p>
      </div>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricBox
          label="Institutional"
          value={pct(institutionsPctHeld)}
          barValue={institutionsPctHeld != null ? institutionsPctHeld * 100 : undefined}
          barColor="bg-blue-500"
          sub={institutionsCount != null ? `${institutionsCount.toLocaleString()} holders` : undefined}
        />
        <MetricBox
          label="Insiders"
          value={pct(insidersPctHeld)}
          barValue={insidersPctHeld != null ? insidersPctHeld * 100 : undefined}
          barColor="bg-amber-500"
          sub="officers & directors"
        />
        <MetricBox
          label="Short % Float"
          value={pct(shortPctOfFloat)}
          barValue={shortPct != null ? Math.min(shortPct * 2, 100) : undefined}
          barColor={
            shortHighlight === "negative"
              ? "bg-red-500"
              : shortHighlight === "neutral"
                ? "bg-amber-500"
                : "bg-green-500"
          }
          highlight={shortHighlight}
          sub={sharesShort != null ? `${compact(sharesShort)} shares short` : undefined}
        />
        <MetricBox
          label="Days to Cover"
          value={shortRatio != null ? `${shortRatio.toFixed(1)}d` : "—"}
          sub="short interest ratio"
          highlight={
            shortRatio == null ? "neutral" : shortRatio > 5 ? "negative" : "neutral"
          }
        />
      </div>

      {/* Short interest context */}
      {shortPct != null && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            shortPct > 10
              ? "border border-negative/30 bg-negative/10 text-negative"
              : shortPct > 5
                ? "border border-amber-500/30 bg-amber-500/10 text-amber-400"
                : "border border-positive/30 bg-positive/10 text-positive"
          }`}
        >
          {shortPct > 10
            ? `High short interest (${pct(shortPctOfFloat)}) — elevated squeeze risk or bearish sentiment.`
            : shortPct > 5
              ? `Moderate short interest (${pct(shortPctOfFloat)}) — worth monitoring for position changes.`
              : `Low short interest (${pct(shortPctOfFloat)}) — shorts are not a major factor.`}
        </div>
      )}

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
                  <th className="hidden px-3 py-2 text-right font-medium text-muted sm:table-cell">
                    Shares
                  </th>
                  <th className="hidden px-3 py-2 text-right font-medium text-muted sm:table-cell">
                    Value
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topHolders.map((h, i) => (
                  <tr key={i} className="bg-surface transition-colors hover:bg-surface-2/40">
                    <td className="px-3 py-2 font-medium">{h.name}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {h.pctHeld != null ? pct(h.pctHeld, 2) : "—"}
                    </td>
                    <td className="hidden px-3 py-2 text-right font-mono text-muted sm:table-cell">
                      {compact(h.shares)}
                    </td>
                    <td className="hidden px-3 py-2 text-right font-mono text-muted sm:table-cell">
                      {h.value != null ? `$${compact(h.value)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
