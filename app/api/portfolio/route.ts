/**
 * Portfolio holdings CRUD — asset-class aware.
 *
 * The old route hardcoded `shares` of a `symbol` at an `avgCost`, with no class,
 * currency, or unit. Every holding it created was implicitly a US equity in USD
 * priced per share, which is why a bond fund or a gold position could be entered but
 * never analysed as what it actually was.
 */
import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { resolveDisplayName } from "@/lib/yahoo";
import { listPortfolio } from "@/lib/db";
import { listRawHoldings, upsertHolding, upsertCash, removeHolding } from "@/lib/portfolio/store";
import { hasClassAdapter, getClassAdapter } from "@/lib/portfolio/model/adapter";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/portfolio — every holding, from BOTH ledgers (market-priced + manual). */
export async function GET() {
  try {
    return NextResponse.json({
      holdings: listRawHoldings(),
      // The legacy equity-shaped view, still consumed by older callers.
      positions: listPortfolio(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read portfolio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface PostBody {
  symbol?: string;
  name?: string;
  shares?: number;
  quantity?: number;
  avgCost?: number;
  assetClass?: string;
  currency?: string;
  meta?: Record<string, unknown>;
  /** Cash-only: the amount held. */
  amount?: number;
  yieldPct?: number;
  vehicle?: string;
}

/**
 * POST /api/portfolio
 *
 * Equity/ETF/bond/crypto/…: { symbol, name, quantity, avgCost, assetClass, currency? }
 * Cash:                     { assetClass: "cash", currency, amount, yieldPct?, vehicle? }
 *
 * `shares` is still accepted as an alias for `quantity` so existing clients keep
 * working unchanged.
 */
export async function POST(request: Request) {
  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Default to equity: that is what every pre-existing caller means, so omitting the
  // field keeps them working exactly as before.
  const assetClass = (body.assetClass ?? "equity").toLowerCase();
  if (!hasClassAdapter(assetClass)) {
    return NextResponse.json(
      { error: `Unknown asset class "${assetClass}"` },
      { status: 400 },
    );
  }
  const cls = assetClass as PortfolioAssetClass;

  /* ---- Cash takes a different shape: there is no symbol and no price. ---- */
  if (cls === "cash") {
    const amount = body.amount ?? body.quantity;
    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "`amount` must be a positive number" }, { status: 400 });
    }
    const currency = (body.currency ?? "USD").toUpperCase();
    try {
      upsertCash(currency, amount, { yieldPct: body.yieldPct, vehicle: body.vehicle });
      return NextResponse.json({ ok: true, assetClass: cls, currency, amount }, { status: 201 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save cash position";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  /* ---- Everything else is symbol + quantity + cost. ---- */
  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json(
      { error: "`symbol` must be a valid ticker (e.g. AAPL)" },
      { status: 400 },
    );
  }

  const quantity = body.quantity ?? body.shares;
  if (typeof quantity !== "number" || quantity <= 0) {
    return NextResponse.json({ error: "`quantity` must be a positive number" }, { status: 400 });
  }
  if (typeof body.avgCost !== "number" || body.avgCost < 0) {
    return NextResponse.json({ error: "`avgCost` must be a non-negative number" }, { status: 400 });
  }

  try {
    const adapter = getClassAdapter(cls);
    // Resolve a real display name when the caller has none — otherwise a
    // holding added by symbol alone shows that symbol as its "name" forever
    // (an opaque Morningstar ID, for Indian mutual funds).
    const name = await resolveDisplayName(symbol, body.name);
    upsertHolding({
      symbol,
      name,
      quantity,
      avgCost: body.avgCost,
      assetClass: cls,
      currency: body.currency ?? "USD",
      // The class knows its own unit — coins for crypto, face for bonds, shares for
      // equities. The caller doesn't have to.
      unit: adapter.unit,
      meta: body.meta,
    });
    return NextResponse.json({ ok: true, symbol, assetClass: cls }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save position";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/portfolio?symbol=AAPL */
export async function DELETE(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });

  try {
    removeHolding(symbol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove position";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
