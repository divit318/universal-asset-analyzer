/**
 * POST /api/portfolio/allocate-cash — { amount: 50000 }
 *
 * Allocates new cash across the ENTIRE investable universe: existing holdings, every
 * candidate exposure (bonds, gold, international, TIPS, …), and cash itself.
 *
 * The engine this replaces could only route cash into positions the user already
 * owned. If your portfolio was 100% tech stocks, its advice on a $50k inflow was:
 * buy more tech stocks. "Add a Treasury ETF" and "hold it in cash" were not opinions
 * it disagreed with — they were sentences it could not form.
 */
import { NextResponse } from "next/server";
import { listRawHoldings } from "@/lib/portfolio/store";
import { buildMarketContext } from "@/lib/portfolio/context";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { evaluate } from "@/lib/portfolio/engines/simulate";
import { computeCashAllocation } from "@/lib/portfolio/engines/cash";
import { candidateSymbols } from "@/lib/portfolio/engines/candidates";
import { OBJECTIVES, DEFAULT_CONSTRAINTS, type Objective, type Constraints } from "@/lib/portfolio/engines/optimize";
import { runAllScenarios } from "@/lib/portfolio/engines/scenario";
import { buildCashWhyExplanation, heldCashSentence, rejectedOpportunitySentence, describeItemImpact, rejectionLabel } from "@/lib/portfolio/engines/cash-explain";
import type { PortfolioEvaluation } from "@/lib/portfolio/engines/simulate";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";

/**
 * A focused before/after diff of the risk metrics that actually drive a
 * capital-allocation decision. `evaluation.risk`/`plan.after.risk` already carry
 * every field — this just pairs the ones worth surfacing without asking the UI
 * to diff two full UniversalRisk objects itself.
 */
function riskComparisonOf(before: PortfolioEvaluation, after: PortfolioEvaluation) {
  const pick = (e: PortfolioEvaluation) => ({
    annualizedVolatility: e.risk.annualizedVolatility,
    sharpeRatio: e.risk.sharpeRatio,
    maxDrawdown: e.risk.maxDrawdown,
    var95Pct: e.risk.var95Pct,
    cvar95Pct: e.risk.cvar95Pct,
    hhi: e.allocation.byAssetClass.hhi,
    topHoldingWeight: e.risk.topHoldingWeight,
    topSectorWeight: e.risk.topSectorWeight,
    illiquidPct: e.risk.illiquidPct,
    avgCorrelation: e.risk.correlation?.avgCorrelation ?? null,
  });
  return { before: pick(before), after: pick(after) };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AllocateCashBody {
  amount?: number;
  objective?: Objective;
  customTarget?: Partial<Record<PortfolioAssetClass, number>>;
  constraints?: Partial<Constraints>;
}

export async function POST(request: Request) {
  let body: AllocateCashBody;
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

  // `constraints` is spread over DEFAULT_CONSTRAINTS below with no shape check —
  // an out-of-range or non-numeric value (e.g. maxHoldingPct: -10, or a NaN)
  // would silently degrade a cap into "always passes" deep inside optimize.ts.
  const PCT_FIELDS = ["maxHoldingPct", "maxAssetClassPct", "maxSectorPct", "maxCountryPct", "minCashPct", "maxIlliquidPct"] as const;
  if (body.constraints) {
    for (const field of PCT_FIELDS) {
      const v = body.constraints[field];
      if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100)) {
        return NextResponse.json({ error: `\`constraints.${field}\` must be a number between 0 and 100` }, { status: 400 });
      }
    }
    if (body.constraints.maxDuration !== undefined && body.constraints.maxDuration !== null
      && (typeof body.constraints.maxDuration !== "number" || !Number.isFinite(body.constraints.maxDuration) || body.constraints.maxDuration < 0)) {
      return NextResponse.json({ error: "`constraints.maxDuration` must be a non-negative number or null" }, { status: 400 });
    }
  }

  try {
    const raws = listRawHoldings();
    // This endpoint is the deliberate "explore everything" path — the user
    // explicitly asked to see what could be done with new cash, so unlike the
    // main report it fetches the full candidate universe, not just the ones a
    // detected gap already points at.
    const ctx = await buildMarketContext(raws, { candidateSymbols: candidateSymbols() });
    const { holdings } = normalizeHoldings(raws, ctx);
    const evaluation = evaluate(holdings, ctx);

    const constraints = body.constraints ? { ...DEFAULT_CONSTRAINTS, ...body.constraints } : DEFAULT_CONSTRAINTS;
    const plan = computeCashAllocation(
      evaluation,
      body.amount,
      objective,
      ctx,
      constraints,
      body.customTarget,
    );

    return NextResponse.json({
      ...plan,
      before: evaluation,
      items: plan.items.map((item) => ({
        ...item,
        impactSentence: describeItemImpact(item),
        alternatives: item.alternatives.map((alt) => ({ ...alt, reasonLabel: rejectionLabel(alt.reasonRejected) })),
      })),
      rejectedOpportunities: plan.rejectedOpportunities.map((r) => ({
        ...r,
        reasonLabel: rejectionLabel(r.reason),
        sentence: rejectedOpportunitySentence(r, objective),
      })),
      heldAsCashSentence: heldCashSentence(plan),
      why: buildCashWhyExplanation(plan),
      scenarios: {
        before: runAllScenarios(evaluation.holdings, evaluation.totalValue),
        after: runAllScenarios(plan.after.holdings, plan.after.totalValue),
      },
      riskComparison: riskComparisonOf(evaluation, plan.after),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cash allocation failed";
    console.error("[portfolio/allocate-cash]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
