/**
 * POST /api/portfolio/optimize/preview — Live Portfolio Preview (Feature 3).
 *
 * Body: { objective: Objective, trades: { holdingId: string; partialPct?: number }[] }
 *
 * Simulates a SELECTED SUBSET of the objective's rebalancing trades, at an
 * optional partial-implementation percentage per trade, WITHOUT writing
 * anything. Re-fetches live data on every call rather than trusting
 * client-cached weights, so the preview never drifts from what execution
 * would actually do.
 */
import { NextResponse } from "next/server";
import { buildEvaluation } from "@/lib/portfolio/report";
import { optimize, DEFAULT_CONSTRAINTS, OBJECTIVES, type Objective } from "@/lib/portfolio/engines/optimize";
import { previewTrades, type SelectedTarget } from "@/lib/portfolio/engines/transaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PreviewBody {
  objective?: string;
  trades?: { holdingId: string; partialPct?: number }[];
}

function annualIncomeOf(evaluation: { holdings: { income: { annual: number } | null }[] }): number {
  return evaluation.holdings.reduce((s, h) => s + (h.income?.annual ?? 0), 0);
}

export async function POST(request: Request) {
  let body: PreviewBody;
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
    const { evaluation, ctx } = await buildEvaluation({ objective });
    const optimization = optimize(evaluation, objective, DEFAULT_CONSTRAINTS, undefined, ctx);
    const byId = new Map(optimization.holdings.map((t) => [t.holdingId, t]));

    const selected: SelectedTarget[] = [];
    const skipped: string[] = [];
    // Realized gain/loss on the selection, for the Warnings Panel's tax flag —
    // grounded in each sold holding's real unrealizedPL, proportional to the
    // fraction actually sold. Never a tax dollar figure (no rate is modeled
    // anywhere in this app), just the taxable amount itself.
    let estimatedRealizedGainLoss = 0;
    const holdingsById = new Map(evaluation.holdings.map((h) => [h.id, h]));

    for (const r of requested) {
      const trade = byId.get(r.holdingId);
      if (!trade) {
        skipped.push(r.holdingId);
        continue;
      }
      const pct = Math.max(0, Math.min(100, r.partialPct ?? 100));
      const targetWeight = trade.currentWeight + (trade.targetWeight - trade.currentWeight) * (pct / 100);
      selected.push({ holdingId: trade.holdingId, targetWeight });

      if (trade.action === "SELL") {
        const holding = holdingsById.get(trade.holdingId);
        if (holding?.unrealizedPL != null && holding.valuation.valueBase > 0) {
          const soldAmount = Math.abs(trade.dollarDelta) * (pct / 100);
          const soldFraction = Math.min(1, soldAmount / holding.valuation.valueBase);
          estimatedRealizedGainLoss += holding.unrealizedPL * soldFraction;
        }
      }
    }

    if (selected.length === 0) {
      return NextResponse.json({ error: "None of the requested trades matched a live optimization trade" }, { status: 400 });
    }

    const result = previewTrades(evaluation, ctx, selected);

    return NextResponse.json({
      before: {
        totalValue: evaluation.totalValue,
        annualIncome: annualIncomeOf(evaluation),
        health: evaluation.health,
        risk: evaluation.risk,
        allocation: evaluation.allocation,
      },
      after: {
        totalValue: result.after.totalValue,
        annualIncome: annualIncomeOf(result.after),
        health: result.after.health,
        risk: result.after.risk,
        allocation: result.after.allocation,
      },
      impact: result.impact,
      decisions: result.decisions,
      skippedHoldingIds: skipped,
      estimatedRealizedGainLoss,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to preview trades";
    console.error("[portfolio/optimize/preview]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
