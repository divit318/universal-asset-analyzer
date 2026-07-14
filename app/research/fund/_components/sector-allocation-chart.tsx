"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundSectorWeight } from "@/lib/types";
import { useChartTheme } from "@/app/_components/chart-theme";

export function SectorAllocationChart({ sectorWeights }: { sectorWeights: FundSectorWeight[] }) {
  const ct = useChartTheme();

  if (sectorWeights.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
        <h3 className="text-sm font-medium">Sector Allocation</h3>
        <p className="text-xs text-muted">Sector allocation unavailable for this fund.</p>
      </div>
    );
  }

  const data = sectorWeights.map((s) => ({ sector: s.sector, Weight: +s.weightPercent.toFixed(1) }));

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-medium">Sector Allocation</h3>
      <p className="mb-2 text-xs text-muted">% of fund assets by sector</p>
      <ResponsiveContainer width="100%" height={Math.max(200, data.length * 32)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={ct.grid} horizontal={false} />
          <XAxis type="number" stroke={ct.axis} tick={{ fontSize: 12 }} unit="%" />
          <YAxis type="category" dataKey="sector" stroke={ct.axis} tick={{ fontSize: 12 }} width={140} />
          <Tooltip contentStyle={ct.tooltip} formatter={(v) => `${v}%`} cursor={{ fill: ct.cursorFill }} />
          <Bar dataKey="Weight" fill={ct.series[0]} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
