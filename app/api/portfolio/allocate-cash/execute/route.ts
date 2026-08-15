/**
 * POST /api/portfolio/allocate-cash/execute
 *
 * Body: { amount, objective, customTarget?, constraints?, selected?: string[] }
 *
 * Deposits the new cash as a real ledger lot, then buys the (optionally
 * filtered, by symbol) plan items against it — reusing addUniversalLot(), the
 * exact same additive write primitive app/api/portfolio/buy/route.ts already
 * uses for a one-off purchase. Cash allocation is always additive-only (never
 * a sell), and it can open brand-new positions the ledger has never held before
 * — the rebalance-oriented Transaction Engine (buildLotWrites/executeTrades)
 * assumes every trade targets an EXISTING holding, so it doesn't fit here.
 *
 * Whatever isn't bought below (de-selected items, or the plan's own "hold as
 * cash") simply remains sitting in the deposited cash lot — that IS "held as
 * cash", with no separate bookkeeping required. Snapshotted before and after,
 * so this is always undoable via POST /api/portfolio/optimize/undo.
 */
import { NextResponse } from "next/server";
import { listRawHoldings } from "@/lib/portfolio/store";
import { buildMarketContext } from "@/lib/portfolio/context";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { loadInvestorPolicy } from "@/lib/portfolio/alignment/store";
import { computeCashAllocation } from "@/lib/portfolio/engines/cash";
import { candidateSymbols } from "@/lib/portfolio/engines/candidates";
import { OBJECTIVES, constraintsFromPolicy, type Objective, type Constraints } from "@/lib/portfolio/engines/optimize";
import { buildCashDepositLots, executeTradeBatch, captureSnapshot, summaryOf } from "@/lib/portfolio/engines/transaction";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecuteBody {
  amount?: number;
  objective?: Objective;
  customTarget?: Partial<Record<PortfolioAssetClass, number>>;
  constraints?: Partial<Constraints>;
  /** Symbols to actually buy from the plan; omit to execute every recommended item. */
  selected?: string[];
}

export async function POST(request: Request) {
  let body: ExecuteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount <= 0) {
    return NextResponse.json({ error: "`amount` must be a positive number" }, { status: 400 });
  }

  const objective = body.objective ?? "maximize_sharpe";
  if (!(objective in OBJECTIVES)) {
    return NextResponse.json(
      { error: `\`objective\` must be one of: ${Object.keys(OBJECTIVES).join(", ")}` },
      { status: 400 },
    );
  }
  if (objective === "target_allocation" && !body.customTarget) {
    return NextResponse.json({ error: "`customTarget` is required for the target_allocation objective" }, { status: 400 });
  }

  try {
    const raws = listRawHoldings();
    const ctx = await buildMarketContext(raws, { candidateSymbols: candidateSymbols() });
    const { holdings } = normalizeHoldings(raws, ctx);
    // Same policy on the execute leg as on the preview leg (the sibling
    // allocate-cash route) — a plan previewed under the investor's policy must
    // not be re-planned under universal defaults at the moment of execution.
    const policy = loadInvestorPolicy();
    const before = evaluate(holdings, ctx, policy);

    const policyConstraints = constraintsFromPolicy(policy);
    const constraints = body.constraints ? { ...policyConstraints, ...body.constraints } : policyConstraints;
    const plan = computeCashAllocation(before, body.amount, objective, ctx, constraints, body.customTarget);

    const selectedSet = body.selected ? new Set(body.selected.map((s) => s.toUpperCase())) : null;
    const toBuy = selectedSet ? plan.items.filter((i) => i.symbol && selectedSet.has(i.symbol.toUpperCase())) : plan.items;

    const snapshotId = captureSnapshot(before, "pre-execution", objective);

    // Pure decision logic (price resolution, skip reasons) lives in
    // buildCashDepositLots(); the write below is the only I/O, and it's atomic —
    // the deposit and every buy land together or not at all.
    const { lots, skipped } = buildCashDepositLots(
      ctx,
      body.amount,
      toBuy.map((item) => ({ symbol: item.symbol, name: item.name, assetClass: item.assetClass, dollarAmount: item.dollarAmount, reason: item.reason })),
    );
    executeTradeBatch(lots, []);
    // The deposit lot itself is bookkeeping, not one of the user's selected buys.
    const executedCount = lots.length - 1;

    // Re-evaluate fresh AFTER the writes — the "after" summary and post-execution
    // snapshot reflect what was actually written, never the pre-write simulation.
    const afterRaws = listRawHoldings();
    const afterCtx = await buildMarketContext(afterRaws, { candidateSymbols: candidateSymbols() });
    const { holdings: afterHoldings } = normalizeHoldings(afterRaws, afterCtx);
    const after = evaluate(afterHoldings, afterCtx);
    const postSnapshotId = captureSnapshot(after, "post-execution", objective);

    return NextResponse.json({
      snapshotId,
      postSnapshotId,
      executedCount,
      skipped,
      before: summaryOf(before),
      after: summaryOf(after),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to execute cash allocation";
    console.error("[portfolio/allocate-cash/execute]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
