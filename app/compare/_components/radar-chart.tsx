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
import type { CompareEntry } from "@/app/api/compare/route";
import { CHART_SERIES, useChartTheme } from "@/app/_components/chart-theme";
import { useHoverSymbol } from "./hover-symbol-context";

const COLORS = CHART_SERIES;

function bucketPct(score: NonNullable<CompareEntry["score"]>, name: string): number {
  const b = score.buckets.find((bk) => bk.name === name);
  return b ? Math.round((b.points / b.max) * 100) : 50;
}

const AXES = [
  { key: "Valuation", label: "Valuation" },
  { key: "Growth", label: "Growth" },
  { key: "Quality", label: "Quality" },
  { key: "Health", label: "Health" },
  { key: "Momentum", label: "Momentum" },
  { key: "Analyst", label: "Analyst" },
];

interface Props {
  entries: CompareEntry[];
}

export function CompareRadar({ entries }: Props) {
  const ct = useChartTheme();
  const { hovered, setHovered } = useHoverSymbol();
  const valid = entries.filter((e) => !e.error && e.score);

  const data = AXES.map(({ key, label }) => {
    const point: Record<string, number | string> = { subject: label };
    for (const e of valid) {
      const s = e.score!;
      if (key === "Valuation") point[e.symbol] = bucketPct(s, "Valuation");
      else if (key === "Growth") point[e.symbol] = bucketPct(s, "Growth");
      else if (key === "Quality") point[e.symbol] = bucketPct(s, "Quality");
      else if (key === "Health") point[e.symbol] = bucketPct(s, "Financial Health");
      else if (key === "Momentum") point[e.symbol] = s.signals.momentum ?? 50;
      else if (key === "Analyst") point[e.symbol] = s.signals.analysts ?? 50;
    }
    return point;
  });

  if (valid.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-4 text-sm font-semibold text-muted uppercase tracking-wide">Score Radar</h2>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke={ct.grid} strokeOpacity={0.5} />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: ct.axis, fontSize: 11 }}
          />
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
