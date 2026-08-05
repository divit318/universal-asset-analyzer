import { NextResponse } from "next/server";
import { buildCompanyContext } from "@/lib/ai/context";
import { readPortfolioFacts } from "@/lib/ai/facts";
import { normalizeSymbol } from "@/lib/market";
import { getVerdict, planVerdict, verdictCacheParams, type InvestmentVerdict } from "@/lib/ai/verdict";
import { personalizationParams } from "@/lib/ai/verdict-params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `InvestmentVerdict` is defined in lib/ai/verdict.ts (so both this route and
 * the streamed /api/ai/report can build it), and re-exported here because six
 * client components already import the type from this path.
 */
export type { InvestmentVerdict };

/**
 * GET /api/ai/verdict?symbol=AAPL
 *
 * The **blocking** verdict: one request, one complete `InvestmentVerdict`.
 *
 * Prefer `/api/ai/report`, which runs the same generation from the same plan but
 * streams each field as it closes (~4s to first content instead of ~40s to all
 * of it). This route is kept because it is the right shape for consumers that
 * need the finished object and cannot progressively render — the Excel/PDF
 * exporters — and because removing a working public endpoint would break any
 * saved links to it.
 *
 * Asset-class dispatch, prompt construction, grounding verification, and the
 * AI-unavailable fallback all live in lib/ai/verdict.ts. This handler only maps
 * HTTP to that module.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });

  let ctx;
  try {
    ctx = await buildCompanyContext(symbol);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data" },
      { status: 404 },
    );
  }

  const plan = await planVerdict(ctx, readPortfolioFacts(url));
  const params = verdictCacheParams(ctx.symbol, plan.kind, personalizationParams(url));

  // Read-through the platform cache. A repeat view of the same company with the
  // same portfolio context costs nothing instead of another full local inference.
  const { verdict, cached } = await getVerdict(plan, params, {
    signal: request.signal,
    fresh: url.searchParams.get("refresh") === "1",
  });

  return NextResponse.json(verdict, {
    headers: { "X-UAA-Cache": cached ? "hit" : "miss" },
  });
}
