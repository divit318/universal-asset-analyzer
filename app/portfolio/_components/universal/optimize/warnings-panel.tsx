import { Card, Badge } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { TradeSelectionSummary } from "./use-trade-selection";
import type { ImpactEstimate } from "@/lib/portfolio/engines/simulate";

interface Warning {
  label: string;
  message: string;
}

/**
 * Pre-implementation warnings (Feature 14). Every warning here is derived
 * from numbers the engines already measured for the current selection —
 * turnover from the selection summary, everything else from the live
 * preview's impact and realized-gain data. No new heuristics.
 */
export function WarningsPanel({
  summary,
  impact,
  estimatedRealizedGainLoss,
}: {
  summary: TradeSelectionSummary;
  impact: ImpactEstimate;
  estimatedRealizedGainLoss: number;
}) {
  const warnings: Warning[] = [];

  if (Math.abs(estimatedRealizedGainLoss) >= 1) {
    const verb = estimatedRealizedGainLoss >= 0 ? "gain" : "loss";
    warnings.push({
      label: "Tax realization",
      message: `Realizes roughly ${formatCurrency(Math.abs(estimatedRealizedGainLoss))} of unrealized ${verb}. No tax rate is modeled — this is the taxable amount, not the tax owed.`,
    });
  }

  if (summary.turnoverPct >= 15) {
    warnings.push({
      label: "Large turnover",
      message: `${summary.turnoverPct.toFixed(0)}% of the portfolio's value is turning over in this batch.`,
    });
  }

  if (impact.liquidityDelta > 1) {
    warnings.push({
      label: "Liquidity",
      message: `Increases the illiquid share of the portfolio by ${impact.liquidityDelta.toFixed(1)}pp.`,
    });
  }

  if (impact.riskDelta != null && impact.riskDelta > 0.5) {
    warnings.push({
      label: "Risk increase",
      message: `Increases annualized volatility by ${impact.riskDelta.toFixed(1)}pp.`,
    });
  }

  if (impact.diversificationDelta > 50) {
    warnings.push({
      label: "Concentration",
      message: "Increases portfolio concentration (higher HHI) rather than reducing it.",
    });
  }

  if (summary.netCash > 0) {
    warnings.push({
      label: "Cash required",
      message: `Requires ${formatCurrency(summary.netCash)} of net new cash — the sells in this selection don't fully fund the buys.`,
    });
  }

  if (warnings.length === 0) return null;

  return (
    <Card className="flex flex-col gap-1.5 border-warning/25 bg-warning/[0.04] p-4">
      {warnings.map((w, i) => (
        <p key={i} className="text-[11px] leading-relaxed text-muted">
          <Badge variant="warning">{w.label}</Badge> <span className="ml-1">{w.message}</span>
        </p>
      ))}
    </Card>
  );
}
