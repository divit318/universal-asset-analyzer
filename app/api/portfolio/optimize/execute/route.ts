/**
 * POST /api/portfolio/optimize/execute — Implement Selected Trades (Features 4-7, 10).
 *
 * Body: { objective: Objective, trades: { holdingId: string; partialPct?: number }[] }
 *
 * Never mutates without a snapshot first: `executeTrades()` snapshots the
 * CURRENT raw ledger state before writing anything, so this action is always
 * undoable via POST /api/portfolio/optimize/undo with the returned snapshotId.
 * Re-fetches live data rather than trusting client-cached weights, so what
 * gets executed matches what a same-moment preview would have shown.
 */
import { NextResponse } from "next/server";
import { buildEvaluation } from "@/lib/portfolio/report";
import { optimize, DEFAULT_CONSTRAINTS, OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";
import { executeTrades, captureSnapshot, type TradeToExecute } from "@/lib/portfolio/engines/transaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecuteBody {
  objective?: string;
  trades?: { holdingId: string; partialPct?: number }[];
}

function summaryOf(evaluation: { totalValue: number; health: { total: number; grade: string }; risk: { annualizedVolatility: number | null } }) {
  return { totalValue: evaluation.totalValue, health: evaluation.health.total, healthGrade: evaluation.health.grade, volatility: evaluation.risk.annualizedVolatility };
}

export async function POST(request: Request) {
  let body: ExecuteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const objective = (body.objective && body.objective in OBJECTIVES ? body.objective : "maximize_sharpe") as Objective;
  const requested = body.trades ?? [];
  if (requested.length === 0) {
    return NextResponse.json({ error: "`trades` must be a non-empty array" }, { status: 400 });
  }

  try {
    const before = await buildEvaluation({ objective });
    const optimization = optimize(before.evaluation, objective, DEFAULT_CONSTRAINTS, undefined, before.ctx);
    const byId = new Map(optimization.holdings.map((t) => [t.holdingId, t]));

    const toExecute: TradeToExecute[] = [];
    const notFound: string[] = [];
    for (const r of requested) {
      const trade = byId.get(r.holdingId);
      if (!trade) {
        notFound.push(r.holdingId);
        continue;
      }
      const pct = Math.max(0, Math.min(100, r.partialPct ?? 100));
      toExecute.push({
        holdingId: trade.holdingId,
        symbol: trade.symbol,
        name: trade.name,
        assetClass: trade.assetClass,
        dollarDelta: trade.dollarDelta * (pct / 100),
        reason: trade.reason,
      });
    }

    if (toExecute.length === 0) {
      return NextResponse.json({ error: "None of the requested trades matched a live optimization trade" }, { status: 400 });
    }

    const result = executeTrades(before.evaluation, toExecute, objective, before.ctx.baseCurrency);

    // Re-evaluate fresh AFTER the write so the "after" summary and the
    // post-execution snapshot reflect what was actually written, not the
    // pre-write simulation.
    const after = await buildEvaluation({ objective });
    const postSnapshotId = captureSnapshot(after.evaluation, "post-execution", objective);

    return NextResponse.json({
      snapshotId: result.snapshotId,
      postSnapshotId,
      executedCount: result.executedCount,
      skipped: [...notFound.map((holdingId) => ({ holdingId, reason: "No matching live trade" })), ...result.skipped],
      before: summaryOf(before.evaluation),
      after: summaryOf(after.evaluation),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to execute trades";
    console.error("[portfolio/optimize/execute]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
