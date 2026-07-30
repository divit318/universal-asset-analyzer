"use client";

import { Card } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { StateRow } from "../impact-display";
import { AllocationDiffChart } from "../allocation-diff-chart";
import type { CashPlanResponse } from "./types";

function RiskComparisonCard({ plan }: { plan: CashPlanResponse }) {
  const { before, after } = plan.riskComparison;
  return (
    <Card className="flex flex-col divide-y divide-border/40 p-4">
      <span className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Risk analysis</span>
      <StateRow label="Annualized volatility" before={before.annualizedVolatility} after={after.annualizedVolatility} suffix="%" higherIsBetter={false} />
      <StateRow label="Sharpe ratio" before={before.sharpeRatio} after={after.sharpeRatio} decimals={2} />
      <StateRow label="Max drawdown" before={before.maxDrawdown} after={after.maxDrawdown} suffix="%" higherIsBetter={false} />
      <StateRow label="95% VaR (1-day)" before={before.var95Pct} after={after.var95Pct} suffix="%" higherIsBetter={false} />
      <StateRow label="95% CVaR (tail loss)" before={before.cvar95Pct} after={after.cvar95Pct} suffix="%" higherIsBetter={false} />
      <StateRow label="Concentration (HHI)" before={before.hhi} after={after.hhi} decimals={0} higherIsBetter={false} />
      <StateRow label="Top holding weight" before={before.topHoldingWeight} after={after.topHoldingWeight} suffix="%" higherIsBetter={false} />
      <StateRow label="Top sector weight" before={before.topSectorWeight} after={after.topSectorWeight} suffix="%" higherIsBetter={false} />
      <StateRow label="Illiquid share" before={before.illiquidPct} after={after.illiquidPct} suffix="%" higherIsBetter={false} />
      {before.avgCorrelation != null && after.avgCorrelation != null && (
        <StateRow label="Avg. pairwise correlation" before={before.avgCorrelation} after={after.avgCorrelation} decimals={2} higherIsBetter={false} />
      )}
    </Card>
  );
}

function ScenarioTable({ plan }: { plan: CashPlanResponse }) {
  const beforeById = new Map(plan.scenarios.before.map((s) => [s.id, s]));
  const rows = plan.scenarios.after
    .map((s) => ({ ...s, beforeImpactPct: beforeById.get(s.id)?.portfolioImpactPct ?? null }))
    .sort((a, b) => a.portfolioImpactPct - b.portfolioImpactPct);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px]">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted/70">
            <th className="py-2 text-left font-semibold">Scenario</th>
            <th className="px-2 py-2 text-right font-semibold">Before</th>
            <th className="px-2 py-2 text-right font-semibold">After</th>
            <th className="py-2 pl-2 text-right font-semibold">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const delta = s.beforeImpactPct != null ? s.portfolioImpactPct - s.beforeImpactPct : null;
            const improved = delta != null && delta > 0.05;
            const worsened = delta != null && delta < -0.05;
            return (
              <tr key={s.id} className="border-b border-border/50">
                <td className="py-1.5 text-xs text-foreground" title={s.description}>{s.name}</td>
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-muted">
                  {s.beforeImpactPct != null ? `${s.beforeImpactPct >= 0 ? "+" : ""}${s.beforeImpactPct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                  {s.portfolioImpactPct >= 0 ? "+" : ""}{s.portfolioImpactPct.toFixed(1)}%
                </td>
                <td className={`py-1.5 pl-2 text-right font-mono text-xs tabular-nums ${
                  improved ? "text-positive" : worsened ? "text-negative" : "text-muted"
                }`}>
                  {delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}pp` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Steps 11-13: before/after allocation, scenario stress-testing, and risk
 * analysis — every number reused from the plan the optimizer already computed. */
export function AnalysisPanel({ plan }: { plan: CashPlanResponse }) {
  return (
    <div className="flex flex-col gap-3">
      <AllocationDiffChart before={plan.before.allocation} after={plan.after.allocation} />
      <RiskComparisonCard plan={plan} />
      <CollapsibleSection title="Scenario analysis" subtitle="Portfolio impact under 19 stress scenarios, before vs. after">
        <ScenarioTable plan={plan} />
      </CollapsibleSection>
    </div>
  );
}
