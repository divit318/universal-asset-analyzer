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

const AXIS = "#9aa3af";
const GRID = "#272b33";
const POSITIVE = "#4ade80";
const BLUE = "#60a5fa";
const AMBER = "#fbbf24";

const tooltipStyle = {
  background: "#14161a",
  border: "1px solid #272b33",
  borderRadius: 8,
  fontSize: 12,
};

function map(points: { fy: number; value: number }[]): Map<number, number> {
  return new Map(points.map((p) => [p.fy, p.value]));
}

/* -------------------------------------------------------------------------- */
/* Margin trend (gross / operating / net)                                     */
/* -------------------------------------------------------------------------- */

export function MarginTrendChart({ statements }: { statements: FinancialStatements }) {
  const gm = map(statements.grossMargin);
  const om = map(statements.operatingMargin);
  const nm = map(statements.netMargin);
  const pct = (m: Map<number, number>, fy: number) =>
    m.has(fy) ? +(m.get(fy)! * 100).toFixed(1) : null;

  const data = statements.fiscalYears.map((fy) => ({
    year: `FY${String(fy).slice(-2)}`,
    Gross: pct(gm, fy),
    Operating: pct(om, fy),
    Net: pct(nm, fy),
  }));

  return (
    <ChartFrame title="Margin trend" subtitle="Gross / operating / net, % of revenue">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" stroke={AXIS} tick={{ fontSize: 12 }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12 }} unit="%" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="Gross" stroke={POSITIVE} fill={POSITIVE} fillOpacity={0.12} strokeWidth={2} connectNulls />
          <Area type="monotone" dataKey="Operating" stroke={BLUE} fill={BLUE} fillOpacity={0.12} strokeWidth={2} connectNulls />
          <Area type="monotone" dataKey="Net" stroke={AMBER} fill={AMBER} fillOpacity={0.12} strokeWidth={2} connectNulls />
        </AreaChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Revenue + free cash flow                                                   */
/* -------------------------------------------------------------------------- */

export function RevenueFcfChart({ statements }: { statements: FinancialStatements }) {
  const rev = map(statements.revenue);
  const fcf = map(statements.freeCashFlow);
  const bn = (m: Map<number, number>, fy: number) =>
    m.has(fy) ? +(m.get(fy)! / 1e9).toFixed(1) : null;

  const data = statements.fiscalYears.map((fy) => ({
    year: `FY${String(fy).slice(-2)}`,
    Revenue: bn(rev, fy),
    "Free cash flow": bn(fcf, fy),
  }));

  return (
    <ChartFrame title="Revenue & free cash flow" subtitle="$ billions, by fiscal year">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="year" stroke={AXIS} tick={{ fontSize: 12 }} />
          <YAxis stroke={AXIS} tick={{ fontSize: 12 }} unit="B" />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => `$${v}B`} cursor={{ fill: "#ffffff08" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Revenue" fill={BLUE} radius={[3, 3, 0, 0]} />
          <Bar dataKey="Free cash flow" fill={POSITIVE} radius={[3, 3, 0, 0]} />
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
          <Radar name={symbol} dataKey="This" stroke={POSITIVE} fill={POSITIVE} fillOpacity={0.3} />
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
