import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getQuote, getHistory } from "@/lib/yahoo";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "@/lib/forex-scoring";
import { forexSectionInsight, type ForexInsightSection } from "@/lib/ai-forex-research";
import type { NewsItem, ScoreResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/forex?symbol=EURUSD=X
 * Forex composite score (momentum, relative strength vs Dollar Index, risk-
 * adjusted return, drawdown) — market-data only, parallel to /api/commodity.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  try {
    const isDxy = symbol.toUpperCase() === DOLLAR_INDEX_SYMBOL.toUpperCase();
    const [history, benchmarkHistory] = await Promise.all([
      getHistory(symbol, 730),
      isDxy ? Promise.resolve([]) : getHistory(DOLLAR_INDEX_SYMBOL, 730),
    ]);
    const score = computeForexScore(symbol, history, benchmarkHistory.length > 0 ? benchmarkHistory : null);
    return NextResponse.json({ score, benchmarkHistory });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Forex data lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface ForexInsightRequest {
  section: ForexInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  score: ScoreResult;
  news?: NewsItem[];
}

/**
 * POST /api/forex — mode=insight only today, mirrors /api/commodity's POST.
 * `news` (already fetched by /api/research for every symbol) is passed from
 * the client rather than re-fetched, and only used by the macro-context
 * section — the other sections are market-data only.
 */
export async function POST(request: Request) {
  let body: ForexInsightRequest;
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
    const result = await forexSectionInsight({
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
    const message = err instanceof Error ? err.message : "AI forex insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
