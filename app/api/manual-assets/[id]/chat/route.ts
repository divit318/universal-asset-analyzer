import { NextResponse } from "next/server";
import { getManualAsset } from "@/lib/db";
import { computeManualAssetMetrics } from "@/lib/manual-asset-metrics";
import { manualAssetChatWithData } from "@/lib/ai-manual-asset-research";
import type { ChatMessage } from "@/lib/ai-research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ManualAssetChatRequest {
  question: string;
  history?: ChatMessage[];
}

/** POST /api/manual-assets/[id]/chat — free-text Q&A grounded in this asset's facts + computed metrics. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = getManualAsset(id);
  if (!asset) return NextResponse.json({ error: "Manual asset not found" }, { status: 404 });

  let body: ManualAssetChatRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.question) {
    return NextResponse.json({ error: "`question` is required" }, { status: 400 });
  }

  try {
    const metrics = await computeManualAssetMetrics(asset);
    const result = await manualAssetChatWithData({ asset, metrics, history: body.history ?? [], question: body.question });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI manual asset chat failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
