"use client";

import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import type { ClassCompareEntry } from "@/lib/compare/types";
import { CHART_SERIES, useChartTheme } from "@/app/_components/chart-theme";
import { useHoverSymbol } from "./hover-symbol-context";

const COLORS = CHART_SERIES;

interface Props {
  entries: ClassCompareEntry[];
}

/**
 * The non-equity counterpart to app/compare/_components/radar-chart.tsx.
 * Equity's radar hardcodes its 6 score buckets; every other class instead
 * carries its own composite-score axes on the entry itself
 * (lib/compare/composite-scores.ts), so this component just plots whatever
 * axes the class computed — same visual language, no per-class branching.
 */
export function ClassCompareRadar({ entries }: Props) {
  const ct = useChartTheme();
  const { hovered, setHovered } = useHoverSymbol();
  const valid = entries.filter((e) => !e.error && e.scores.axes.length > 0);
  if (valid.length === 0) return null;

  const axisKeys = valid[0].scores.axes.map((a) => a.key);
  const data = axisKeys.map((key) => {
    const first = valid.find((e) => e.scores.axes.some((a) => a.key === key));
    const label = first?.scores.axes.find((a) => a.key === key)?.label ?? key;
    const point: Record<string, number | string> = { subject: label };
    for (const e of valid) {
      point[e.symbol] = e.scores.axes.find((a) => a.key === key)?.value ?? 0;
    }
    return point;
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-4 text-sm font-semibold text-muted uppercase tracking-wide">Score Radar</h2>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke={ct.grid} strokeOpacity={0.5} />
          <PolarAngleAxis dataKey="subject" tick={{ fill: ct.axis, fontSize: 11 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {valid.map((e, i) => {
            const isActive = hovered === e.symbol;
            const isDimmed = hovered != null && !isActive;
            return (
              <Radar
                key={e.symbol}
                name={e.symbol}
                dataKey={e.symbol}
                stroke={COLORS[i % COLORS.length]}
                fill={COLORS[i % COLORS.length]}
                fillOpacity={isActive ? 0.22 : isDimmed ? 0.05 : 0.12}
                strokeWidth={isActive ? 2.6 : 2}
                strokeOpacity={isDimmed ? 0.4 : 1}
                onMouseEnter={() => setHovered(e.symbol)}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
          <Legend
            onMouseEnter={(item) => setHovered(String(item.value))}
            onMouseLeave={() => setHovered(null)}
            formatter={(value) => (
              <span style={{ color: COLORS[valid.findIndex((e) => e.symbol === value) % COLORS.length], fontSize: 12, fontFamily: "monospace", fontWeight: 600 }}>
                {value}
              </span>
            )}
          />
          <Tooltip
            contentStyle={ct.tooltip}
            formatter={(value) => [`${Number(value).toFixed(0)}/100`]}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
