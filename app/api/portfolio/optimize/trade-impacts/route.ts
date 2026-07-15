/**
 * GET /api/portfolio/optimize/trade-impacts?objective=... — per-trade impact.
 *
 * Powers the Optimize tab's evidence-based bulk-select actions ("Select
 * Highest Impact", "Select Health Improvements", "Select Risk Reduction").
 * Deliberately a SEPARATE call from /api/portfolio/report: computing every
 * trade's impact individually is N extra simulate() calls, and the main
 * report loads on every tab, not just Optimize.
 */
import { NextResponse } from "next/server";
import { buildEvaluation } from "@/lib/portfolio/report";
import { optimize, DEFAULT_CONSTRAINTS, OBJECTIVES, computeTradeImpacts, type Objective } from "@/lib/portfolio/engines/optimize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const objParam = url.searchParams.get("objective");
  const objective = (objParam && objParam in OBJECTIVES ? objParam : "maximize_sharpe") as Objective;

  try {
    const { evaluation, ctx } = await buildEvaluation({ objective });
    const optimization = optimize(evaluation, objective, DEFAULT_CONSTRAINTS, undefined, ctx);
    const impacts = computeTradeImpacts(evaluation, ctx, optimization.trades);

    return NextResponse.json({
      impacts: Object.fromEntries(impacts),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to compute trade impacts";
    console.error("[portfolio/optimize/trade-impacts]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
