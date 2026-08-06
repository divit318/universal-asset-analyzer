"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FundamentalsSnapshot, ValuationPoint } from "@/lib/types";
import { useChartTheme } from "@/app/_components/chart-theme";
import { formatRatio } from "@/lib/format";

/* Categorical series colors — theme-neutral. Structural axis/grid/tooltip come
   from useChartTheme() inside the component (light-mode aware). */
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";

type Metric = "pe" | "ps";

interface TooltipPayloadItem {
  dataKey: string;
  value: number | null;
  color: string;
}

function ValTooltip({
  active,
  payload,
  label,
  metric,
  style,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: string | number;
  metric: Metric;
  style?: React.CSSProperties;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div style={style}>
      <p className="mb-1 text-xs text-muted">{label}</p>
      {v != null && (
        <p className="font-mono text-sm font-medium">
          {v.toFixed(metric === "pe" ? 1 : 2)}x
        </p>
      )}
    </div>
  );
}

function StatChip({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-sm font-medium ${highlight ? "text-accent" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export function ValuationHistoryChart({
  valuation,
  snapshot,
}: {
  valuation: ValuationPoint[];
  snapshot: FundamentalsSnapshot;
}) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid;
  const [metric, setMetric] = useState<Metric>("pe");

  const filtered = useMemo(
    () => valuation.filter((p) => (metric === "pe" ? p.peRatio != null : p.psRatio != null)),
    [valuation, metric],
  );

  const values = filtered.map((p) =>
    metric === "pe" ? p.peRatio! : p.psRatio!,
  );
  const avg = values.length
    ? parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1))
    : null;
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  // Current ratio from snapshot
  const current =
    metric === "pe"
      ? snapshot.trailingPE
      : null; // P/S not in snapshot, leave as null

  const chartData = filtered.map((p) => ({
    year: p.year,
    value: metric === "pe" ? p.peRatio : p.psRatio,
  }));

  const label = metric === "pe" ? "Trailing P/E" : "Price / Sales";
  const color = metric === "pe" ? BLUE : AMBER;

  // When the Now and Avg reference lines sit close together their labels
  // overlap at the same right edge — split them to opposite ends of the line.
  const labelsCollide =
    avg != null && current != null && max != null && min != null &&
    Math.abs(current - avg) < Math.max((max - min) * 0.2, avg * 0.12);

  if (valuation.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      {/* Header + metric toggle */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Valuation History</h3>
          <p className="text-xs text-muted">Annual {label} — how cheap or expensive vs. history</p>
        </div>
        <div className="flex items-center gap-0.5">
          {(["pe", "ps"] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                metric === m
                  ? "bg-accent-strong text-background"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {m === "pe" ? "P/E" : "P/S"}
            </button>
          ))}
        </div>
      </div>

      {chartData.length >= 2 ? (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis
                dataKey="year"
                stroke={AXIS}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke={AXIS}
                tick={{ fontSize: 11, fill: AXIS }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${v.toFixed(0)}x`}
                domain={[
                  (dataMin: number) => Math.max(0, dataMin * 0.85),
                  (dataMax: number) => dataMax * 1.1,
                ]}
              />
              <Tooltip content={<ValTooltip metric={metric} style={ct.tooltip} />} />

              {/* Historical average band */}
              {avg != null && (
                <ReferenceLine
                  y={avg}
                  stroke={AXIS}
                  strokeDasharray="5 3"
                  strokeOpacity={0.6}
                  label={{
                    value: `Avg ${formatRatio(avg)}`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: AXIS,
                  }}
                />
              )}

              {/* Current value from snapshot */}
              {current != null && (
                <ReferenceLine
                  y={current}
                  stroke={color}
                  strokeDasharray="4 2"
                  strokeOpacity={0.7}
                  label={{
                    value: `Now ${formatRatio(current)}`,
                    position: labelsCollide ? "insideBottomLeft" : "insideBottomRight",
                    fontSize: 10,
                    fill: color,
                  }}
                />
              )}

              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                dot={{ r: 3, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Stats footer */}
          <div className="flex flex-wrap gap-6 border-t border-border pt-3">
            {current != null && (
              <StatChip label="Current" value={formatRatio(current)} highlight />
            )}
            {avg != null && <StatChip label="5yr Avg" value={formatRatio(avg)} />}
            {min != null && <StatChip label="5yr Min" value={formatRatio(min)} />}
            {max != null && <StatChip label="5yr Max" value={formatRatio(max)} />}
            {avg != null && current != null && (
              <StatChip
                label="vs Avg"
                value={`${current > avg ? "+" : ""}${(((current - avg) / avg) * 100).toFixed(0)}%`}
              />
            )}
          </div>
        </>
      ) : (
        <div className="flex h-40 items-center justify-center text-sm text-muted">
          Insufficient historical valuation data
        </div>
      )}
    </div>
  );
}
