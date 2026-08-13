/**
 * GET /api/exposure/labels — optional AI names for co-movement clusters.
 *
 * The most peripheral route in the feature, and deliberately so. The client
 * calls it only after drivers have already rendered, and only when at least one
 * driver's sole basis is a measured correlation (whose deterministic label is
 * its membership list — accurate, unreadable). Everything on the page is
 * complete and correct before and without it.
 *
 * The model receives symbols and industries and returns words. It never sees a
 * weight and can never change one; see lib/exposure/label.ts for the guards.
 */

import { NextResponse } from "next/server";
import { getExposureDrivers, getExposureModel } from "@/lib/exposure";
import { needsLabel, nameCoMovementClusters } from "@/lib/exposure/label";
import { fetchIssuerProfiles } from "@/lib/exposure/drivers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const currency = url.searchParams.get("currency") ?? "USD";

  try {
    const drivers = await getExposureDrivers({ baseCurrency: currency });
    const targets = drivers.drivers.filter(needsLabel);
    if (targets.length === 0) return NextResponse.json({ labels: [] });

    // Industries are already cached from the drivers pass, so this is a map
    // read in practice rather than a second fetch.
    const model = await getExposureModel({ baseCurrency: currency });
    const { profiles } = await fetchIssuerProfiles(model.issuers);

    const named = await nameCoMovementClusters(targets, (symbol) => profiles.get(symbol)?.industry ?? null);

    return NextResponse.json({
      labels: named
        .filter((d) => d.labelFromAi)
        .map((d) => ({ id: d.id, label: d.label })),
    });
  } catch (err) {
    // A failure here is a non-event: the caller keeps the deterministic labels.
    console.error("[exposure/labels]", err);
    return NextResponse.json({ labels: [] });
  }
}
