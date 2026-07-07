import { NextResponse } from "next/server";
import {
  listDecisions,
  createDecision,
  closeDecision,
  deleteDecision,
  getDecision,
  type CreateDecisionInput,
} from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { computeTrackRecord, evaluateDecision } from "@/lib/decision-journal";
import { isValidSymbol } from "@/lib/market";
import type { DecisionAction } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: DecisionAction[] = ["buy", "sell", "hold", "avoid", "watch"];

/** GET /api/decisions — decisions + live-marked outcomes + track record. */
export async function GET() {
  const decisions = listDecisions();
  if (decisions.length === 0) {
    return NextResponse.json({ decisions: [], outcomes: {}, trackRecord: null });
  }

  // Live prices only for open decisions (closed ones use their recorded close).
  const openSymbols = [...new Set(decisions.filter((d) => d.status === "open").map((d) => d.symbol))];
  const quotes = openSymbols.length ? await getQuotes(openSymbols) : [];
  const priceBySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.price]));

  const outcomes = Object.fromEntries(
    decisions.map((d) => [d.id, evaluateDecision(d, priceBySymbol.get(d.symbol.toUpperCase()) ?? null)]),
  );
  const trackRecord = computeTrackRecord(decisions, priceBySymbol);

  return NextResponse.json({ decisions, outcomes, trackRecord });
}

/** POST /api/decisions — log a new decision. */
export async function POST(request: Request) {
  let body: CreateDecisionInput;
  try {
    body = (await request.json()) as CreateDecisionInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }
  if (!ACTIONS.includes(body.action)) {
    return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  }
  if (!(body.conviction >= 1 && body.conviction <= 5)) {
    return NextResponse.json({ error: "conviction must be 1–5" }, { status: 400 });
  }

  const decision = createDecision({ ...body, symbol });
  return NextResponse.json(decision, { status: 201 });
}

/** PATCH /api/decisions — close a decision: { id, closePrice? }. */
export async function PATCH(request: Request) {
  let body: { id?: number; closePrice?: number | null };
  try {
    body = (await request.json()) as { id?: number; closePrice?: number | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id !== "number" || !getDecision(body.id)) {
    return NextResponse.json({ error: "A valid decision `id` is required" }, { status: 404 });
  }
  closeDecision(body.id, body.closePrice ?? null);
  return NextResponse.json(getDecision(body.id));
}

/** DELETE /api/decisions?id=123 */
export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || !getDecision(id)) {
    return NextResponse.json({ error: "A valid decision `id` is required" }, { status: 404 });
  }
  deleteDecision(id);
  return NextResponse.json({ ok: true });
}
