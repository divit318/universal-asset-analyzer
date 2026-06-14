import { NextResponse } from "next/server";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { assessRisks, computeScore } from "@/lib/scoring";
import type { FinancialStatements, FundamentalsData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fundamentals?symbol=AAPL
 * Yahoo snapshot/analyst/insider + EDGAR statements → composite score + risks.
 * EDGAR is non-fatal: scoring degrades gracefully if statements are missing.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json(
      { error: "A `symbol` query parameter is required" },
      { status: 400 },
    );
  }

  let parts;
  try {
    parts = await getFundamentals(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Fundamentals lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  let statements: FinancialStatements | null = null;
  let statementsError: string | null = null;
  try {
    statements = await getFinancialStatements(symbol);
  } catch (err) {
    statementsError = err instanceof Error ? err.message : "EDGAR statements unavailable";
  }

  const score = computeScore(parts.snapshot, statements, parts.analyst);
  const risks = assessRisks(parts.snapshot, statements, parts.analyst, parts.insider);

  const payload: FundamentalsData = {
    snapshot: parts.snapshot,
    statements,
    statementsError,
    analyst: parts.analyst,
    insider: parts.insider,
    score,
    risks,
  };
  return NextResponse.json(payload);
}
