"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import type { ClassCompareEntry } from "@/lib/compare/types";
import { CHART_SERIES, useChartTheme } from "@/app/_components/chart-theme";

const COLORS = CHART_SERIES;

export interface ScatterAxis {
  key: string;
  label: string;
  format: (v: number) => string;
}

interface Props {
  entries: ClassCompareEntry[];
  title: string;
  /** e.g. "Cheaper, higher-returning funds sit toward the top-left." */
  subtitle?: string;
  x: ScatterAxis;
  y: ScatterAxis;
  /** Optional third dimension encoded as bubble size (e.g. AUM, market cap) — turns a plain dot plot into a real bubble chart instead of every point reading as equally significant. */
  size?: ScatterAxis;
}

interface Point {
  symbol: string;
  x: number;
  y: number;
  z: number;
}

/**
 * A generic two-metric scatter — the signature chart for asset classes where
 * the real comparison is "how do these two numbers trade off against each
 * other" rather than a single ranked score: cost vs. return (ETF), FFO yield
 * vs. leverage (REIT), yield vs. duration (Bond), carry vs. volatility
 * (Forex). One component, four different metric pairs — the framework spec
 * calls these out as genuinely different questions, not the same chart
 * relabeled, so this stays metric-agnostic rather than hardcoding any one
 * class's axes.
 */
export function CompareScatterChart({ entries, title, subtitle, x, y, size }: Props) {
  const ct = useChartTheme();
  const valid = entries.filter((e) => !e.error);

  const points: (Point & { idx: number })[] = valid
    .map((e, idx) => {
      const xv = e.metrics[x.key];
      const yv = e.metrics[y.key];
      if (xv == null || yv == null) return null;
      const zv = size ? e.metrics[size.key] : null;
      return { symbol: e.symbol, x: xv, y: yv, z: zv ?? 1, idx };
    })
    .filter((p): p is Point & { idx: number } => p != null);

  if (points.length === 0) return null;

  // Bubble size only means something when every point actually has the size
  // metric — otherwise a missing value would silently read as "smallest",
  // which is worse than just falling back to uniform dots.
  const hasSize = Boolean(size) && points.every((p) => p.z > 0);
  const zDomain: [number, number] | undefined = hasSize
    ? [Math.min(...points.map((p) => p.z)), Math.max(...points.map((p) => p.z))]
    : undefined;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide">{title}</h2>
        {hasSize && size && <span className="text-label text-muted">bubble size = {size.label}</span>}
      </div>
      {subtitle && <p className="mb-3 text-xs text-muted">{subtitle}</p>}
      <ResponsiveContainer width="100%" height={300}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
          <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="x"
            name={x.label}
            tick={{ fill: ct.axis, fontSize: 11 }}
            tickFormatter={(v: number) => x.format(v)}
            label={{ value: x.label, position: "insideBottom", offset: -10, fill: ct.axis, fontSize: 11 }}
            domain={["auto", "auto"]}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={y.label}
            tick={{ fill: ct.axis, fontSize: 11 }}
            tickFormatter={(v: number) => y.format(v)}
            label={{ value: y.label, angle: -90, position: "insideLeft", fill: ct.axis, fontSize: 11 }}
            domain={["auto", "auto"]}
          />
          {hasSize ? (
            <ZAxis dataKey="z" range={[80, 500]} domain={zDomain} />
          ) : (
            <ZAxis range={[140, 140]} />
          )}
          <Tooltip
            cursor={{ strokeDasharray: "3 3", stroke: ct.axis }}
            contentStyle={ct.tooltip}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as Point;
              return (
                <div style={ct.tooltip}>
                  <p style={{ fontFamily: "monospace", fontWeight: 700, marginBottom: 4 }}>{p.symbol}</p>
                  <p style={{ fontSize: 11 }}>{x.label}: <span style={{ fontFamily: "monospace" }}>{x.format(p.x)}</span></p>
                  <p style={{ fontSize: 11 }}>{y.label}: <span style={{ fontFamily: "monospace" }}>{y.format(p.y)}</span></p>
                  {hasSize && size && (
                    <p style={{ fontSize: 11 }}>{size.label}: <span style={{ fontFamily: "monospace" }}>{size.format(p.z)}</span></p>
                  )}
                </div>
              );
            }}
          />
          <Scatter data={points} shape="circle">
            {points.map((p) => (
              <Cell key={p.symbol} fill={COLORS[p.idx % COLORS.length]} fillOpacity={0.75} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1">
        {points.map((p) => (
          <div key={p.symbol} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[p.idx % COLORS.length] }} />
            <span className="font-mono font-semibold" style={{ color: COLORS[p.idx % COLORS.length] }}>{p.symbol}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
