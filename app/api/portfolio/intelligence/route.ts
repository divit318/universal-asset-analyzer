/**
 * GET /api/portfolio/intelligence — the portfolio critic.
 *
 * A SEPARATE route from /api/portfolio/report for the same reason the thesis
 * is: the report is pure deterministic computation and must stay fast, while
 * this route fetches fund constituents and makes one AI call (the synthesis —
 * cached by a content hash of the findings, so it only re-fires when a finding
 * actually appears, disappears, or changes severity).
 *
 * Main portfolio only, like the thesis and the Decision Center: the snapshot
 * baseline that powers "what changed" is a singleton, and letting a view-only
 * portfolio overwrite Main's baseline would corrupt the comparison.
 */
import { NextResponse } from "next/server";
import { getPortfolioReport } from "@/lib/portfolio/report";
import { buildPortfolioIntelligence } from "@/lib/portfolio/intelligence/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    // Through the platform's `portfolioReport` dataset — the SAME cached build
    // the page and the thesis route read. Calling buildPortfolioReport()
    // directly here re-ran the entire multi-symbol provider fetch on every
    // intelligence-tab open, seconds after the thesis route had just built it.
    const report = await getPortfolioReport({
      baseCurrency: url.searchParams.get("currency") ?? "USD",
    });
    const intelligence = await buildPortfolioIntelligence({
      holdings: report.holdings,
      totalValue: report.totalValue,
      allocation: report.allocation,
      risk: report.risk,
      health: report.health,
      attribution: report.attribution,
      baseCurrency: report.baseCurrency,
    });
    return NextResponse.json(intelligence);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build portfolio intelligence";
    console.error("[portfolio/intelligence]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
