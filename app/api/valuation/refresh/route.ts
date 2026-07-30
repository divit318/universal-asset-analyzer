import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import { appendValuationEvent, getValuationCase } from "@/lib/db";
import {
  applyAiProposals,
  computeCaseResult,
  type AssumptionKey,
  type ValuationCase,
} from "@/lib/valuation/case";
import { refineAssumptions, type AssumptionRefinement } from "@/lib/valuation/ai";
import { fetchValuationFacts } from "@/lib/valuation/prefill";
import { getEnginePriorEnsured } from "@/lib/valuation/engine-prior";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface RefreshResponse {
  case: ValuationCase;
  /** What AI said about the case as a whole. */
  assessment: string;
  /** Assumptions AI judged least supported. */
  weakest: AssumptionKey[];
  /** Keys AI wanted to change but could not, because the user owns them. */
  respected: AssumptionKey[];
  /** How many unclaimed assumptions it actually moved. */
  applied: AssumptionKey[];
}

/**
 * POST /api/valuation/refresh — ask AI to refine the case.
 *
 * The response is always a case: if the model is unavailable or returns nothing
 * usable, the existing case comes back untouched and no version is appended.
 * Silence from AI is a valid outcome and means agreement, so it should not
 * manufacture a version in the audit trail.
 */
export async function POST(request: Request) {
  let body: { symbol?: string };
  try {
    body = (await request.json()) as { symbol?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  const existing = getValuationCase(symbol);
  if (!existing) {
    return NextResponse.json(
      { error: "No valuation case for this symbol yet — open it once to seed it" },
      { status: 409 },
    );
  }

  // Live price and facts give the model something to reason against. Non-fatal:
  // a refresh against the stored price is still worth having.
  let price = existing.priceAt;
  let deliveredGrowth: number | null = null;
  let deliveredWindow = "trailing growth";
  let companyName = symbol;
  try {
    const facts = await fetchValuationFacts(symbol);
    price = facts.price ?? existing.priceAt;
    deliveredGrowth = facts.deliveredGrowth.value;
    deliveredWindow = facts.deliveredGrowth.label;
    companyName = facts.name;
  } catch {
    /* non-fatal */
  }

  const live = computeCaseResult(existing.assumptions, price);

  // The systematic prior, when the engine has scored this name. Giving it to the
  // model lets its critique cite an independent estimate rather than only the
  // case's own internals. Non-fatal and cached — see lib/valuation/engine-prior.ts.
  const prior = await getEnginePriorEnsured(symbol).catch(() => null);

  let refinement: AssumptionRefinement;
  try {
    refinement = await refineAssumptions({
      symbol,
      companyName,
      currency: existing.currency,
      assumptions: existing.assumptions,
      price,
      impliedGrowth: live.impliedGrowth,
      deliveredGrowth,
      deliveredWindow,
      enginePrior: prior
        ? { p10: prior.p10, p50: prior.p50, p90: prior.p90, wacc: prior.wacc }
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI refinement failed" },
      { status: 502 },
    );
  }

  const { assumptions, respected } = applyAiProposals(existing.assumptions, refinement.proposals);

  // Critiques for user-owned assumptions ride on the assumption itself, so the
  // workspace shows the objection beside the value it objects to.
  for (const { key, critique } of refinement.critiques) {
    if (assumptions[key].locked) assumptions[key] = { ...assumptions[key], critique };
  }

  const applied = refinement.proposals
    .map((p) => p.key)
    .filter((key) => !respected.includes(key));

  const changed = applied.length > 0 || refinement.critiques.length > 0;
  if (!changed) {
    return NextResponse.json({
      case: { ...existing, result: live },
      assessment: refinement.assessment,
      weakest: refinement.weakest,
      respected,
      applied: [],
    } satisfies RefreshResponse);
  }

  const saved = appendValuationEvent({
    symbol,
    currency: existing.currency,
    author: "ai",
    kind: "ai_refresh",
    assumptions,
    result: computeCaseResult(assumptions, price),
    priceAt: price,
    triggerSource: "valuation_workspace",
    note: refinement.assessment || null,
  });

  return NextResponse.json({
    case: saved,
    assessment: refinement.assessment,
    weakest: refinement.weakest,
    respected,
    applied,
  } satisfies RefreshResponse);
}
