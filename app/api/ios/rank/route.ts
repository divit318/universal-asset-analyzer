/**
 * POST /api/ios/rank
 * Body: { assets: Array<FitAssetData & { absoluteScore: number }>, fitWeight?: number }
 *
 * Returns the same array re-ranked by combinedScore = (1-fitWeight) * absolute + fitWeight * fit.
 * Default fitWeight = 0.4 (40% portfolio fit, 60% absolute quality).
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getPortfolioForIOS } from "@/lib/ios/server";
import { buildInvestmentProfile, fromLegacyReport } from "@/lib/ios/profile";
import { rankByFit } from "@/lib/ios/fit-scorer";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";
import type { FitAssetData } from "@/lib/ios/types";

export async function POST(req: NextRequest) {
  let body: { assets?: Array<FitAssetData & { absoluteScore: number }>; fitWeight?: number };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { assets, fitWeight = 0.4 } = body;
  if (!Array.isArray(assets) || assets.length === 0) {
    return NextResponse.json({ error: "assets array is required" }, { status: 400 });
  }

  const { report, objective, constraints } = await getPortfolioForIOS();
  const profile = buildInvestmentProfile(
    report ? fromLegacyReport(report) : null,
    objective,
    constraints ?? DEFAULT_CONSTRAINTS,
  );

  const ranked = rankByFit(assets, profile, fitWeight);
  return NextResponse.json({ ranked });
}
