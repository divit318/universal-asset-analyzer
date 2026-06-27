import { NextResponse } from "next/server";
import { getQuoteSummary } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unwrap Yahoo { raw, fmt } wrapper or bare number. */
const r = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && "raw" in (v as object)) {
    const rv = (v as { raw?: number }).raw;
    return rv != null && Number.isFinite(rv) ? rv : null;
  }
  return null;
};

export interface DcfPrefill {
  symbol: string;
  name: string;
  price: number | null;
  freeCashflow: number | null;       // TTM FCF in dollars
  sharesOutstanding: number | null;  // count
  totalDebt: number | null;          // dollars
  totalCash: number | null;          // dollars
  netDebt: number | null;            // = totalDebt - totalCash
  operatingMargins: number | null;   // fraction, e.g. 0.23
  revenueGrowth: number | null;      // TTM YoY fraction
  discountRateSuggestion: number;    // WACC suggestion in percent
}

/**
 * GET /api/dcf?symbol=AAPL
 * Returns the pre-fill inputs for the DCF model from Yahoo Finance.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol required" }, { status: 400 });
  }

  let raw: Record<string, unknown>;
  try {
    raw = (await getQuoteSummary(symbol, [
      "financialData",
      "defaultKeyStatistics",
      "price",
    ])) as Record<string, unknown>;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 404 },
    );
  }

  const fd = (raw.financialData ?? {}) as Record<string, unknown>;
  const ks = (raw.defaultKeyStatistics ?? {}) as Record<string, unknown>;
  const pr = (raw.price ?? {}) as Record<string, unknown>;

  const price = r(fd.currentPrice) ?? r(pr.regularMarketPrice);
  const totalDebt = r(fd.totalDebt);
  const totalCash = r(fd.totalCash);
  const netDebt = totalDebt != null && totalCash != null ? totalDebt - totalCash : null;
  const freeCashflow = r(fd.freeCashflow);
  const sharesOutstanding = r(ks.sharesOutstanding);
  const revenueGrowth = r(fd.revenueGrowth);

  // Suggest a WACC based on beta. Beta is in defaultKeyStatistics.
  const beta = r(ks.beta) ?? 1;
  // CAPM approximation: Rf=4.5% (10-yr treasury), ERP=5.5%
  const costOfEquity = 4.5 + beta * 5.5;
  // Assume 70% equity weighting → blended WACC suggestion
  const discountRateSuggestion = Math.max(8, Math.min(16, costOfEquity * 0.7 + 4.5 * 0.3));

  const name = (pr.longName as string | undefined) ?? (pr.shortName as string | undefined) ?? symbol;

  const payload: DcfPrefill = {
    symbol,
    name,
    price,
    freeCashflow,
    sharesOutstanding,
    totalDebt,
    totalCash,
    netDebt,
    operatingMargins: r(fd.operatingMargins),
    revenueGrowth,
    discountRateSuggestion: parseFloat(discountRateSuggestion.toFixed(1)),
  };

  return NextResponse.json(payload);
}
