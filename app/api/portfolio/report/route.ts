/**
 * GET /api/portfolio/report — the Universal Portfolio Report.
 *
 * Covers every asset class the user holds, including the real estate, private
 * markets, alternatives and structured products that live in the `manual_asset`
 * ledger and were previously invisible to the Portfolio entirely.
 *
 * Two things this route deliberately no longer does:
 *
 *   - It holds NO private cache. It used to keep `let cached: {report, at}` with its
 *     own 5-minute TTL — invisible to the platform layer, un-invalidatable, and
 *     unaware of the four other caches around it. CLAUDE.md: "Never add a cache to a
 *     module." Caching now happens where it belongs, in lib/platform/, at the
 *     provider boundary, so Portfolio shares a cache with Research and Screener
 *     instead of re-fetching quotes they just fetched.
 *
 *   - It hand-rolls NO fetch waterfall. lib/portfolio/context.ts declares one plan
 *     and lets runPlan() own concurrency, failure isolation and cancellation.
 */
import { NextResponse } from "next/server";
import { buildPortfolioReport } from "@/lib/portfolio/report";
import { OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseObjective(v: string | null): Objective {
  return v && v in OBJECTIVES ? (v as Objective) : "maximize_sharpe";
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    const rawPortfolioId = Number(url.searchParams.get("portfolioId") ?? "1");
    const report = await buildPortfolioReport({
      objective: parseObjective(url.searchParams.get("objective")),
      baseCurrency: url.searchParams.get("currency") ?? "USD",
      portfolioId: Number.isInteger(rawPortfolioId) && rawPortfolioId > 0 ? rawPortfolioId : 1,
    });
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build portfolio report";
    console.error("[portfolio/report]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
