import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { fetchValuationFacts, type DeliveredGrowth } from "@/lib/valuation/prefill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Field hints for the valuation workspace: what the data says, before any
 * judgment is applied. The assumptions themselves live in the ValuationCase
 * (/api/valuation) — this endpoint only reports the underlying facts, so there
 * is exactly one place that turns a Yahoo payload into valuation inputs
 * (lib/valuation/prefill.ts).
 */
export interface DcfPrefill {
  symbol: string;
  name: string;
  price: number | null;
  /** ISO 4217 code the reported figures are denominated in. */
  currency: string;
  freeCashflow: number | null;       // TTM FCF in reporting currency
  sharesOutstanding: number | null;  // count
  totalDebt: number | null;
  totalCash: number | null;
  netDebt: number | null;            // = totalDebt - totalCash
  operatingMargins: number | null;   // fraction, e.g. 0.23
  /** Growth the business delivered, and what that figure measures. */
  deliveredGrowth: DeliveredGrowth;
  discountRateSuggestion: number;    // WACC in percent
  beta: number | null;
  debtToEquity: number | null;       // ratio, e.g. 1.45
  terminalGrowthSuggestion: number;  // percent
}

/** GET /api/dcf?symbol=AAPL */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  try {
    const facts = await fetchValuationFacts(symbol);
    const payload: DcfPrefill = {
      symbol: facts.symbol,
      name: facts.name,
      price: facts.price,
      currency: facts.currency,
      freeCashflow: facts.baseFcf,
      sharesOutstanding: facts.sharesOutstanding,
      totalDebt: facts.totalDebt,
      totalCash: facts.totalCash,
      netDebt: facts.netDebt,
      operatingMargins: facts.operatingMargins,
      deliveredGrowth: facts.deliveredGrowth,
      discountRateSuggestion: facts.wacc.waccPercent,
      beta: facts.beta,
      debtToEquity: facts.debtToEquity,
      terminalGrowthSuggestion: facts.terminalGrowth,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 404 },
    );
  }
}
