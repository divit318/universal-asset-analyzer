import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getQuote, getHistory } from "@/lib/yahoo";
import { computeCryptoScore } from "@/lib/crypto-scoring";
import { cryptoSectionInsight, type CryptoInsightSection } from "@/lib/ai-crypto-research";
import type { ScoreResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/crypto?symbol=BTC-USD
 * Crypto composite score (momentum, relative strength vs BTC, risk-adjusted
 * return, drawdown) — market-data only, parallel to /api/fund for funds.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  try {
    const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
    const [history, btcHistory] = await Promise.all([
      getHistory(symbol, 730),
      isBtc ? Promise.resolve([]) : getHistory("BTC-USD", 730),
    ]);
    const score = computeCryptoScore(symbol, history, btcHistory.length > 0 ? btcHistory : null);
    return NextResponse.json({ score, btcHistory });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Crypto data lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface CryptoInsightRequest {
  section: CryptoInsightSection;
  symbol: string;
  name: string;
  price: number;
  currency: string;
  changePercent: number;
  marketCap: number | null;
  score: ScoreResult;
}

/**
 * POST /api/crypto — mode=insight only today (mirrors /api/fund's POST):
 * a per-tab "so what" AI insight grounded in the crypto score, powering
 * AiCryptoInsight. Freeform chat runs through /api/research/chat's crypto
 * branch instead (shares the Copilot's session/streaming plumbing).
 */
export async function POST(request: Request) {
  let body: CryptoInsightRequest;
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
    const result = await cryptoSectionInsight({
      section: body.section,
      facts: {
        symbol: body.symbol,
        name: body.name ?? body.symbol,
        price: quote?.price ?? body.price,
        currency: quote?.currency ?? body.currency,
        changePercent: quote?.changePercent ?? body.changePercent,
        marketCap: quote?.marketCap ?? body.marketCap,
      },
      score: body.score,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI crypto insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
