import { StatTile } from "@/app/_components/ui";
import { formatPercent } from "@/lib/format";
import type { ManualAsset } from "@/lib/types";
import type { AlternativeMetrics } from "@/lib/manual-asset-analysis";

export function AlternativeMetricsCard({
  asset,
  metrics,
}: {
  asset: ManualAsset & { category: "alternative" };
  metrics: AlternativeMetrics;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          label="Appreciation"
          value={formatPercent(metrics.appreciationPercent)}
          tone={metrics.appreciationPercent != null ? (metrics.appreciationPercent >= 0 ? "positive" : "negative") : "default"}
        />
        <StatTile
          label="CAGR"
          value={formatPercent(metrics.cagrPercent)}
          tone={metrics.cagrPercent != null ? (metrics.cagrPercent >= 0 ? "positive" : "negative") : "default"}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-2 p-4 text-xs sm:grid-cols-3">
        <div>
          <dt className="text-muted">Subcategory</dt>
          <dd className="mt-0.5 font-medium">{asset.details.subcategory}</dd>
        </div>
        {asset.details.condition && (
          <div>
            <dt className="text-muted">Condition</dt>
            <dd className="mt-0.5 font-medium">{asset.details.condition}</dd>
          </div>
        )}
        {asset.details.provenance && (
          <div>
            <dt className="text-muted">Provenance</dt>
            <dd className="mt-0.5 font-medium">{asset.details.provenance}</dd>
          </div>
        )}
      </dl>

      <p className="text-[11px] text-muted/70">
        There is no public market price for this asset — the current value is a self-reported estimate (appraisal, comparable sale, insurance valuation), not a verified market quote.
      </p>
    </div>
  );
}
