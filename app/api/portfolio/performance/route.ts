import { NextResponse } from "next/server";
import { buildEvaluation } from "@/lib/portfolio/report";
import { buildPerformance } from "@/lib/portfolio/performance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/portfolio/performance
 *
 * Money-weighted (XIRR) performance, the realized/unrealized split, and a true
 * benchmark-relative comparison, for callers that want performance WITHOUT the
 * rest of the report.
 *
 * The Portfolio page does NOT use this route. It reads `report.performance`, which
 * is derived from the report's own evaluation, because two routes each building
 * their own `MarketContext` against a 15-second quote cache produced two totals
 * that could not reconcile — a measured $2,074.82 gap between the page headline and
 * this panel's own "total portfolio value". Anything that renders BOTH a portfolio
 * total and a performance figure must take them from one report.
 *
 * All the math lives in lib/portfolio/performance.ts and lib/portfolio-performance.ts.
 * This route is a thin adapter over the same functions, so it cannot drift from the
 * page's numbers by definition — only by snapshot time.
 */
export async function GET(request: Request) {
  const portfolioId = Number(new URL(request.url).searchParams.get("portfolioId") ?? 1);
  if (!Number.isInteger(portfolioId) || portfolioId < 1) {
    return NextResponse.json({ error: "Invalid portfolioId" }, { status: 400 });
  }

  try {
    const { ctx, evaluation } = await buildEvaluation({ portfolioId });
    const performance = await buildPerformance(evaluation.holdings, ctx.asOf, portfolioId, ctx);
    return NextResponse.json(performance);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute performance";
    console.error("[portfolio/performance]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
