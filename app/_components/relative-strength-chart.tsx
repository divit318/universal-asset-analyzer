"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HistoryPoint } from "@/lib/types";
import { useChartTheme } from "@/app/_components/chart-theme";

/** Rebase a close-price series to 100 at its first point, for like-for-like relative comparison. */
function rebase(history: HistoryPoint[]): { date: string; value: number }[] {
  const closes = history.map((h) => h.adjClose ?? h.close).filter((c) => c > 0);
  if (closes.length === 0) return [];
  const base = closes[0];
  return history
    .filter((h) => (h.adjClose ?? h.close) > 0)
    .map((h) => ({ date: h.date, value: +(((h.adjClose ?? h.close) / base) * 100).toFixed(1) }));
}

/**
 * Shared "vs its asset-class benchmark" chart — crypto compares against BTC,
 * commodities against a commodity index ETF (DBC); same rebased-to-100
 * mechanics either way, just a different benchmark series/label per caller.
 */
export function RelativeStrengthChart({
  symbol,
  history,
  benchmarkHistory,
  benchmarkLabel,
}: {
  symbol: string;
  history: HistoryPoint[];
  benchmarkHistory: HistoryPoint[];
  benchmarkLabel: string;
}) {
  const ct = useChartTheme();

  if (benchmarkHistory.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-medium">Relative Strength vs {benchmarkLabel}</h3>
        <p className="text-xs text-muted">Not applicable — no benchmark to compare against itself.</p>
      </div>
    );
  }

  const assetSeries = rebase(history);
  const benchmarkSeries = rebase(benchmarkHistory);
  const benchmarkByDate = new Map(benchmarkSeries.map((p) => [p.date, p.value]));
  const data = assetSeries.map((p) => ({ date: p.date, [symbol]: p.value, [benchmarkLabel]: benchmarkByDate.get(p.date) ?? null }));

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">Relative Strength vs {benchmarkLabel}</h3>
      <p className="mb-2 text-xs text-muted">Rebased to 100 at the start of the window — outperformance = line above {benchmarkLabel}</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis dataKey="date" stroke={ct.axis} tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis stroke={ct.axis} tick={{ fontSize: 12 }} />
          <Tooltip contentStyle={ct.tooltip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey={symbol} stroke={ct.series[0]} dot={false} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey={benchmarkLabel} stroke={ct.axis} dot={false} strokeWidth={2} strokeDasharray="4 3" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
