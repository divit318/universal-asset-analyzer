import { NextResponse } from "next/server";
import { generateFinancialInsight } from "@/lib/ai-financial-insight";
import type { FinancialStatements, FundamentalsSnapshot, ScoreResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ai/financial-insight
 * Body: { symbol, snapshot, statements, score }
 *
 * Takes the already-fetched fundamentals data from the client (Research page
 * already has all of it in state) rather than refetching Yahoo/EDGAR here —
 * mirrors the India AiSectionInsight route's POST-with-body pattern.
 */
export async function POST(request: Request) {
  let body: {
    symbol?: string;
    snapshot?: FundamentalsSnapshot;
    statements?: FinancialStatements | null;
    score?: ScoreResult;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, snapshot, statements, score } = body;
  if (!symbol || !snapshot || !score) {
    return NextResponse.json({ error: "symbol, snapshot, and score are required" }, { status: 400 });
  }

  try {
    const result = await generateFinancialInsight({ symbol, snapshot, statements: statements ?? null, score });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Financial insight generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
