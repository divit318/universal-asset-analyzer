/**
 * GET /api/exposure — the exposure routes.
 *
 * One payload, everything the page needs to be useful: positions, issuers, the
 * quantified paths between them, coverage, co-movement and the Intelligence
 * findings. Every interaction the user then makes resolves client-side against
 * this object (lib/exposure/query.ts) — there is deliberately no per-click
 * endpoint, because a click that costs a round-trip is a click nobody makes.
 *
 * Drivers are a SEPARATE route: they need per-issuer industry profiles and the
 * reference-fund probes, which are tens of provider calls and have no business
 * delaying the first paint.
 */

import { NextResponse } from "next/server";
import { getExposureModel } from "@/lib/exposure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const model = await getExposureModel({
      baseCurrency: url.searchParams.get("currency") ?? "USD",
    });
    return NextResponse.json(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build the exposure model";
    console.error("[exposure]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
