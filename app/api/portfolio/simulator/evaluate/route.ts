/**
 * POST /api/portfolio/simulator/evaluate — full analytics for a hypothetical
 * holdings list, through the exact engines the real Portfolio page uses.
 *
 * Body: { id } to evaluate a saved simulation (refreshes its denormalized
 * headline), or { holdings, currency } for an ad-hoc list (live recalc while
 * editing, before anything is saved).
 */
import { NextResponse } from "next/server";
import { getSimulation, updateSimulation } from "@/lib/db";
import { parseSimHoldings } from "@/lib/portfolio/simulator/profile";
import { evaluateSimHoldings, headlineFrom } from "@/lib/portfolio/simulator/evaluate";
import type { SimHolding } from "@/lib/portfolio/simulator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CURRENCY_RE = /^[A-Z]{3}$/;

export async function POST(request: Request) {
  let body: { id?: string; holdings?: unknown; currency?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  let holdings: SimHolding[];
  let currency: string;
  let simId: string | null = null;

  if (typeof body.id === "string") {
    const sim = getSimulation(body.id);
    if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
    if (sim.holdings.length === 0) {
      return NextResponse.json({ error: "This simulation has no holdings yet — generate it first" }, { status: 400 });
    }
    holdings = sim.holdings;
    currency = sim.profile.currency;
    simId = sim.id;
  } else {
    const parsed = parseSimHoldings(body.holdings);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    if (parsed.holdings.length === 0) {
      return NextResponse.json({ error: "holdings must not be empty" }, { status: 400 });
    }
    holdings = parsed.holdings;
    currency = typeof body.currency === "string" && CURRENCY_RE.test(body.currency) ? body.currency : "USD";
  }

  try {
    const evaluation = await evaluateSimHoldings(holdings, currency);
    // Keep the list view's numbers honest: every evaluation of a saved
    // simulation refreshes its headline.
    if (simId) updateSimulation(simId, { headline: headlineFrom(evaluation) });
    return NextResponse.json({ evaluation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Evaluation failed";
    console.error("[portfolio/simulator/evaluate]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
