"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { useChartTheme } from "@/app/_components/chart-theme";
import type { MarginalBenefitPoint } from "@/lib/portfolio/engines/cash";

/**
 * Compact axis label for a dollar amount, at a precision that can still tell
 * adjacent ticks apart.
 *
 * `Math.round(v / 1000)` alone cannot: an 18-tranche $3,000 plan ticks at $167
 * intervals, so 1,000 / 1,167 / 1,333 all render "$1k" and the axis reads
 * "$1k $1k $1k $2k $2k $2k $2k" — labels that are not merely ugly but actively
 * wrong, since they assert three different amounts are the same one. The decimal
 * count therefore comes from the axis SPAN, not from the individual value.
 */
function compactCurrency(v: number, span: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(span < 10_000_000 ? 2 : 1)}M`;
  if (abs >= 1000) return `$${(v / 1000).toFixed(span < 10_000 ? 1 : 0)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Diminishing returns (Step 8), read directly off the same fine-grained tranche
 * run that built the plan — no separate re-optimization at each checkpoint
 * amount. Every point here is a cumulative alignment delta the optimizer actually
 * measured at that dollar amount, not an interpolation.
 */
export function MarginalBenefitChart({ points }: { points: MarginalBenefitPoint[] }) {
  const ct = useChartTheme();
  if (points.length < 2) return null;

  const data = points.map((p) => ({ amount: p.cumulativeAmount, alignment: p.alignmentDelta }));
  const span = data[data.length - 1].amount - data[0].amount;

  return (
    <Card className="flex flex-col gap-1 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Marginal benefit</h3>
      <p className="mb-2 text-[11px] text-muted/70">
        Cumulative measured alignment improvement as more of this cash is deployed — the curve flattens
        as the best opportunities are used up first.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid stroke={ct.grid} vertical={false} />
          {/* A real numeric axis, not one category per tranche. As a category axis
              it printed a label for every one of the 18 tranche boundaries — which
              is what put three "$1k"s in a row — and it also spaced irregular
              dollar amounts evenly, so the curve's x-position was not proportional
              to the money deployed. Recharts now picks a handful of round ticks and
              drops any that would overlap. */}
          <XAxis
            dataKey="amount"
            type="number"
            domain={[data[0].amount, data[data.length - 1].amount]}
            stroke={ct.axis}
            tick={ct.axisTick}
            tickFormatter={(v: number) => compactCurrency(v, span)}
            minTickGap={24}
          />
          <YAxis stroke={ct.axis} tick={ct.axisTick} tickFormatter={(v: number) => `+${v}`} />
          <Tooltip
            contentStyle={ct.tooltip}
            formatter={(value) => [`+${Number(value).toFixed(1)} pts`, "Alignment"]}
            labelFormatter={(label) => `Deployed: ${formatCurrency(Number(label))}`}
          />
          <Line type="monotone" dataKey="alignment" stroke={ct.brand} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
