"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageShell, PageHeader, Button, Card, Badge, Skeleton } from "@/app/_components/ui";
import { ConfirmDialog } from "@/app/_components/dialog";
import { RealEstateMetricsCard } from "../_components/real-estate-metrics-card";
import { PrivateMarketMetricsCard } from "../_components/private-market-metrics-card";
import { AlternativeMetricsCard } from "../_components/alternative-metrics-card";
import { StructuredProductPayoffCard } from "../_components/structured-product-payoff-card";
import { AiManualAssetInsight } from "../_components/ai-manual-asset-insight";
import { ManualAssetChat } from "../_components/manual-asset-chat";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ManualAsset, ManualAssetCategory } from "@/lib/types";
import type { ManualAssetMetrics } from "@/lib/manual-asset-metrics";
import type { RealEstateMetrics, PrivateMarketMetrics, AlternativeMetrics, StructuredProductMetrics } from "@/lib/manual-asset-analysis";

const CATEGORY_LABEL: Record<ManualAssetCategory, string> = {
  real_estate: "Real Estate",
  private_market: "Private Markets",
  alternative: "Alternatives",
  structured_product: "Structured Product",
};

function ManualAssetDetail() {
  const params = useParams();
  const router = useRouter();
  const id = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

  const [asset, setAsset] = useState<ManualAsset | null>(null);
  const [metrics, setMetrics] = useState<ManualAssetMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/manual-assets/${id}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load asset");
        setAsset(json.asset);
        setMetrics(json.metrics);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load asset");
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function handleDelete() {
    await fetch(`/api/manual-assets/${id}`, { method: "DELETE" });
    router.push("/research/manual");
  }

  if (loading) {
    return (
      <PageShell gap="gap-6" py="py-10">
        <Skeleton height="h-16" radius="rounded-xl" />
        <Skeleton height="h-64" radius="rounded-xl" />
      </PageShell>
    );
  }

  if (error || !asset || !metrics) {
    return (
      <PageShell gap="gap-6" py="py-10">
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error ?? "Asset not found"}</div>
        <Button variant="secondary" onClick={() => router.push("/research/manual")}>Back to Manual Assets</Button>
      </PageShell>
    );
  }

  const totalReturnPercent =
    asset.currentValue != null && asset.acquisitionCost > 0
      ? ((asset.currentValue - asset.acquisitionCost) / asset.acquisitionCost) * 100
      : null;

  return (
    <PageShell gap="gap-6" py="py-10">
      <PageHeader
        title={asset.name}
        description={`${CATEGORY_LABEL[asset.category]} · Acquired ${formatDate(asset.acquisitionDate)}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => router.push("/research/manual")}>Back</Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>Delete</Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card padding="sm" className="flex flex-col gap-0.5">
          <span className="text-label uppercase tracking-widest text-muted/70">Acquisition Cost</span>
          <span className="font-mono text-lg font-bold">{formatCurrency(asset.acquisitionCost)}</span>
        </Card>
        <Card padding="sm" className="flex flex-col gap-0.5">
          <span className="text-label uppercase tracking-widest text-muted/70">Current Value</span>
          <span className="font-mono text-lg font-bold">{asset.currentValue != null ? formatCurrency(asset.currentValue) : "—"}</span>
          {asset.currentValueAsOf && <span className="text-xs text-muted">as of {formatDate(asset.currentValueAsOf)}</span>}
        </Card>
        <Card padding="sm" className="flex flex-col gap-0.5">
          <span className="text-label uppercase tracking-widest text-muted/70">Total Return</span>
          <span className={`font-mono text-lg font-bold ${totalReturnPercent == null ? "" : totalReturnPercent >= 0 ? "text-positive" : "text-negative"}`}>
            {totalReturnPercent != null ? `${totalReturnPercent >= 0 ? "+" : ""}${totalReturnPercent.toFixed(1)}%` : "—"}
          </span>
        </Card>
        <Card padding="sm" className="flex flex-col gap-0.5">
          <span className="text-label uppercase tracking-widest text-muted/70">Category</span>
          <Badge variant="brand" className="mt-1 w-fit">{CATEGORY_LABEL[asset.category]}</Badge>
        </Card>
      </div>

      {asset.category === "real_estate" && <RealEstateMetricsCard asset={asset} metrics={metrics as RealEstateMetrics} />}
      {asset.category === "private_market" && <PrivateMarketMetricsCard asset={asset} metrics={metrics as PrivateMarketMetrics} />}
      {asset.category === "alternative" && <AlternativeMetricsCard asset={asset} metrics={metrics as AlternativeMetrics} />}
      {asset.category === "structured_product" && <StructuredProductPayoffCard asset={asset} metrics={metrics as StructuredProductMetrics} />}

      {asset.notes && (
        <Card padding="md">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted/60">Notes</h3>
          <p className="text-sm text-muted">{asset.notes}</p>
        </Card>
      )}

      <AiManualAssetInsight assetId={asset.id} resetKey={asset.id} />
      <ManualAssetChat assetId={asset.id} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this asset?"
        message={`This will permanently remove "${asset.name}" and its history. This can't be undone.`}
        confirmLabel="Delete"
        danger
      />
    </PageShell>
  );
}

export default function ManualAssetDetailPage() {
  return (
    <Suspense>
      <ManualAssetDetail />
    </Suspense>
  );
}
