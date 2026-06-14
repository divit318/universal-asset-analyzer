import { NextResponse } from "next/server";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { getHistory } from "@/lib/yahoo";
import { assessRisks, computeMomentum, computeScore } from "@/lib/scoring";
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

  // Statements (EDGAR) and ~14 months of price history (for the momentum
  // signal) are both best-effort and fetched in parallel with each other.
  const [statementsResult, history] = await Promise.all([
    getFinancialStatements(symbol).then(
      (s) => ({ statements: s as FinancialStatements | null, error: null as string | null }),
      (err: unknown) => ({
        statements: null,
        error: err instanceof Error ? err.message : "EDGAR statements unavailable",
      }),
    ),
    getHistory(symbol, 420),
  ]);
  const { statements, error: statementsError } = statementsResult;
  const momentum = computeMomentum(history);

  const score = computeScore(parts.snapshot, statements, parts.analyst, momentum);
  const risks = assessRisks(parts.snapshot, statements, parts.analyst, parts.insider);

  const payload: FundamentalsData = {
    snapshot: parts.snapshot,
    statements,
    statementsError,
    analyst: parts.analyst,
    insider: parts.insider,
    score,
    risks,
    momentum,
  };
  return NextResponse.json(payload);
}
