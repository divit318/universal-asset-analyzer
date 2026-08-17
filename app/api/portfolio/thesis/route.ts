/**
 * GET /api/portfolio/thesis — the Portfolio Thesis + Identity banner.
 *
 * Deliberately a SEPARATE route from /api/portfolio/report. That route is pure
 * deterministic computation and must stay fast; this one makes an AI call.
 * Firing an AI call from every section of the
 * page independently was measured and rejected earlier in this project. This
 * is the ONE AI call for the whole portfolio banner, cached by content hash so
 * it only re-fires when the portfolio composition actually changes.
 */
import { NextResponse } from "next/server";
import { getPortfolioReport } from "@/lib/portfolio/report";
import { getPortfolioThesis } from "@/lib/portfolio/thesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  try {
    // Through the platform's `portfolioReport` dataset — the SAME cached build
    // the page's own /api/portfolio/report fetch just made (2-min TTL + SWR,
    // invalidated on mutation). This route used to call buildPortfolioReport()
    // directly, which re-ran the entire two-pass provider fetch on every page
    // load just to compute a content hash: measured at ~20s per hit even when
    // the thesis itself was served from its content-hash cache. With the shared
    // dataset, a cached-thesis load costs milliseconds and the only remaining
    // slow path is a genuine AI regeneration after the composition changed.
    const report = await getPortfolioReport({ baseCurrency: url.searchParams.get("currency") ?? "USD" });
    // Through the `portfolioThesis` dataset: 6h fresh / 24h SWR, persisted,
    // coalesced, invalidated on every portfolio mutation. A stale thesis is
    // served instantly while one background regeneration refreshes it.
    const thesis = await getPortfolioThesis(
      {
        holdings: report.holdings,
        totalValue: report.totalValue,
        allocation: report.allocation,
        risk: report.risk,
        alignment: report.alignment,
        policy: report.policy,
      },
      // Evidence the prompt could not previously see. The report has already
      // computed both, so passing them through costs nothing and is the difference
      // between a model that describes the portfolio and one that can reason about
      // where its return came from and whether the last change helped.
      { attribution: report.attribution, lastChange: report.trajectory?.changes[0] ?? null },
    );
    return NextResponse.json(thesis);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build portfolio thesis";
    console.error("[portfolio/thesis]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
