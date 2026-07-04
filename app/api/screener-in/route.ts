import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import {
  getScreenerInCompany,
  getPeers,
  getPromoterHolding,
  getFIIHolding,
  getDIIHolding,
  getRatio,
} from "@/lib/screener-in";
import { getQuote } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/screener-in?symbol=RELIANCE
 *
 * Returns enriched screener.in data + live Yahoo quote merged together.
 * Designed for the Indian stock research view.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` parameter is required" }, { status: 400 });
  }

  const [company, quoteResult] = await Promise.allSettled([
    getScreenerInCompany(symbol),
    getQuote(`${symbol.replace(/\.(NS|BO)$/i, "")}.NS`),
  ]);

  if (company.status === "rejected" || company.value == null) {
    return NextResponse.json(
      { error: `Company "${symbol}" not found on screener.in` },
      { status: 404 },
    );
  }

  const data = company.value;
  const quote = quoteResult.status === "fulfilled" ? quoteResult.value : null;

  return NextResponse.json({
    company: data,
    quote,
    derived: {
      promoterHolding: getPromoterHolding(data),
      fiiHolding: getFIIHolding(data),
      diiHolding: getDIIHolding(data),
      evToEbitda: getRatio(data, "EV / EBITDA"),
      priceToSales: getRatio(data, "Price to Sales"),
      priceToBook: getRatio(data, "Price to Book"),
      debtToEquity: getRatio(data, "Debt to Equity"),
      interestCoverage: getRatio(data, "Interest Coverage"),
      peers: getPeers(data),
    },
  });
}
