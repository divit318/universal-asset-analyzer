import { NextResponse } from "next/server";
import { normalizeSymbol } from "@/lib/market";
import {
  appendValuationEvent,
  getValuationCase,
  listValuationEvents,
} from "@/lib/db";
import {
  applyUserEdits,
  computeCaseResult,
  isAssumptionKey,
  seedAssumptions,
  type AssumptionEdit,
  type ValuationCase,
} from "@/lib/valuation/case";
import { canValue, fetchValuationFacts, type ValuationFacts } from "@/lib/valuation/prefill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The valuation case for a symbol.
 *
 * A case is seeded on first read rather than on an explicit "create" action, so
 * every symbol has one from first sight and the reverse DCF — the most useful
 * thing here, and the only part that needs no opinion — is never gated behind a
 * setup step.
 */
export interface ValuationCaseResponse {
  case: ValuationCase | null;
  /** Live facts, for field hints and to show what the case was seeded from. */
  facts: ValuationFacts;
  /** Present when no model can be built at all. */
  unvaluable: string | null;
}

function seedFor(facts: ValuationFacts): ValuationCase {
  const assumptions = seedAssumptions({
    baseFcf: facts.baseFcf!,
    sharesOutstanding: facts.sharesOutstanding!,
    netDebt: facts.netDebt ?? 0,
    price: facts.price,
    discountRate: facts.wacc.waccPercent,
    terminalGrowth: facts.terminalGrowth,
    deliveredGrowth: facts.deliveredGrowth.value,
    deliveredGrowthLabel: facts.deliveredGrowth.label,
  });
  return appendValuationEvent({
    symbol: facts.symbol,
    currency: facts.currency,
    author: "reverse",
    kind: "seeded",
    assumptions,
    result: computeCaseResult(assumptions, facts.price),
    priceAt: facts.price,
    triggerSource: "first_read",
  });
}

/**
 * GET /api/valuation?symbol=AAPL          → the case (seeding it if absent)
 * GET /api/valuation?symbol=AAPL&history=1 → its version history
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  if (url.searchParams.get("history")) {
    return NextResponse.json({ events: listValuationEvents(symbol) });
  }

  let facts: ValuationFacts;
  try {
    facts = await fetchValuationFacts(symbol);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lookup failed" },
      { status: 404 },
    );
  }

  const existing = getValuationCase(symbol);
  if (existing) {
    // The stored result was computed against the price at write time. Recompute
    // margin of safety against the live price so the case is never read stale,
    // without writing a new version just because the market moved.
    const live = computeCaseResult(existing.assumptions, facts.price);
    const payload: ValuationCaseResponse = {
      case: { ...existing, result: live },
      facts,
      unvaluable: null,
    };
    return NextResponse.json(payload);
  }

  if (!canValue(facts)) {
    const payload: ValuationCaseResponse = {
      case: null,
      facts,
      unvaluable:
        "No positive trailing free cash flow or share count is available, so a cash-flow model cannot be built for this symbol.",
    };
    return NextResponse.json(payload);
  }

  return NextResponse.json({ case: seedFor(facts), facts, unvaluable: null } satisfies ValuationCaseResponse);
}

interface EditRequest {
  symbol?: string;
  edits?: unknown;
  note?: string | null;
}

/**
 * POST /api/valuation — apply the user's assumption edits, appending a version.
 *
 * Every edit is authored and locked to the user, which is what stops a later AI
 * refresh from quietly overwriting their judgment.
 */
export async function POST(request: Request) {
  let body: EditRequest;
  try {
    body = (await request.json()) as EditRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const symbol = normalizeSymbol(body.symbol);
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  if (!Array.isArray(body.edits) || body.edits.length === 0) {
    return NextResponse.json({ error: "`edits` must be a non-empty array" }, { status: 400 });
  }

  const edits: AssumptionEdit[] = [];
  for (const raw of body.edits) {
    if (raw == null || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (!isAssumptionKey(e.key)) {
      return NextResponse.json({ error: `Unknown assumption: ${String(e.key)}` }, { status: 400 });
    }
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) {
      return NextResponse.json({ error: `\`${e.key}\` must be a finite number` }, { status: 400 });
    }
    edits.push({
      key: e.key,
      value: e.value,
      rationale: typeof e.rationale === "string" ? e.rationale : undefined,
    });
  }
  if (edits.length === 0) {
    return NextResponse.json({ error: "No usable edits" }, { status: 400 });
  }

  const existing = getValuationCase(symbol);
  if (!existing) {
    return NextResponse.json(
      { error: "No valuation case for this symbol yet — read it once to seed it" },
      { status: 409 },
    );
  }

  // Price the edited case against the live market, falling back to the price the
  // case was last written at if the quote is unavailable.
  let price = existing.priceAt;
  let currency = existing.currency;
  try {
    const facts = await fetchValuationFacts(symbol);
    price = facts.price ?? existing.priceAt;
    currency = facts.currency;
  } catch {
    /* non-fatal: a stale price is better than refusing the user's edit */
  }

  const assumptions = applyUserEdits(existing.assumptions, edits);
  const saved = appendValuationEvent({
    symbol,
    currency,
    author: "user",
    kind: "assumption_changed",
    assumptions,
    result: computeCaseResult(assumptions, price),
    priceAt: price,
    note: typeof body.note === "string" ? body.note : null,
  });

  return NextResponse.json({ case: saved });
}
