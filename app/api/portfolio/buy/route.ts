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
import { addUniversalLot, captureSnapshot, executeTrades, isIndivisibleHolding, type TradeToExecute } from "@/lib/portfolio/engines/transaction";
import { buildEvaluation } from "@/lib/portfolio/report";
import { listRawHoldings } from "@/lib/portfolio/store";
import { TICKER_PRICED_ASSET_CLASSES, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { assetClassFromQuoteType } from "@/lib/portfolio/classes/reference/risk-models";
import type { Objective } from "@/lib/portfolio/engines/optimize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKER_CLASSES = TICKER_PRICED_ASSET_CLASSES;

/** A sell the Investment Recommendation modal's Funding Source step asked to execute first, to raise the cash this buy needs. */
interface SellFirstInput {
  holdingId: string;
  amount: number;
  reason?: string;
}

interface BuyBody {
  symbol?: string;
  name?: string;
  /** Exactly one of quantity / amount must be supplied. */
  quantity?: number;
  amount?: number;
  assetClass?: string;
  /** Funding: sell these existing holdings (by dollar amount) before recording the buy. */
  sellFirst?: SellFirstInput[];
  /** Objective the sell trades are recorded under — cosmetic (ledger provenance), does not affect execution. */
  objective?: Objective;
  /** Optional trade date (YYYY-MM-DD); defaults to today in addUniversalLot. */
  tradeDate?: string;
  /** Optional broker/commission fees, recorded on the lot. */
  fees?: number;
  /** Optional free-form provenance (broker, account, commission, taxes, notes) — merged into portfolio_lot.meta. */
  meta?: Record<string, unknown>;
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

  if (body.sellFirst != null) {
    if (!Array.isArray(body.sellFirst) || body.sellFirst.some((s) => !s.holdingId || !Number.isFinite(s.amount) || s.amount <= 0)) {
      return NextResponse.json({ error: "`sellFirst` must be an array of { holdingId, amount }" }, { status: 400 });
    }
    // Funding raises a DOLLAR AMOUNT, which is a partial sell by construction —
    // and a manually-valued asset has no share ledger to sell part of. Left
    // unchecked, `{ holdingId: "manual:home", amount: 40_000 }` reached
    // buildLotWrites(), which deleted the whole $800k home and credited its full
    // value to cash: total portfolio value unchanged, so nothing on screen moved.
    // The engine now refuses this, but it is refused HERE too, before the quote
    // fetch, so the caller gets a specific error instead of a purchase that
    // quietly went unfunded.
    const indivisible = body.sellFirst.filter((s) => isIndivisibleHolding(s.holdingId));
    if (indivisible.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot raise cash from ${indivisible.map((s) => s.holdingId.slice("manual:".length)).join(", ")}: manually-valued assets have no share ledger and cannot be partially sold. Fund this purchase from cash or from a market-priced holding.`,
        },
        { status: 400 },
      );
    }
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

  // A buy is "a change you execute", and the Trajectory panel promises a
  // snapshot either side of every one of those. This route used to write
  // neither (plain buy) or only the `pre` (funded buy, via executeTrades),
  // and lib/portfolio/history.ts DROPS an unpaired pre — so no purchase ever
  // produced a graded ChangeOutcome. Bookend the change like the other two
  // execute routes (optimize/execute, allocate-cash/execute) do.
  const preEvaluation = (await buildEvaluation()).evaluation;

  // Funding: raise cash by selling existing holdings BEFORE recording the buy —
  // the same atomic, self-cash-balancing batch executor the Optimize tab already
  // uses for rebalance trades, applied here to a Watchlist purchase's funding step.
  let fundingSnapshotId: string | null = null;
  if (body.sellFirst && body.sellFirst.length > 0) {
    const evaluation = preEvaluation;
    const trades: TradeToExecute[] = [];
    for (const s of body.sellFirst) {
      const holding = evaluation.holdings.find((h) => h.id === s.holdingId);
      if (!holding) {
        return NextResponse.json({ error: `Funding holding ${s.holdingId} not found` }, { status: 400 });
      }
      trades.push({
        holdingId: holding.id,
        symbol: holding.symbol,
        name: holding.name,
        assetClass: holding.assetClass,
        dollarDelta: -Math.min(s.amount, holding.valuation.valueBase),
        reason: s.reason ?? `Funding purchase of ${symbol}`,
      });
    }
    const result = executeTrades(evaluation, trades, body.objective ?? "maximize_sharpe");
    fundingSnapshotId = result.snapshotId;
  }

  const shares = quantity ?? amount! / quote.price;
  if (!Number.isFinite(shares) || shares <= 0) {
    return NextResponse.json({ error: "Computed share quantity was zero or invalid" }, { status: 400 });
  }

  // One classification authority, at booking time too — see risk-models.ts. Whatever
  // is booked here is superseded at read time by the same resolver once fund data
  // exists, so this cannot pin a wrong class into the ledger.
  const resolvedClass = assetClass ?? assetClassFromQuoteType(symbol, quote.name ?? symbol, quote.assetType);

  const name = body.name?.trim() || quote.name || symbol;

  const fees = body.fees != null && Number.isFinite(body.fees) && body.fees >= 0 ? body.fees : undefined;

  // The funded path's executeTrades() already wrote its own pre-execution
  // snapshot; writing a second here would create an unpairable extra row.
  if (!fundingSnapshotId) captureSnapshot(preEvaluation, "pre-execution", body.objective ?? null);

  try {
    addUniversalLot({
      symbol,
      name,
      shares,
      price: quote.price,
      kind: "buy",
      assetClass: resolvedClass,
      currency: quote.currency,
      fees,
      tradeDate: body.tradeDate,
      meta: { source: "watchlist_buy", ...body.meta },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record purchase";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // The post side of the bookend — this is what turns the purchase into a
  // graded ChangeOutcome ("did this change help?") on the Trajectory panel.
  // Best-effort: a failed post-evaluation must not report a recorded buy as
  // failed (the lot is already written), it only costs the outcome row.
  try {
    const after = (await buildEvaluation()).evaluation;
    captureSnapshot(after, "post-execution", body.objective ?? null);
  } catch {
    /* the buy itself succeeded; only the trajectory bookend is lost */
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
      fundingSnapshotId,
    },
    { status: 201 },
  );
}
