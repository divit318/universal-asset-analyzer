import { NextResponse } from "next/server";
import { createManualAsset, listManualAssets, type CreateManualAssetInput } from "@/lib/db";
import type { ManualAssetCategory } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_CATEGORIES: ManualAssetCategory[] = ["real_estate", "private_market", "alternative", "structured_product"];

/**
 * GET /api/manual-assets?category=real_estate
 * Lists manual assets, optionally filtered by category. No computed metrics
 * here — that's per-asset (GET /api/manual-assets/[id]) since it needs a
 * live quote fetch for structured products.
 */
export async function GET(request: Request) {
  const categoryParam = new URL(request.url).searchParams.get("category");
  if (categoryParam && !VALID_CATEGORIES.includes(categoryParam as ManualAssetCategory)) {
    return NextResponse.json({ error: `Invalid category "${categoryParam}"` }, { status: 400 });
  }

  try {
    return NextResponse.json({ assets: listManualAssets(categoryParam as ManualAssetCategory | undefined) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list manual assets";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/manual-assets — create a new manual asset. Body shape mirrors
 * CreateManualAssetInput; the category/details pairing is trusted from the
 * form, same boundary as fundamentals_cache's opaque JSON.
 */
export async function POST(request: Request) {
  let body: CreateManualAssetInput;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.category || !VALID_CATEGORIES.includes(body.category)) {
    return NextResponse.json({ error: "A valid `category` is required" }, { status: 400 });
  }
  if (!body.name || !body.acquisitionDate || body.acquisitionCost == null || !body.details) {
    return NextResponse.json({ error: "name, acquisitionDate, acquisitionCost, and details are required" }, { status: 400 });
  }

  try {
    const asset = createManualAsset(body);
    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create manual asset";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
