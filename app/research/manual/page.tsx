"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell, PageHeader, Button, Card, Badge } from "@/app/_components/ui";
import { Dialog } from "@/app/_components/dialog";
import { AddManualAssetForm } from "./_components/add-manual-asset-form";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import type { ManualAsset, ManualAssetCategory } from "@/lib/types";

const CATEGORY_LABEL: Record<ManualAssetCategory, string> = {
  real_estate: "Real Estate",
  private_market: "Private Markets",
  alternative: "Alternatives",
  structured_product: "Structured Products",
};

function totalReturnPercent(asset: ManualAsset): number | null {
  if (asset.currentValue == null || asset.acquisitionCost <= 0) return null;
  return ((asset.currentValue - asset.acquisitionCost) / asset.acquisitionCost) * 100;
}

export default function ManualAssetsPage() {
  const router = useRouter();
  const [assets, setAssets] = useState<ManualAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [prefillCategory, setPrefillCategory] = useState<ManualAssetCategory | undefined>(undefined);
  const [prefillQuery, setPrefillQuery] = useState<string | undefined>(undefined);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/manual-assets");
      const json = await res.json();
      setAssets(res.ok ? json.assets : []);
    } finally {
      setLoading(false);
    }
  }

  function openBlankForm() {
    setPrefillCategory(undefined);
    setPrefillQuery(undefined);
    setAddOpen(true);
  }

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    void load();

    // Arriving from the Research Hub's Real Estate/Private Markets search
    // mode (?add=real_estate&q=... or ?add=private_market&q=...): open
    // straight into that category with the search already running.
    const params = new URLSearchParams(window.location.search);
    const add = params.get("add");
    const q = params.get("q");
    if (add === "real_estate" || add === "private_market") {
      setPrefillCategory(add);
      setPrefillQuery(q ?? undefined);
      setAddOpen(true);
    }
  }, []);

  const grouped = (Object.keys(CATEGORY_LABEL) as ManualAssetCategory[]).map((cat) => ({
    category: cat,
    items: assets.filter((a) => a.category === cat),
  }));

  return (
    <PageShell gap="gap-6" py="py-10">
      <PageHeader
        title="Manual Assets"
        description="Real estate, private markets, alternatives, and structured products — tracked manually since there's no live ticker feed for these."
        actions={<Button variant="primary" onClick={openBlankForm}>+ Add Manual Asset</Button>}
      />

      {loading ? (
        <div className="h-40 animate-pulse rounded-xl bg-surface" />
      ) : assets.length === 0 ? (
        <Card padding="lg" className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-sm font-medium">No manual assets yet</p>
          <p className="max-w-md text-xs text-muted">
            Track a property, a private-company stake, a collectible, or a structured note — anything without a live market feed.
          </p>
          <Button variant="primary" className="mt-2" onClick={() => setAddOpen(true)}>+ Add Manual Asset</Button>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.filter((g) => g.items.length > 0).map((g) => (
            <div key={g.category} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">
                {CATEGORY_LABEL[g.category]} <span className="text-muted/40">({g.items.length})</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((asset) => {
                  const ret = totalReturnPercent(asset);
                  return (
                    <Card
                      key={asset.id}
                      padding="md"
                      interactive
                      onClick={() => router.push(`/research/manual/${asset.id}`)}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{asset.name}</p>
                        <Badge variant="neutral">{CATEGORY_LABEL[asset.category]}</Badge>
                      </div>
                      <p className="text-xs text-muted">Acquired {formatDate(asset.acquisitionDate)} for {formatCurrency(asset.acquisitionCost)}</p>
                      <div className="mt-1 flex items-baseline justify-between">
                        <span className="font-mono text-sm">{asset.currentValue != null ? formatCurrency(asset.currentValue) : "No valuation entered"}</span>
                        {ret != null && (
                          <span className={`text-xs font-medium ${ret >= 0 ? "text-positive" : "text-negative"}`}>{formatPercent(ret)}</span>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Add Manual Asset" className="max-w-2xl">
        <AddManualAssetForm
          initialCategory={prefillCategory}
          initialQuery={prefillQuery}
          onCreated={(id) => { setAddOpen(false); router.push(`/research/manual/${id}`); }}
        />
      </Dialog>
    </PageShell>
  );
}
