"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import type { ClassCompareEntry } from "@/lib/compare/types";
import { CHART_SERIES, useChartTheme } from "@/app/_components/chart-theme";
// formatMarketCap's default-USD "$" is EARNED here: ClassCompareEntry carries
// no currency because non-equity class universes are USD-denominated by
// construction ("-USD" crypto pairs — see lib/compare/types.ts). If a
// per-entry quote currency is ever added, thread it into both calls below.
import { formatMarketCap } from "@/lib/format";

const COLORS = CHART_SERIES;

interface Datum {
  symbol: string;
  circulating: number;
  locked: number;
  idx: number;
}

/**
 * Crypto's signature chart: market cap vs. fully-diluted valuation, stacked
 * per token. The solid segment is supply already circulating; the hatched
 * segment on top is what's still locked and will dilute holders as it
 * vests. Directly visualizes mcapToFdv — the honest substitute for a token-
 * unlock calendar the framework spec calls for — as a shape instead of a
 * ratio, which reads faster than the number alone.
 */
export function DilutionChart({ entries }: { entries: ClassCompareEntry[] }) {
  const ct = useChartTheme();
  const valid = entries.filter((e) => !e.error);

  const data: Datum[] = valid
    .map((e, idx) => {
      const mcap = e.metrics.marketCap;
      const fdv = e.metrics.fdv;
      if (mcap == null || fdv == null || fdv <= 0) return null;
      return { symbol: e.symbol, circulating: mcap, locked: Math.max(0, fdv - mcap), idx };
    })
    .filter((d): d is Datum => d != null);

  if (data.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-1 text-sm font-semibold text-muted uppercase tracking-wide">Dilution Overhang</h2>
      <p className="mb-3 text-xs text-muted">
        Solid = market cap (circulating supply). Hatched = still-locked supply that dilutes holders as it vests.
      </p>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 10, right: 16, left: 4, bottom: 10 }}>
          <defs>
            {data.map((d) => (
              <pattern key={`hatch-${d.symbol}`} id={`hatch-${d.symbol}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={COLORS[d.idx % COLORS.length]} fillOpacity={0.18} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={COLORS[d.idx % COLORS.length]} strokeWidth="2" strokeOpacity={0.55} />
              </pattern>
            ))}
          </defs>
          <CartesianGrid stroke={ct.grid} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="symbol" tick={{ fill: ct.axis, fontSize: 11, fontFamily: "monospace", fontWeight: 700 }} tickLine={false} axisLine={{ stroke: ct.grid }} />
          <YAxis tick={{ fill: ct.axis, fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatMarketCap(v)} width={64} />
          <Tooltip
            contentStyle={ct.tooltip}
            formatter={(value: unknown, name: unknown) => [
              formatMarketCap(Number(value)),
              name === "circulating" ? "Circulating (Mkt Cap)" : "Locked (FDV − Mkt Cap)",
            ]}
          />
          <Bar dataKey="circulating" stackId="a" radius={[0, 0, 0, 0]}>
            {data.map((d) => <Cell key={d.symbol} fill={COLORS[d.idx % COLORS.length]} />)}
          </Bar>
          <Bar dataKey="locked" stackId="a" radius={[4, 4, 0, 0]}>
            {data.map((d) => <Cell key={d.symbol} fill={`url(#hatch-${d.symbol})`} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
