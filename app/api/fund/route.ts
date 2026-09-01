import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { getFundProfile, getHistory } from "@/lib/yahoo";
import { computeFundScore } from "@/lib/fund-scoring";
import { indiaCategoryBenchmark } from "@/lib/fund-scoring-india";
import { fundSectionInsight, type FundInsightSection } from "@/lib/ai-fund-research";
import type { FundProfileData, HistoryPoint, ScoreResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fund?symbol=SPY
 * Fund profile (holdings, sector/asset allocation, cost, performance) + its
 * composite score — the Fund research engine's data + scoring, parallel to
 * /api/fundamentals for equities.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  try {
    // 5y of history: the India path scores rolling 3-year returns, which need
    // more than the 2y the momentum blend alone required.
    const [fund, history] = await Promise.all([getFundProfile(symbol), getHistory(symbol, 1825)]);
    // Indian funds are judged against their SEBI-category benchmark when one
    // is defensible (tracking difference for passive funds, relative rolling
    // returns for active). Best-effort: a failed benchmark fetch degrades to
    // the honest absolute readings.
    const bench = indiaCategoryBenchmark(fund);
    const benchmarkHistory: HistoryPoint[] | undefined = bench
      ? await getHistory(bench.symbol, 1825).catch(() => undefined)
      : undefined;
    const score = computeFundScore(fund, history, undefined, benchmarkHistory);
    return NextResponse.json({ fund, score });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fund data lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

interface FundInsightRequest {
  section: FundInsightSection;
  symbol: string;
  name: string;
  fund: FundProfileData;
  score: ScoreResult;
}

/**
 * POST /api/fund — mode=insight only today (mirrors /api/ai/india's shape):
 * a per-tab "so what" AI insight grounded in the fund's own data, powering
 * AiFundInsight. Freeform fund chat runs through /api/research/chat's
 * fund branch instead (shares the Copilot's session/streaming plumbing).
 */
export async function POST(request: Request) {
  let body: FundInsightRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.symbol || !body.fund || !body.score || !body.section) {
    return NextResponse.json({ error: "symbol, name, fund, score, and section are required" }, { status: 400 });
  }

  try {
    const result = await fundSectionInsight({
      section: body.section,
      symbol: body.symbol,
      name: body.name ?? body.symbol,
      fund: body.fund,
      score: body.score,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI fund insight failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
