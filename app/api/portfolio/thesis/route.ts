/**
 * GET /api/portfolio/thesis — the Portfolio Thesis + Identity banner.
 *
 * Deliberately a SEPARATE route from /api/portfolio/report. That route is pure
 * deterministic computation and must stay fast; this one makes an AI call.
 * Ollama serializes requests — firing an AI call from every section of the
 * page independently was measured and rejected earlier in this project. This
 * is the ONE AI call for the whole portfolio banner, cached by content hash so
 * it only re-fires when the portfolio composition actually changes.
 */
import { NextResponse } from "next/server";
import { buildPortfolioReport } from "@/lib/portfolio/report";
import { buildPortfolioThesis } from "@/lib/portfolio/thesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const report = await buildPortfolioReport({ baseCurrency: url.searchParams.get("currency") ?? "USD" });
    const thesis = await buildPortfolioThesis({
      holdings: report.holdings,
      totalValue: report.totalValue,
      allocation: report.allocation,
      risk: report.risk,
      health: report.health,
    });
    return NextResponse.json(thesis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build portfolio thesis";
    console.error("[portfolio/thesis]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
