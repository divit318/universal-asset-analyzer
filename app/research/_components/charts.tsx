"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FinancialStatements, PeerComparison } from "@/lib/types";
import { useChartTheme } from "@/app/_components/chart-theme";
import { formatChartMoneyCompact, formatCompact, formatCompactCurrency } from "@/lib/format";
import { niceTicks } from "@/lib/chart-scale";
import { sectorGroup } from "@/lib/sector";

/* Series colors come from useChartTheme() inside each component alongside the
   structural axis/grid/tooltip — the previous module-level literals (#4ade80,
   #60a5fa, #fbbf24) were the dark palette and washed out to 1.9–2.5:1 on a
   white canvas (2026-08-08 light-mode audit). */

function map(points: { fy: number; value: number }[]): Map<number, number> {
  return new Map(points.map((p) => [p.fy, p.value]));
}

/* -------------------------------------------------------------------------- */
/* Margin trend (gross / operating / net)                                     */
/* -------------------------------------------------------------------------- */

export function MarginTrendChart({ statements, sector }: { statements: FinancialStatements; sector?: string | null }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid, tooltipStyle = ct.tooltip;
  const gm = map(statements.grossMargin);
  const om = map(statements.operatingMargin);
  const nm = map(statements.netMargin);
  const pct = (m: Map<number, number>, fy: number) =>
    m.has(fy) ? +(m.get(fy)! * 100).toFixed(1) : null;

  // Gross margin is not a meaningful metric for a lender/insurer (revenue is
  // interest income, not goods sold) — the metric set is sector-aware.
  const includeGross = sectorGroup(sector) !== "financials";

  const data = statements.fiscalYears.map((fy) => ({
    year: `FY${String(fy).slice(-2)}`,
    ...(includeGross ? { Gross: pct(gm, fy) } : {}),
    Operating: pct(om, fy),
    Net: pct(nm, fy),
  }));

  // Only series that actually carry data render — a legend entry with no
  // visible line reads as a rendering bug.
  const series = [
    ...(includeGross && data.some((d) => (d as Record<string, number | string | null>).Gross != null)
      ? [{ key: "Gross", color: ct.positive }]
      : []),
    ...(data.some((d) => d.Operating != null) ? [{ key: "Operating", color: ct.blue }] : []),
    ...(data.some((d) => d.Net != null) ? [{ key: "Net", color: ct.amber }] : []),
  ];
  if (series.length === 0) return null;

  // Fit the axis to the data (± padding) instead of always spanning 0–max:
  // a flat 22% net margin plotted on a 0–28% axis wastes most of the panel.
  const values = data.flatMap((d) =>
    series.map((s) => (d as Record<string, number | string | null>)[s.key]).filter((v): v is number => typeof v === "number"),
  );
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.25, 1.5);
  // Don't extend below zero for all-positive margins; never clip a real loss.
  const floor = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const ticks = niceTicks(floor, hi + pad, 5);

  const subtitle = `${series.map((s) => s.key).join(" / ")}, % of revenue${includeGross ? "" : " (gross margin omitted — not meaningful for financials)"}`;

  return (
    <ChartFrame title="Margin trend" subtitle={subtitle}>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" stroke={AXIS} tick={{ fontSize: 12 }} />
          <YAxis
            stroke={AXIS}
            tick={{ fontSize: 12 }}
            unit="%"
            ticks={ticks}
            domain={ticks.length >= 2 ? [ticks[0], ticks[ticks.length - 1]] : undefined}
          />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={s.color}
              fill={s.color}
              fillOpacity={0.12}
              strokeWidth={2}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Revenue + free cash flow                                                   */
/* -------------------------------------------------------------------------- */

export function RevenueFcfChart({
  statements,
  currency,
}: {
  statements: FinancialStatements;
  /**
   * Reporting currency of the statement figures — statementsCurrency(...) at
   * the call site (financialCurrency, ADR-safe, falling back to the listing
   * currency). Absent → unlabelled magnitudes, never assumed dollars.
   */
  currency?: string | null;
}) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid, tooltipStyle = ct.tooltip;
  const rev = map(statements.revenue);
  const fcf = map(statements.freeCashFlow);
  const raw = (m: Map<number, number>, fy: number) => (m.has(fy) ? m.get(fy)! : null);

  // Raw currency units — the axis and tooltip compact them in the currency's
  // own convention (₹ crore, ¥ trillions) instead of a hardwired "$ billions".
  const data = statements.fiscalYears.map((fy) => ({
    year: `FY${String(fy).slice(-2)}`,
    Revenue: raw(rev, fy),
    "Free cash flow": raw(fcf, fy),
  }));

  const fmtTick = (v: number) => formatChartMoneyCompact(v, currency);
  const fmtValue = (v: unknown) =>
    currency ? formatCompactCurrency(Number(v), currency) : formatCompact(Number(v));

  return (
    <ChartFrame
      title="Revenue & free cash flow"
      subtitle={currency ? `by fiscal year, in ${currency.toUpperCase()}` : "by fiscal year"}
    >
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" stroke={AXIS} tick={{ fontSize: 12 }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12 }} tickFormatter={fmtTick} />
          <Tooltip contentStyle={tooltipStyle} formatter={fmtValue} cursor={{ fill: ct.cursorFill }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill={ct.blue} radius={[3, 3, 0, 0]} />
          <Bar dataKey="Free cash flow" fill={ct.positive} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Peer comparison radar (normalized so outward = more attractive)            */
/* -------------------------------------------------------------------------- */

const clamp = (v: number) => Math.max(0, Math.min(100, v));
// Each metric → 0-100 attractiveness (higher is better, P/E and D/E inverted).
const norm = {
  pe: (v: number | null) => (v == null ? null : clamp(100 - (v / 50) * 100)),
  roe: (v: number | null) => (v == null ? null : clamp((v / 0.4) * 100)),
  revenueGrowth: (v: number | null) => (v == null ? null : clamp(((v + 0.1) / 0.6) * 100)),
  debtToEquity: (v: number | null) => (v == null ? null : clamp(100 - (v / 2) * 100)),
};

export function PeerRadarChart({ peers, symbol }: { peers: PeerComparison; symbol: string }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid, tooltipStyle = ct.tooltip;
  const data = [
    { metric: "P/E", This: norm.pe(peers.target.pe), Peers: norm.pe(peers.median.pe) },
    { metric: "ROE", This: norm.roe(peers.target.roe), Peers: norm.roe(peers.median.roe) },
    { metric: "Rev growth", This: norm.revenueGrowth(peers.target.revenueGrowth), Peers: norm.revenueGrowth(peers.median.revenueGrowth) },
    { metric: "Low debt", This: norm.debtToEquity(peers.target.debtToEquity), Peers: norm.debtToEquity(peers.median.debtToEquity) },
  ];

  return (
    <ChartFrame
      title="Peer comparison"
      subtitle={`${symbol} vs ${peers.sector} median (n=${peers.peerCount}) · outward = more attractive`}
    >
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke={GRID} />
          <PolarAngleAxis dataKey="metric" tick={{ fill: AXIS, fontSize: 12 }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Radar name={symbol} dataKey="This" stroke={ct.positive} fill={ct.positive} fillOpacity={0.3} />
          <Radar name="Sector median" dataKey="Peers" stroke={AXIS} fill={AXIS} fillOpacity={0.15} />
        </RadarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function ChartFrame({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mb-2 text-xs text-muted">{subtitle}</p>
      {children}
    </div>
  );
}
