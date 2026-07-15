import { NextResponse } from "next/server";
import { getManualAsset } from "@/lib/db";
import { computeManualAssetMetrics } from "@/lib/manual-asset-metrics";
import { manualAssetSectionInsight } from "@/lib/ai-manual-asset-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/manual-assets/[id]/insight — generates the single AI insight
 * section for a manual asset. Recomputes metrics server-side (rather than
 * trusting a client-supplied body) since structured-product metrics need a
 * live quote fetch, same as GET /api/manual-assets/[id].
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = getManualAsset(id);
  if (!asset) return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });

  try {
    const metrics = await computeManualAssetMetrics(asset);
    const result = await manualAssetSectionInsight({ asset, metrics });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI manual asset insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
