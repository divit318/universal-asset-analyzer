"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EarningsData } from "@/lib/types";
import { useChartTheme } from "@/app/_components/chart-theme";

// Structural + semantic chart colors come from useChartTheme() inside the
// component so they adapt to light/dark (Recharts can't read CSS vars directly).

function daysUntil(isoDate: string): number {
  return Math.ceil(
    (new Date(isoDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
}

function fmtDaysUntil(days: number): string {
  if (days < 0) return "reported";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 13) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

interface TooltipPayloadItem {
  dataKey: string;
  value: number | null;
  payload: {
    quarter: string;
    epsActual: number | null;
    epsEstimate: number | null;
    surprisePercent: number | null;
    beat: boolean;
  };
}

function EarningsTooltip({
  active,
  payload,
  style,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  style?: React.CSSProperties;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={style}>
      <p className="mb-1.5 font-medium">{d.quarter}</p>
      {d.epsActual != null && (
        <p className="flex gap-2 text-xs">
          <span className={d.beat ? "text-positive" : "text-negative"}>Actual</span>
          <span className="font-mono">${d.epsActual.toFixed(2)}</span>
        </p>
      )}
      {d.epsEstimate != null && (
        <p className="flex gap-2 text-xs">
          <span className="text-muted">Estimate</span>
          <span className="font-mono">${d.epsEstimate.toFixed(2)}</span>
        </p>
      )}
      {d.surprisePercent != null && (
        <p className="mt-1 flex gap-2 text-xs">
          <span className="text-muted">Surprise</span>
          <span
            className={`font-mono font-medium ${d.beat ? "text-positive" : "text-negative"}`}
          >
            {d.beat ? "+" : ""}
            {(d.surprisePercent * 100).toFixed(1)}%
          </span>
        </p>
      )}
    </div>
  );
}

export function EarningsCard({ earnings }: { earnings: EarningsData }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid, MUTED = ct.axis, POSITIVE = ct.positive, NEGATIVE = ct.negative;
  const { nextDate, nextDateEnd, trailingEps, forwardEps } = earnings;
  const history = earnings.history ?? [];

  const chartData = history.map((pt) => {
    const beat =
      pt.epsActual != null &&
      pt.epsEstimate != null &&
      pt.epsActual >= pt.epsEstimate;
    return {
      ...pt,
      beat,
      surprisePctDisplay:
        pt.surprisePercent != null
          ? `${pt.surprisePercent >= 0 ? "+" : ""}${(pt.surprisePercent * 100).toFixed(0)}%`
          : null,
    };
  });

  const nextDays = nextDate ? daysUntil(nextDate) : null;
  const hasHistory = chartData.length > 0;

  return (
    <div className="card-lift flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Earnings History</h3>
          <p className="text-xs text-muted">EPS actual vs. analyst estimate</p>
        </div>

        {/* Next earnings badge */}
        {nextDate && nextDays !== null && nextDays >= 0 ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className="rounded bg-accent-strong/15 px-2 py-0.5 text-xs font-medium text-accent">
              Next report
            </span>
            <span className="font-mono text-sm font-semibold">
              {new Date(nextDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="text-xs text-muted">
              {nextDateEnd && nextDateEnd !== nextDate
                ? `–${new Date(nextDateEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · `
                : ""}
              {fmtDaysUntil(nextDays)}
            </span>
          </div>
        ) : null}
      </div>

      {/* EPS metrics row */}
      {(trailingEps != null || forwardEps != null) && (
        <div className="flex gap-6">
          {trailingEps != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wide text-muted">TTM EPS</span>
              <span className="font-mono text-sm font-medium">
                ${trailingEps.toFixed(2)}
              </span>
            </div>
          )}
          {forwardEps != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wide text-muted">Fwd EPS</span>
              <span className="font-mono text-sm font-medium">
                ${forwardEps.toFixed(2)}
              </span>
            </div>
          )}
          {trailingEps != null && forwardEps != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs uppercase tracking-wide text-muted">EPS Growth</span>
              <span
                className={`font-mono text-sm font-medium ${forwardEps >= trailingEps ? "text-positive" : "text-negative"}`}
              >
                {forwardEps >= trailingEps ? "+" : ""}
                {(((forwardEps - trailingEps) / Math.abs(trailingEps)) * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* EPS chart */}
      {hasHistory ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={chartData}
            margin={{ top: 16, right: 4, left: 0, bottom: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="quarter"
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
              tickFormatter={(v: number) => `$${v.toFixed(1)}`}
              width={44}
            />
            <ReferenceLine y={0} stroke={GRID} />
            <Tooltip content={<EarningsTooltip style={ct.tooltip} />} cursor={{ fill: ct.cursorFill }} />

            {/* Estimate as a thin background bar */}
            <Bar dataKey="epsEstimate" fill={MUTED} fillOpacity={0.25} radius={[3, 3, 0, 0]} />

            {/* Actual EPS — color by beat/miss */}
            <Bar dataKey="epsActual" radius={[3, 3, 0, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.beat ? POSITIVE : NEGATIVE} fillOpacity={0.85} />
              ))}
              <LabelList
                dataKey="surprisePctDisplay"
                position="top"
                style={{ fontSize: 10, fill: MUTED, fontFamily: "monospace" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-muted">
          No quarterly EPS history available
        </div>
      )}

      {/* Legend */}
      {hasHistory && (
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-positive/85" />
            Beat estimate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-negative/85" />
            Missed estimate
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-muted/25" />
            Consensus estimate
          </span>
        </div>
      )}
    </div>
  );
}
