import { StatTile } from "@/app/_components/ui";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { ManualAsset } from "@/lib/types";
import type { PrivateMarketMetrics } from "@/lib/manual-asset-analysis";

export function PrivateMarketMetricsCard({
  asset,
  metrics,
}: {
  asset: ManualAsset & { category: "private_market" };
  metrics: PrivateMarketMetrics;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="MOIC"
          value={metrics.moic != null ? `${metrics.moic.toFixed(2)}x` : "—"}
          tone={metrics.moic != null ? (metrics.moic >= 1 ? "positive" : "negative") : "default"}
        />
        <StatTile
          label="Annualized Return"
          value={formatPercent(metrics.annualizedReturnPercent)}
          tone={metrics.annualizedReturnPercent != null ? (metrics.annualizedReturnPercent >= 0 ? "positive" : "negative") : "default"}
        />
        <StatTile label="Implied Ownership Value" value={formatCurrency(metrics.impliedOwnershipValue)} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Company</dt>
          <dd className="mt-0.5 font-medium">{asset.details.companyName}</dd>
        </div>
        {asset.details.round && (
          <div>
            <dt className="text-muted">Round</dt>
            <dd className="mt-0.5 font-medium">{asset.details.round}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted">Ownership</dt>
          <dd className="mt-0.5 font-medium">{asset.details.ownershipPercent != null ? `${asset.details.ownershipPercent}%` : "—"}</dd>
        </div>
        <div>
          <dt className="text-muted">Last Round Valuation</dt>
          <dd className="mt-0.5 font-medium">{formatCurrency(asset.details.lastRoundValuation)}</dd>
        </div>
      </dl>

      {metrics.impliedOwnershipValue != null && asset.currentValue != null && Math.abs(metrics.impliedOwnershipValue - asset.currentValue) / Math.max(asset.currentValue, 1) > 0.15 && (
        <p className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">
          The implied ownership value ({formatCurrency(metrics.impliedOwnershipValue)}) diverges more than 15% from the entered current value ({formatCurrency(asset.currentValue)}) — this position may be marked stale relative to the last priced round.
        </p>
      )}
    </div>
  );
}
