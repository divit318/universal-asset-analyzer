/**
 * POST /api/portfolio/allocate-cash — { amount: 50000 }
 *
 * Allocates new cash across the ENTIRE investable universe: existing holdings, every
 * candidate exposure (bonds, gold, international, TIPS, …), and cash itself.
 *
 * The engine this replaces could only route cash into positions the user already
 * owned. If your portfolio was 100% tech stocks, its advice on a $50k inflow was:
 * buy more tech stocks. "Add a Treasury ETF" and "hold it in cash" were not opinions
 * it disagreed with — they were sentences it could not form.
 */
import { NextResponse } from "next/server";
import { listRawHoldings } from "@/lib/portfolio/store";
import { buildMarketContext } from "@/lib/portfolio/context";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computeCashAllocation } from "@/lib/portfolio/engines/cash";
import { candidateSymbols } from "@/lib/portfolio/engines/candidates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { amount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "`amount` must be a positive number" }, { status: 400 });
  }

  try {
    const raws = listRawHoldings();
    // This endpoint is the deliberate "explore everything" path — the user
    // explicitly asked to see what could be done with new cash, so unlike the
    // main report it fetches the full candidate universe, not just the ones a
    // detected gap already points at.
    const ctx = await buildMarketContext(raws, { candidateSymbols: candidateSymbols() });
    const { holdings } = normalizeHoldings(raws, ctx);
    const evaluation = evaluate(holdings, ctx);

    return NextResponse.json(computeCashAllocation(evaluation, body.amount, ctx));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cash allocation failed";
    console.error("[portfolio/allocate-cash]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
