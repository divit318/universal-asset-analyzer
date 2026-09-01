import { NextResponse } from "next/server";
import { deleteManualAsset, getManualAsset, updateManualAsset, type UpdateManualAssetInput } from "@/lib/db";
import { invalidateDataset } from "@/lib/platform";
import { computeManualAssetMetrics } from "@/lib/manual-asset-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/manual-assets/[id] — the asset plus its category-specific computed metrics. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = getManualAsset(id);
  if (!asset) return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });

  try {
    const metrics = await computeManualAssetMetrics(asset);
    return NextResponse.json({ asset, metrics });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/manual-assets/[id] — update value/notes/details (category is immutable). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: UpdateManualAssetInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updated = updateManualAsset(id, body);
  if (!updated) return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });
  // A manual asset's value flows into total value, every weight and every
  // score — the cached report describes a book that no longer exists.
  invalidateDataset("portfolioReport");
  return NextResponse.json({ asset: updated });
}

/** DELETE /api/manual-assets/[id] */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getManualAsset(id)) return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });
  deleteManualAsset(id);
  invalidateDataset("portfolioReport");
  return NextResponse.json({ ok: true });
}
