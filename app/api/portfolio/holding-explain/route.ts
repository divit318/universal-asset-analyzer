/**
 * GET /api/portfolio/holding-explain?holdingId=... — "Why do I own this?"
 *
 * Strictly on-demand: the UI calls this only when the user clicks a specific
 * holding's explain button, never automatically for every row. Cached by
 * (holding, portfolio) content hash, so re-opening the same holding is instant.
 */
import { NextResponse } from "next/server";
import { getPortfolioReport } from "@/lib/portfolio/report";
import { explainHolding } from "@/lib/portfolio/holding-explain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const holdingId = url.searchParams.get("holdingId");
  if (!holdingId) {
    return NextResponse.json({ error: "holdingId is required" }, { status: 400 });
  }

  try {
    // Cached dataset, not a direct rebuild — clicking "why do I own this?"
    // must not re-run the whole multi-symbol report fetch (see the
    // intelligence route's identical fix).
    const report = await getPortfolioReport({ baseCurrency: url.searchParams.get("currency") ?? "USD" });
    const holding = report.holdings.find((h) => h.id === holdingId);
    if (!holding) {
      return NextResponse.json({ error: "Holding not found" }, { status: 404 });
    }

    const explanation = await explainHolding(
      holding,
      { holdings: report.holdings, totalValue: report.totalValue, allocation: report.allocation, risk: report.risk, alignment: report.alignment, policy: report.policy },
      report.recommendations,
    );
    return NextResponse.json(explanation);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to explain holding";
    console.error("[portfolio/holding-explain]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
