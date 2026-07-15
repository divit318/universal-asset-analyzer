/**
 * POST /api/portfolio/buy — buy an asset directly (e.g. from the Watchlist)
 * and record it in the real portfolio ledger.
 *
 * Deliberately thin: all it does is resolve a live price and call
 * addUniversalLot(), the Transaction Engine's additive write primitive
 * (lib/portfolio/engines/transaction.ts). It never calls upsertHolding() /
 * upsertUniversalPosition() — those REPLACE a symbol's ledger with one
 * opening lot ("set position" semantics), which would silently discard an
 * existing position's cost basis instead of averaging into it. addUniversalLot
 * appends a lot, so an existing position's avg-cost and realized P&L stay
 * correct via lib/portfolio-lots.ts's aggregateLots() — no new math here.
 */
import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import { getQuotes } from "@/lib/yahoo";
import { addUniversalLot } from "@/lib/portfolio/engines/transaction";
import { listRawHoldings } from "@/lib/portfolio/store";
import { TICKER_PRICED_ASSET_CLASSES, detectPortfolioAssetClass, type PortfolioAssetClass } from "@/lib/portfolio/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_CLASSES = TICKER_PRICED_ASSET_CLASSES;

interface BuyBody {
  symbol?: string;
  name?: string;
  /** Exactly one of quantity / amount must be supplied. */
  quantity?: number;
  amount?: number;
  assetClass?: string;
}

export async function POST(request: Request) {
  let body: BuyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "`symbol` must be a valid ticker (e.g. AAPL)" }, { status: 400 });
  }

  const hasQuantity = body.quantity != null;
  const hasAmount = body.amount != null;
  if (hasQuantity === hasAmount) {
    return NextResponse.json({ error: "Provide exactly one of `quantity` or `amount`" }, { status: 400 });
  }
  const quantity = hasQuantity ? Number(body.quantity) : null;
  const amount = hasAmount ? Number(body.amount) : null;
  if (quantity != null && (!Number.isFinite(quantity) || quantity <= 0)) {
    return NextResponse.json({ error: "`quantity` must be a positive number" }, { status: 400 });
  }
  if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
    return NextResponse.json({ error: "`amount` must be a positive number" }, { status: 400 });
  }

  let assetClass: PortfolioAssetClass | null = null;
  if (body.assetClass != null) {
    if (!TICKER_CLASSES.includes(body.assetClass as PortfolioAssetClass)) {
      return NextResponse.json(
        { error: `\`assetClass\` must be one of: ${TICKER_CLASSES.join(", ")}` },
        { status: 400 },
      );
    }
    assetClass = body.assetClass as PortfolioAssetClass;
  }

  // Price is ALWAYS the live server-fetched quote — never trust a client-supplied
  // price, which could be stale (user sat on the modal) or manipulated.
  let quotes;
  try {
    quotes = await getQuotes([symbol]);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote fetch failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  const quote = quotes[0];
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    return NextResponse.json({ error: `No live price available for ${symbol}` }, { status: 502 });
  }

  const shares = quantity ?? amount! / quote.price;
  if (!Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json({ error: "Computed share quantity was zero or invalid" }, { status: 400 });
  }

  const resolvedClass = assetClass ?? detectPortfolioAssetClass(quote.assetType);

  const name = body.name?.trim() || quote.name || symbol;

  try {
    addUniversalLot({
      symbol,
      name,
      shares,
      price: quote.price,
      kind: "buy",
      assetClass: resolvedClass,
      currency: quote.currency,
      meta: { source: "watchlist_buy" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record purchase";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const holding = listRawHoldings().find((h) => h.symbol === symbol) ?? null;

  return NextResponse.json(
    {
      ok: true,
      symbol,
      name,
      shares,
      price: quote.price,
      currency: quote.currency,
      assetClass: resolvedClass,
      totalCost: shares * quote.price,
      holding,
    },
    { status: 201 },
  );
}
