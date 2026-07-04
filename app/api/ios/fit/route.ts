/**
 * GET /api/ios/fit?symbol=AAPL&sector=Technology&marketCap=3000000000000
 *
 * Returns a PortfolioFitAnalysis for a single asset. Loads the portfolio
 * report from the existing in-memory cache, builds InvestmentProfile, and
 * runs the fit scorer. Safe to call server-side or from SSR contexts.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getPortfolioForIOS } from "@/lib/ios/server";
import { buildInvestmentProfile } from "@/lib/ios/profile";
import { computePortfolioFit } from "@/lib/ios/fit-scorer";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";
import type { FitAssetData } from "@/lib/ios/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const symbol    = sp.get("symbol")?.trim().toUpperCase();
  const sector    = sp.get("sector");
  const marketCap = sp.get("marketCap") ? Number(sp.get("marketCap")) : null;
  const geography = sp.get("geography") as FitAssetData["geography"] ?? "US";
  const dividend  = sp.get("dividendYield") ? Number(sp.get("dividendYield")) : null;
  const beta      = sp.get("beta") ? Number(sp.get("beta")) : null;

  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }

  const { report, objective, constraints } = await getPortfolioForIOS();
  const profile = buildInvestmentProfile(
    report,
    objective,
    constraints ?? DEFAULT_CONSTRAINTS,
  );

  const asset: FitAssetData = {
    symbol,
    sector: sector ?? null,
    marketCap: Number.isFinite(marketCap!) ? marketCap : null,
    geography,
    dividendYield: Number.isFinite(dividend!) ? dividend : null,
    beta: Number.isFinite(beta!) ? beta : null,
  };

  const fit = computePortfolioFit(asset, profile);
  return NextResponse.json(fit);
}
