"use client";

import { Card } from "@/app/_components/ui";
import { CollapsibleSection } from "@/app/_components/collapsible-section";
import { compareScenarioSets } from "@/lib/portfolio/engines/scenario";
import { StateRow } from "../impact-display";
import type { CashPlanResponse } from "./types";

/** Current vs. projected asset-class allocation — same visual language as the
 * Optimize tab's PortfolioDiffChart, built locally since the shapes differ
 * (a full before/after evaluation pair, not a trade-selection preview). */
function AllocationDiff({ plan }: { plan: CashPlanResponse }) {
  const beforeByClass = new Map(plan.before.allocation.byAssetClass.slices.map((s) => [s.key, s]));
  const afterByClass = new Map(plan.after.allocation.byAssetClass.slices.map((s) => [s.key, s]));
  const allKeys = new Set([...beforeByClass.keys(), ...afterByClass.keys()]);

  const rows = [...allKeys]
    .map((key) => {
      const before = beforeByClass.get(key);
      const after = afterByClass.get(key);
      return {
        key,
        label: before?.label ?? after?.label ?? key,
        beforeWeight: before?.weight ?? 0,
        afterWeight: after?.weight ?? 0,
      };
    })
    .filter((r) => Math.abs(r.afterWeight - r.beforeWeight) >= 0.1)
    .sort((a, b) => Math.abs(b.afterWeight - b.beforeWeight) - Math.abs(a.afterWeight - a.beforeWeight));

  if (rows.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        Current vs. projected allocation
      </span>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold text-foreground">{r.label}</span>
              <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
                <span className="text-muted/70">{r.beforeWeight.toFixed(1)}%</span>
                <span className="text-muted/40">→</span>
                <span className="font-semibold text-foreground">{r.afterWeight.toFixed(1)}%</span>
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="absolute inset-y-0 left-0 rounded-full bg-brand/25" style={{ width: `${Math.min(r.beforeWeight, 100)}%` }} />
              <div className="absolute inset-y-0 w-0.5 rounded-full bg-foreground" style={{ left: `${Math.min(r.afterWeight, 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

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
      {/* Asset-class HHI on both sides (see riskComparisonOf in the route), so
          this pair is self-consistent. Labelled by denominator for the same
          reason the Risk Lab labels its own "Position HHI". */}
      <StateRow label="Asset-class HHI" before={before.assetClassHhi} after={after.assetClassHhi} decimals={0} higherIsBetter={false} />
      <StateRow label="Top holding weight" before={before.topHoldingWeight} after={after.topHoldingWeight} suffix="%" higherIsBetter={false} />
      <StateRow label="Top sector weight" before={before.topSectorWeight} after={after.topSectorWeight} suffix="%" higherIsBetter={false} />
      <StateRow label="Illiquid share" before={before.illiquidPct} after={after.illiquidPct} suffix="%" higherIsBetter={false} />
      {before.avgCorrelation != null && after.avgCorrelation != null && (
        <StateRow label="Avg. pairwise correlation" before={before.avgCorrelation} after={after.avgCorrelation} decimals={2} higherIsBetter={false} />
      )}
    </Card>
  );
}

/**
 * Before / after / change, with all three columns produced by one function
 * (compareScenarioSets) at one precision — so Change is always exactly the
 * subtraction of the two numbers printed beside it. This table used to round the
 * columns and the delta independently off values the engine had already quantized
 * to 0.1pp, which is how a row could read "−8.6% → −6.6%" with a Change of 0.0pp.
 */
function ScenarioTable({ plan }: { plan: CashPlanResponse }) {
  const { rows, decimals } = compareScenarioSets(plan.scenarios.before, plan.scenarios.after);
  const sorted = [...rows].sort((a, b) => (a.afterPct ?? 0) - (b.afterPct ?? 0));
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(decimals)}`;
  const tolerance = 10 ** -decimals / 2;

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
          {sorted.map((s) => {
            const improved = s.deltaPp != null && s.deltaPp >= tolerance;
            const worsened = s.deltaPp != null && s.deltaPp <= -tolerance;
            return (
              <tr key={s.id} className="border-b border-border/50">
                <td className="py-1.5 text-xs text-foreground" title={s.description}>{s.name}</td>
                <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-muted">
                  {s.beforePct != null ? `${signed(s.beforePct)}%` : "—"}
                </td>
                <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums text-foreground">
                  {s.afterPct != null ? `${signed(s.afterPct)}%` : "—"}
                </td>
                <td className={`py-1.5 pl-2 text-right font-mono text-xs tabular-nums ${
                  improved ? "text-positive" : worsened ? "text-negative" : "text-muted"
                }`}>
                  {s.deltaPp != null ? `${signed(s.deltaPp)}pp` : "—"}
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
      <AllocationDiff plan={plan} />
      <RiskComparisonCard plan={plan} />
      {/* Counted, not asserted — the hardcoded "19" here disagreed with the 18
          scenarios the engine actually runs. */}
      <CollapsibleSection
        title="Scenario analysis"
        subtitle={`Portfolio impact under ${plan.scenarios.after.length} stress scenarios, before vs. after`}
      >
        <ScenarioTable plan={plan} />
      </CollapsibleSection>
    </div>
  );
}
