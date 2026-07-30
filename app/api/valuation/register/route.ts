import { NextResponse } from "next/server";
import { listValuationCases } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import {
  caseFlags,
  compareForRegister,
  summarizeForDisplay,
  type CaseFlag,
  type ValuationSummary,
} from "@/lib/valuation/summary";
import { hasEnginePriors } from "@/lib/valuation/engine-prior";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RegisterRow extends ValuationSummary {
  flags: CaseFlag[];
}

export interface RegisterResponse {
  rows: RegisterRow[];
  /** True when the quant engine has published priors to compare against. */
  hasEnginePriors: boolean;
  /** Non-fatal note when live prices could not be fetched. */
  priceWarning: string | null;
}

/**
 * GET /api/valuation/register — every valuation case you hold.
 *
 * Cases are repriced against live quotes here rather than trusting the stored
 * margin of safety, which is as of each case's last write. Quotes are fetched in
 * one batch and their failure is non-fatal: a register showing stale margins with
 * a warning is far more useful than one that refuses to load.
 */
export async function GET() {
  const cases = listValuationCases();
  if (cases.length === 0) {
    return NextResponse.json({
      rows: [],
      hasEnginePriors: hasEnginePriors(),
      priceWarning: null,
    } satisfies RegisterResponse);
  }

  let prices = new Map<string, number>();
  let priceWarning: string | null = null;
  try {
    const quotes = await getQuotes(cases.map((c) => c.symbol));
    prices = new Map(
      quotes
        .filter((q) => typeof q.price === "number" && Number.isFinite(q.price))
        .map((q) => [q.symbol.toUpperCase(), q.price]),
    );
  } catch {
    priceWarning = "Live prices unavailable — margins of safety are as of each case's last change.";
  }

  const rows = cases
    .map((c) => summarizeForDisplay(c, prices.get(c.symbol.toUpperCase()) ?? null))
    .sort(compareForRegister)
    .map((summary) => ({ ...summary, flags: caseFlags(summary) }));

  return NextResponse.json({
    rows,
    hasEnginePriors: hasEnginePriors(),
    priceWarning,
  } satisfies RegisterResponse);
}
