/**
 * GET /api/exposure/drivers — the shared-exposure layer.
 *
 * Separate from /api/exposure because it is the only expensive part of the
 * feature: an industry profile per issuer plus the reference-fund probes. Both
 * are platform-cached with long TTLs (an industry classification does not move
 * intraday), so this is slow exactly once and instant afterwards.
 *
 * The page renders and is fully interactive before this resolves; drivers light
 * up when it lands. Nothing here blocks anything.
 */

import { NextResponse } from "next/server";
import { getExposureDrivers } from "@/lib/exposure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const drivers = await getExposureDrivers({
      baseCurrency: url.searchParams.get("currency") ?? "USD",
    });
    return NextResponse.json(drivers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build exposure drivers";
    console.error("[exposure/drivers]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
