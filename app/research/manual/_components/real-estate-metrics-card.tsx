import { StatTile } from "@/app/_components/ui";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { ManualAsset } from "@/lib/types";
import type { RealEstateMetrics } from "@/lib/manual-asset-analysis";

export function RealEstateMetricsCard({
  asset,
  metrics,
}: {
  asset: ManualAsset & { category: "real_estate" };
  metrics: RealEstateMetrics;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Net Operating Income" value={formatCurrency(metrics.noi)} />
        <StatTile
          label="Cap Rate"
          value={formatPercent(metrics.capRatePercent)}
          tone={metrics.capRatePercent != null ? (metrics.capRatePercent >= 5 ? "positive" : "warning") : "default"}
        />
        <StatTile label="Gross Rental Yield" value={formatPercent(metrics.rentalYieldPercent)} />
        <StatTile label="Approx. Annual Debt Service" value={formatCurrency(metrics.approxAnnualDebtService)} />
        <StatTile
          label="Cash-on-Cash Return"
          value={formatPercent(metrics.cashOnCashReturnPercent)}
          tone={metrics.cashOnCashReturnPercent != null ? (metrics.cashOnCashReturnPercent >= 0 ? "positive" : "negative") : "default"}
        />
        <StatTile
          label="Total Appreciation"
          value={formatPercent(metrics.totalAppreciationPercent)}
          tone={metrics.totalAppreciationPercent != null ? (metrics.totalAppreciationPercent >= 0 ? "positive" : "negative") : "default"}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Property Type</dt>
          <dd className="mt-0.5 font-medium">{asset.details.propertyType}</dd>
        </div>
        {asset.details.address && (
          <div>
            <dt className="text-muted">Address</dt>
            <dd className="mt-0.5 font-medium">{asset.details.address}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted">Annual Rental Income</dt>
          <dd className="mt-0.5 font-medium">{formatCurrency(asset.details.annualRentalIncome)}</dd>
        </div>
        <div>
          <dt className="text-muted">Annual Expenses</dt>
          <dd className="mt-0.5 font-medium">{formatCurrency(asset.details.annualExpenses)}</dd>
        </div>
        <div>
          <dt className="text-muted">Outstanding Mortgage</dt>
          <dd className="mt-0.5 font-medium">
            {formatCurrency(asset.details.outstandingMortgage)}
            {asset.details.mortgageRatePercent != null ? ` @ ${asset.details.mortgageRatePercent.toFixed(2)}%` : ""}
          </dd>
        </div>
      </dl>

      <p className="text-[11px] text-muted/70">
        Cash-on-cash return uses an approximate debt service (rate × outstanding balance, no amortization schedule) — treat as directional, not exact.
      </p>
    </div>
  );
}
