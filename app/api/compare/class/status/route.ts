/**
 * GET /api/compare/class/status?assetClass=reit — non-blocking universe
 * build status, for the Compare page to poll while a cold universe warms up.
 *
 * Deliberately separate from GET /api/compare/class itself: that route's
 * `provider.load()` blocks on an in-flight build for most asset classes
 * (see universe-cache.ts), so a second request racing the same build would
 * just queue up behind it rather than returning a quick progress snapshot.
 * `peekStatus()` never awaits — it's always instant.
 */

import { NextResponse } from "next/server";
import { getUniverseProvider } from "@/lib/screener/universes";
import { isAssetClassId } from "@/lib/assets/registry";
import type { AssetClassId } from "@/lib/assets/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseAssetClass(assetClassParam: string | null): AssetClassId | null {
  if (!isAssetClassId(assetClassParam) || assetClassParam === "equity") return null;
  return assetClassParam;
}

export async function GET(request: Request) {
  const assetClass = parseAssetClass(new URL(request.url).searchParams.get("assetClass"));
  if (!assetClass) {
    return NextResponse.json({ error: "A non-equity assetClass is required" }, { status: 400 });
  }

  const status = getUniverseProvider(assetClass).peekStatus();
  return NextResponse.json({ assetClass, status });
}
