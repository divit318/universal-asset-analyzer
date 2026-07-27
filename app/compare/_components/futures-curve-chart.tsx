"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ClassCompareEntry } from "@/lib/compare/types";
import { CHART_SERIES, useChartTheme } from "@/app/_components/chart-theme";

const COLORS = CHART_SERIES;

interface CurveDatum {
  monthsOut: number;
  [symbol: string]: number | null;
}

/**
 * Commodity's signature chart — no comparable retail tool shows this. Plots
 * each compared commodity's futures curve (price vs. months to expiry),
 * normalized to % vs. its own front-month contract so a $2,600 gold curve
 * and an $80 oil curve are visually comparable on one axis. A line sloping
 * up is contango (rolling a long position costs you); sloping down is
 * backwardation (the roll pays you) — the shape *is* the signal.
 */
export function FuturesCurveChart({ entries }: { entries: ClassCompareEntry[] }) {
  const ct = useChartTheme();
  const valid = entries.filter((e) => !e.error && e.curvePoints && e.curvePoints.length >= 2);
  if (valid.length === 0) return null;

  const maxMonths = Math.max(...valid.flatMap((e) => e.curvePoints!.map((p) => p.monthsOut)));

  const data: CurveDatum[] = [];
  for (let m = 1; m <= maxMonths; m++) {
    const point: CurveDatum = { monthsOut: m };
    for (const e of valid) {
      const front = e.curvePoints!.find((p) => p.monthsOut === Math.min(...e.curvePoints!.map((q) => q.monthsOut)));
      const at = e.curvePoints!.find((p) => p.monthsOut === m);
      point[e.symbol] = at && front && front.price > 0 ? +(((at.price / front.price) - 1) * 100).toFixed(2) : null;
    }
    data.push(point);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-muted uppercase tracking-wide">Futures Curve</h2>
      <p className="mb-3 text-xs text-muted">
        Price vs. front-month, by contract expiry. Sloping up = contango (rolling a long costs you); sloping down = backwardation (the roll pays you).
      </p>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 24, left: 4, bottom: 10 }}>
          <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="monthsOut"
            tick={{ fill: ct.axis, fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: ct.grid }}
            tickFormatter={(v: number) => `+${v}mo`}
            label={{ value: "Months to expiry", position: "insideBottom", offset: -6, fill: ct.axis, fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: ct.axis, fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v}%`}
            width={54}
          />
          <ReferenceLine y={0} stroke={ct.axis} strokeDasharray="4 4" />
          <Tooltip
            contentStyle={ct.tooltip}
            formatter={(value: unknown, name: unknown) => {
              const v = Number(value);
              return [`${v >= 0 ? "+" : ""}${v.toFixed(2)}%`, String(name)];
            }}
            labelFormatter={(v: unknown) => `+${v} months out`}
          />
          {valid.map((e, i) => (
            <Line
              key={e.symbol}
              type="monotone"
              dataKey={e.symbol}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3, fill: COLORS[i % COLORS.length] }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1">
        {valid.map((e, i) => (
          <div key={e.symbol} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-3 rounded-sm" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="font-mono font-semibold" style={{ color: COLORS[i % COLORS.length] }}>{e.symbol}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
