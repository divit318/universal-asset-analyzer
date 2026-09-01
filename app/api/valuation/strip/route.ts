import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getValuationCase } from "@/lib/db";
import { summarizeForDisplay, type ValuationSummary } from "@/lib/valuation/summary";
import { getEnginePrior } from "@/lib/valuation/engine-prior";
import type { AssumptionSource } from "@/lib/valuation/case";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface StripResponse {
  /** Null when this symbol has no case — the strip then renders nothing. */
  summary: ValuationSummary | null;
  /** Stage-one growth the case currently assumes — for an untouched case, the seed's key judgment. */
  seedGrowth: number | null;
  /** Where that growth came from ("history" means the business's own delivered FCF CAGR). */
  seedGrowthSource: AssumptionSource | null;
}

/**
 * GET /api/valuation/strip?symbol=AAPL&price=232.11
 *
 * The Research Hub's read-only view of the case. Deliberately does *not* seed a
 * case and does *not* fetch a quote: the Hub already has the live price and the
 * strip must not add a network round-trip to a page on a two-second budget, nor
 * silently create rows for every symbol a user merely glances at.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  const vcase = getValuationCase(symbol);
  if (!vcase) {
    return NextResponse.json({ summary: null, seedGrowth: null, seedGrowthSource: null } satisfies StripResponse);
  }

  const priceParam = Number(url.searchParams.get("price"));
  const livePrice = Number.isFinite(priceParam) && priceParam > 0 ? priceParam : null;

  return NextResponse.json({
    summary: summarizeForDisplay(vcase, livePrice, getEnginePrior(symbol)),
    seedGrowth: vcase.assumptions.growthRate1.value,
    seedGrowthSource: vcase.assumptions.growthRate1.source,
  } satisfies StripResponse);
}
