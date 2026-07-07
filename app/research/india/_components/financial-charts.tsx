"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScreenerInAnnualPL, ScreenerInQuarterlyPL } from "@/lib/screener-in";
import { useChartTheme } from "@/app/_components/chart-theme";

/* Series colors — legible on both themes. Structural axis/grid/tooltip come from
   useChartTheme() inside each component so they adapt to light mode. */
const POSITIVE = "#4ade80";
const AMBER = "#fbbf24";
const BLUE = "#60a5fa";
const NEGATIVE = "#f87171";

/* -------------------------------------------------------------------------- */
/* Compact "cr" formatter                                                      */
/* -------------------------------------------------------------------------- */

function fmtCr(v: number): string {
  if (v >= 1_00_000) return `₹${(v / 1_00_000).toFixed(0)}L Cr`;
  if (v >= 1_000) return `₹${(v / 1_000).toFixed(0)}K Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

function fmtCrFull(v: number): string {
  return `₹${v.toLocaleString("en-IN")} Cr`;
}

/* -------------------------------------------------------------------------- */
/* Tooltip components                                                          */
/* -------------------------------------------------------------------------- */

interface TooltipProps {
  active?: boolean;
  payload?: { value: number | null; name: string; color: string }[];
  label?: string;
}

function PLTooltip({ active, payload, label, style }: TooltipProps & { style?: React.CSSProperties }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={style}>
      <p className="mb-1.5 text-xs font-medium text-muted">{label}</p>
      {payload.map((p) => p.value != null && (
        <p key={p.name} style={{ color: p.color }} className="text-xs">
          {p.name}: {fmtCrFull(p.value)}
        </p>
      ))}
    </div>
  );
}

function MarginTooltip({ active, payload, label, style }: TooltipProps & { payload?: { value: number | null; name: string; color: string }[]; style?: React.CSSProperties }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={style}>
      <p className="mb-1 text-xs text-muted">{label}</p>
      {payload.map((p) => p.value != null && (
        <p key={p.name} style={{ color: p.color }} className="text-xs">
          {p.name}: {p.value.toFixed(1)}%
        </p>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chart wrapper                                                               */
/* -------------------------------------------------------------------------- */

function ChartFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Annual Revenue & Profit                                                     */
/* -------------------------------------------------------------------------- */

export function AnnualRevenueChart({ data }: { data: ScreenerInAnnualPL[] }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid;
  if (!data.length) return null;

  const chartData = data.map((d) => ({
    period: d.period,
    Revenue: d.sales,
    "Net Profit": d.netProfit,
  }));

  return (
    <ChartFrame title="Annual Revenue & Profit" subtitle="₹ Crores — last 10 years">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCr(v as number)} />
          <Tooltip content={<PLTooltip style={ct.tooltip} />} />
          <Bar dataKey="Revenue" fill={BLUE} radius={[2, 2, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Net Profit" radius={[2, 2, 0, 0]} maxBarSize={28}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={(d["Net Profit"] ?? 0) >= 0 ? POSITIVE : NEGATIVE} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: BLUE }} />
          Revenue
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm" style={{ background: POSITIVE }} />
          Net Profit
        </span>
      </div>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Annual OPM trend                                                            */
/* -------------------------------------------------------------------------- */

export function AnnualMarginChart({ data }: { data: ScreenerInAnnualPL[] }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid;
  const withMargin = data.filter((d) => d.opmPercent != null);
  if (withMargin.length < 2) return null;

  const chartData = withMargin.map((d) => ({
    period: d.period,
    "OPM %": d.opmPercent,
  }));

  const avg = withMargin.reduce((s, d) => s + (d.opmPercent ?? 0), 0) / withMargin.length;

  return (
    <ChartFrame title="Operating Margin Trend" subtitle={`Historical OPM% — avg ${avg.toFixed(1)}%`}>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<MarginTooltip style={ct.tooltip} />} />
          <Line dataKey="OPM %" stroke={AMBER} strokeWidth={2} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Quarterly Revenue & Profit                                                  */
/* -------------------------------------------------------------------------- */

function getGrowthColor(curr: number | null, prev: number | null): string {
  if (curr == null || prev == null || prev <= 0) return BLUE;
  const g = (curr - prev) / prev;
  if (g > 0.15) return POSITIVE;
  if (g < -0.1) return NEGATIVE;
  return AMBER;
}

export function QuarterlyRevenueChart({ data }: { data: ScreenerInQuarterlyPL[] }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid;
  // Show last 8 quarters
  const recent = data.slice(-8);
  if (recent.length < 2) return null;

  const chartData = recent.map((d, i) => {
    const prev = recent[i - 4]; // YoY comparison
    return {
      period: d.period,
      Sales: d.sales,
      yoyColor: getGrowthColor(d.sales, prev?.sales ?? null),
    };
  });

  return (
    <ChartFrame title="Quarterly Revenue" subtitle="₹ Crores — last 8 quarters">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCr(v as number)} />
          <Tooltip content={<PLTooltip style={ct.tooltip} />} />
          <Bar dataKey="Sales" radius={[2, 2, 0, 0]} maxBarSize={32}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={d.yoyColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-positive" />YoY &gt;15%</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-warning" />Moderate</span>
        <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-negative" />Declining</span>
      </div>
    </ChartFrame>
  );
}

export function QuarterlyProfitChart({ data }: { data: ScreenerInQuarterlyPL[] }) {
  const ct = useChartTheme();
  const AXIS = ct.axis, GRID = ct.grid;
  const recent = data.slice(-8);
  if (recent.length < 2) return null;

  const chartData = recent.map((d) => ({
    period: d.period,
    "Net Profit": d.netProfit,
    "OPM %": d.opmPercent,
  }));

  return (
    <ChartFrame title="Quarterly Net Profit & Margin" subtitle="₹ Crores + OPM%">
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 3" />
          <XAxis dataKey="period" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => fmtCr(v as number)} />
          <YAxis yAxisId="right" orientation="right" tick={{ fill: AXIS, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<PLTooltip style={ct.tooltip} />} />
          <Bar yAxisId="left" dataKey="Net Profit" radius={[2, 2, 0, 0]} maxBarSize={32}>
            {chartData.map((d, i) => (
              <Cell key={i} fill={(d["Net Profit"] ?? 0) >= 0 ? POSITIVE : NEGATIVE} />
            ))}
          </Bar>
          <Line yAxisId="right" dataKey="OPM %" stroke={AMBER} strokeWidth={1.5} dot={false} type="monotone" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-positive" />Net Profit</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-warning" />OPM %</span>
      </div>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Quarterly summary stats                                                     */
/* -------------------------------------------------------------------------- */

export function QuarterlySummaryStats({ data }: { data: ScreenerInQuarterlyPL[] }) {
  if (data.length < 2) return null;

  const recent4 = data.slice(-4);
  const prev4 = data.slice(-8, -4);

  function avg(arr: ScreenerInQuarterlyPL[], key: keyof ScreenerInQuarterlyPL): number | null {
    const vals = arr.map((d) => d[key] as number | null).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }

  const recentSales = avg(recent4, "sales");
  const prevSales = avg(prev4, "sales");
  const recentProfit = avg(recent4, "netProfit");
  const prevProfit = avg(prev4, "netProfit");
  const recentOPM = avg(recent4, "opmPercent");

  const yoySales = recentSales != null && prevSales != null && prevSales > 0
    ? ((recentSales - prevSales) / prevSales) * 100 : null;
  const yoyProfit = recentProfit != null && prevProfit != null && prevProfit > 0
    ? ((recentProfit - prevProfit) / prevProfit) * 100 : null;

  // Latest quarter trend
  const last = data.at(-1)!;
  const qoq = data.at(-2);
  const qoqSales = last.sales != null && qoq?.sales != null && qoq.sales > 0
    ? ((last.sales - qoq.sales) / qoq.sales) * 100 : null;

  const stats: { label: string; value: string; sub?: string; color?: string }[] = [
    {
      label: "Latest Quarter",
      value: last.period,
      sub: last.sales != null ? `₹${last.sales.toLocaleString("en-IN")} Cr revenue` : "—",
    },
    {
      label: "QoQ Revenue",
      value: qoqSales != null ? `${qoqSales >= 0 ? "+" : ""}${qoqSales.toFixed(1)}%` : "—",
      color: qoqSales != null ? (qoqSales >= 0 ? "text-positive" : "text-negative") : undefined,
    },
    {
      label: "YoY Revenue Growth",
      value: yoySales != null ? `${yoySales >= 0 ? "+" : ""}${yoySales.toFixed(1)}%` : "—",
      sub: "Avg trailing 4Q vs prior 4Q",
      color: yoySales != null ? (yoySales >= 10 ? "text-positive" : yoySales >= 0 ? "text-warning" : "text-negative") : undefined,
    },
    {
      label: "YoY Profit Growth",
      value: yoyProfit != null ? `${yoyProfit >= 0 ? "+" : ""}${yoyProfit.toFixed(1)}%` : "—",
      color: yoyProfit != null ? (yoyProfit >= 10 ? "text-positive" : yoyProfit >= 0 ? "text-warning" : "text-negative") : undefined,
    },
    {
      label: "Avg OPM %",
      value: recentOPM != null ? `${recentOPM.toFixed(1)}%` : "—",
      sub: "Trailing 4 quarters",
      color: recentOPM != null ? (recentOPM >= 20 ? "text-positive" : recentOPM >= 12 ? "text-warning" : "text-negative") : undefined,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-3">
          <span className="text-[10px] uppercase tracking-wide text-muted">{s.label}</span>
          <span className={`font-mono text-base font-semibold tabular-nums ${s.color ?? "text-foreground"}`}>{s.value}</span>
          {s.sub && <span className="text-[10px] text-muted/70">{s.sub}</span>}
        </div>
      ))}
    </div>
  );
}
