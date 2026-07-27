"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { useChartTheme } from "@/app/_components/chart-theme";
import type { MarginalBenefitPoint } from "@/lib/portfolio/engines/cash";

/** Compact axis label for a dollar amount — "$50k" rather than "$50,000.00". */
function compactCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Diminishing returns (Step 8), read directly off the same fine-grained tranche
 * run that built the plan — no separate re-optimization at each checkpoint
 * amount. Every point here is a cumulative health delta the optimizer actually
 * measured at that dollar amount, not an interpolation.
 */
export function MarginalBenefitChart({ points }: { points: MarginalBenefitPoint[] }) {
  const ct = useChartTheme();
  if (points.length < 2) return null;

  const data = points.map((p) => ({ amount: p.cumulativeAmount, health: p.healthDelta }));

  return (
    <Card className="flex flex-col gap-1 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Marginal benefit</h3>
      <p className="mb-2 text-[11px] text-muted/70">
        Cumulative measured health improvement as more of this cash is deployed — the curve flattens as
        the best opportunities are used up first.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          <XAxis dataKey="amount" stroke={ct.axis} tick={ct.axisTick} tickFormatter={compactCurrency} />
          <YAxis stroke={ct.axis} tick={ct.axisTick} tickFormatter={(v: number) => `+${v}`} />
          <Tooltip
            contentStyle={ct.tooltip}
            formatter={(value) => [`+${Number(value).toFixed(1)} pts`, "Health"]}
            labelFormatter={(label) => `Deployed: ${formatCurrency(Number(label))}`}
          />
          <Line type="monotone" dataKey="health" stroke={ct.brand} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
