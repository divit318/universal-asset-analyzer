"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProxyPerformance, ProxySeriesPoint } from "@/lib/thematic-engine";
import { useChartTheme } from "@/app/_components/chart-theme";
import { formatPercent } from "@/lib/format";

/** Rebase a close series to 100 at its first point — like-for-like comparison. */
function rebase(series: ProxySeriesPoint[]): Map<string, number> {
  const base = series[0]?.close;
  const out = new Map<string, number>();
  if (!base || base <= 0) return out;
  for (const p of series) out.set(p.date, +((p.close / base) * 100).toFixed(1));
  return out;
}

/**
 * How the theme has actually traded (PR-3): the matched proxies vs SPY over
 * the last year, rebased to 100, with each proxy's max drawdown stated below.
 * Answers "how has this theme traded" before the narrative about it — the
 * engine always had this data and kept only three deltas.
 */
export function ProxyPerformanceChart({ performance }: { performance: ProxyPerformance | null | undefined }) {
  const ct = useChartTheme();
  if (!performance || performance.proxies.length === 0) return null;

  const proxyMaps = performance.proxies.map((p) => ({ ...p, byDate: rebase(p.series) }));
  const benchmarkMap = performance.benchmark ? rebase(performance.benchmark.series) : null;

  // One row per date the first proxy has; the others join by date so a
  // missing point renders as a gap rather than a misaligned line.
  const dates = performance.proxies[0].series.map((p) => p.date);
  const data = dates.map((date) => {
    const row: Record<string, string | number | null> = { date };
    for (const p of proxyMaps) row[p.ticker] = p.byDate.get(date) ?? null;
    if (benchmarkMap && performance.benchmark) row[performance.benchmark.ticker] = benchmarkMap.get(date) ?? null;
    return row;
  });

  return (
    <div className="flex flex-col gap-2">
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis dataKey="date" stroke={ct.axis} tick={{ fontSize: 11 }} minTickGap={40} />
          <YAxis stroke={ct.axis} tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
          <Tooltip contentStyle={ct.tooltip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {proxyMaps.map((p, i) => (
            <Line
              key={p.ticker}
              type="monotone"
              dataKey={p.ticker}
              stroke={ct.series[i % ct.series.length]}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
          {performance.benchmark && (
            <Line
              type="monotone"
              dataKey={performance.benchmark.ticker}
              stroke={ct.axis}
              dot={false}
              strokeWidth={2}
              strokeDasharray="4 3"
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs leading-relaxed text-muted">
        Rebased to 100 one year ago — above the dashed {performance.benchmark?.ticker ?? "benchmark"} line means the
        theme beat just owning the market. Max drawdown over the window:{" "}
        {performance.proxies
          .map((p) => `${p.ticker} ${p.maxDrawdown1Y != null ? formatPercent(p.maxDrawdown1Y, 1) : "—"}`)
          .join(" · ")}
        .
      </p>
    </div>
  );
}
