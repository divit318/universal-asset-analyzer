/**
 * POST /api/portfolio/manage — buy more, sell part, or fully exit ONE
 * existing holding, directly from the Holdings table.
 *
 * Reuses the exact Transaction Engine the Optimize tab's execute route uses
 * (lib/portfolio/engines/transaction.ts) — buildLotWrites' sell-cap,
 * cash-symbol synthesis, and manual-asset full-exit handling all apply here
 * unchanged. The only new logic is turning a manual buy/sell/sell-all
 * request into the dollarDelta the engine already understands, instead of
 * that delta coming from an optimizer-suggested target weight.
 */
import { NextResponse } from "next/server";
import { buildEvaluation } from "@/lib/portfolio/report";
import { executeTrades, summaryOf, type TradeToExecute } from "@/lib/portfolio/engines/transaction";
import type { Objective } from "@/lib/portfolio/engines/optimize";
import { formatCurrency } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// evaluate() itself does not vary by objective (only optimize()'s target
// weights do) — this is purely a label attached to the resulting snapshot
// and lot meta, so any valid Objective works here.
const OBJECTIVE: Objective = "maximize_sharpe";

interface ManageBody {
  holdingId?: string;
  action?: "buy" | "sell";
  amount?: number;
  quantity?: number;
  full?: boolean;
}

export async function POST(request: Request) {
  let body: ManageBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const holdingId = body.holdingId?.trim();
  if (!holdingId) return NextResponse.json({ error: "`holdingId` is required" }, { status: 400 });
  if (body.action !== "buy" && body.action !== "sell") {
    return NextResponse.json({ error: '`action` must be "buy" or "sell"' }, { status: 400 });
  }

  const { evaluation } = await buildEvaluation({});
  const holding = evaluation.holdings.find((h) => h.id === holdingId);
  if (!holding) {
    return NextResponse.json({ error: "Holding not found — it may have already been removed" }, { status: 404 });
  }

  // Manual-asset classes (real estate, private markets, alternatives,
  // structured products) have no lot ledger and no partial-quantity concept
  // — buildLotWrites treats ANY trade against one as a full exit regardless
  // of sign, so a "buy more" here would silently delete the asset instead.
  // Only an explicit, confirmed full sell is allowed.
  const isManual = holding.id.startsWith("manual:");
  if (isManual && !(body.action === "sell" && body.full)) {
    return NextResponse.json(
      {
        error:
          "This asset only supports full removal here — its value and details are edited in the Research Hub, not bought/sold in increments.",
      },
      { status: 400 },
    );
  }

  const price = holding.quantity > 0 ? holding.valuation.valueBase / holding.quantity : 0;
  if (!isManual && (!Number.isFinite(price) || price <= 0)) {
    return NextResponse.json({ error: "No valid price to trade at" }, { status: 400 });
  }

  let dollarDelta: number;

  if (body.action === "buy") {
    const hasAmount = body.amount != null;
    const hasQuantity = body.quantity != null;
    if (hasAmount === hasQuantity) {
      return NextResponse.json({ error: "Provide exactly one of `amount` or `quantity`" }, { status: 400 });
    }
    const amount = hasAmount ? Number(body.amount) : Number(body.quantity) * price;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Buy amount must be a positive number" }, { status: 400 });
    }
    dollarDelta = amount;
  } else if (body.full) {
    dollarDelta = -holding.valuation.valueBase;
  } else {
    const hasAmount = body.amount != null;
    const hasQuantity = body.quantity != null;
    if (hasAmount === hasQuantity) {
      return NextResponse.json({ error: "Provide exactly one of `amount` or `quantity`" }, { status: 400 });
    }
    const amount = hasAmount ? Number(body.amount) : Number(body.quantity) * price;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Sell amount must be a positive number" }, { status: 400 });
    }
    // Small tolerance for price-drift/float dust — otherwise typing the exact
    // dollar value of "everything I have" can bounce off this check.
    if (amount > holding.valuation.valueBase * 1.0001) {
      return NextResponse.json(
        {
          error: `You only hold ${holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${holding.unit} (${formatCurrency(holding.valuation.valueBase)}) — reduce the amount or use Sell All`,
        },
        { status: 400 },
      );
    }
    dollarDelta = -amount;
  }

  const trade: TradeToExecute = {
    holdingId: holding.id,
    symbol: holding.symbol,
    name: holding.name,
    assetClass: holding.assetClass,
    dollarDelta,
    reason: "Manual position management",
  };

  try {
    const before = summaryOf(evaluation);
    const result = executeTrades(evaluation, [trade], OBJECTIVE);
    if (result.skipped.length > 0) {
      return NextResponse.json({ error: result.skipped[0].reason }, { status: 400 });
    }

    // Re-evaluate fresh AFTER the write so the response reflects what was
    // actually written, not the pre-write simulation.
    const after = await buildEvaluation({});
    const remaining = after.evaluation.holdings.find((h) => h.id === holdingId) ?? null;

    return NextResponse.json({
      ok: true,
      action: body.action,
      dollarDelta,
      snapshotId: result.snapshotId,
      removed: remaining == null,
      remainingQuantity: remaining?.quantity ?? 0,
      remainingValue: remaining?.valuation.valueBase ?? 0,
      before,
      after: summaryOf(after.evaluation),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to execute transaction";
    console.error("[portfolio/manage]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
