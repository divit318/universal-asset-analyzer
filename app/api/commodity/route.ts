import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getQuote, getHistory } from "@/lib/yahoo";
import { computeCommodityScore } from "@/lib/commodity-scoring";
import { commoditySectionInsight, type CommodityInsightSection } from "@/lib/ai-commodity-research";
import { COMMODITY_BENCHMARK_SYMBOL } from "@/lib/research-engines/commodity";
import type { NewsItem, ScoreResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/commodity?symbol=GC=F
 * Commodity composite score (momentum, relative strength vs DBC, risk-
 * adjusted return, drawdown) — market-data only, parallel to /api/crypto.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  try {
    const [history, benchmarkHistory] = await Promise.all([
      getHistory(symbol, 730),
      getHistory(COMMODITY_BENCHMARK_SYMBOL, 730),
    ]);
    const score = computeCommodityScore(history, benchmarkHistory.length > 0 ? benchmarkHistory : null);
    return NextResponse.json({ score, benchmarkHistory });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Commodity data lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface CommodityInsightRequest {
  section: CommodityInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  score: ScoreResult;
  news?: NewsItem[];
}

/**
 * POST /api/commodity — mode=insight only today, mirrors /api/crypto's POST.
 * `news` (already fetched by /api/research for every symbol) is passed from
 * the client rather than re-fetched, and only used by the supply-demand
 * section — the other sections are market-data only.
 */
export async function POST(request: Request) {
  let body: CommodityInsightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.symbol || !body.score || !body.section) {
    return NextResponse.json({ error: "symbol, score, and section are required" }, { status: 400 });
  }

  try {
    const quote = await getQuote(body.symbol).catch(() => null);
    const result = await commoditySectionInsight({
      section: body.section,
      facts: {
        symbol: body.symbol,
        name: quote?.name ?? body.name ?? body.symbol,
        price: quote?.price ?? body.price,
        currency: quote?.currency ?? body.currency,
        changePercent: quote?.changePercent ?? body.changePercent,
      },
      score: body.score,
      news: body.news ?? [],
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI commodity insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
