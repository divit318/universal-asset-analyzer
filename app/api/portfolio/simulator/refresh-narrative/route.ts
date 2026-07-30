/**
 * POST /api/portfolio/simulator/refresh-narrative — { id, symbols }
 *
 * Re-narrates a simulation after an edit so the stated reasoning never
 * contradicts the actual holdings: fresh one-line rationales for the changed
 * symbols (one AI call), a thesis rebuild (content-hash cached — free when
 * the composition didn't materially change), and a headline resync.
 *
 * Fired by the client after every confirmed edit, deliberately non-blocking:
 * the edit itself is already persisted, and a failed narration leaves
 * accurate holdings with yesterday's prose — annoying, not wrong.
 */
import { NextResponse } from "next/server";
import { runPromptWithMeta } from "@/lib/ai";
import { AllModelsFailedError } from "@/lib/ai/router";
import { getSimulation, updateSimulation } from "@/lib/db";
import { buildPortfolioThesis } from "@/lib/portfolio/thesis";
import {
  buildRationalePrompt,
  parseRationaleResponse,
} from "@/lib/portfolio/simulator/edit";
import { evaluateSimHoldings, headlineFrom } from "@/lib/portfolio/simulator/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { id?: string; symbols?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sim = typeof body.id === "string" ? getSimulation(body.id) : null;
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const symbols = (Array.isArray(body.symbols) ? body.symbols : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.toUpperCase())
    .filter((s) => sim.holdings.some((h) => h.symbol === s));

  try {
    // 1. Fresh rationales for the changed holdings (skipped when none named).
    let holdings = sim.holdings;
    if (symbols.length > 0) {
      const { text } = await runPromptWithMeta(
        "portfolio-construction",
        buildRationalePrompt(sim.profile, sim.holdings, symbols),
        { json: true, timeoutMs: 300_000, signal: request.signal },
      );
      const rationales = parseRationaleResponse(text, symbols);
      holdings = sim.holdings.map((h) =>
        h.symbol && rationales[h.symbol] ? { ...h, rationale: rationales[h.symbol] } : h,
      );
    }

    // 2. Thesis + headline against the edited book. The thesis builder is
    // content-hash cached and falls back deterministically when Ollama is
    // down — it never throws the whole resync away.
    const evaluation = await evaluateSimHoldings(holdings, sim.profile.currency);
    const thesis = await buildPortfolioThesis({
      holdings: evaluation.holdings,
      totalValue: evaluation.totalValue,
      allocation: evaluation.allocation,
      risk: evaluation.risk,
      health: evaluation.health,
    });

    const updated = updateSimulation(sim.id, {
      holdings,
      thesis: {
        summary: thesis.thesis,
        tags: thesis.identity,
        generatedAt: thesis.generatedAt,
        source: thesis.source,
      },
      headline: headlineFrom(evaluation),
    });
    return NextResponse.json({ simulation: updated, evaluation });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof AllModelsFailedError) {
      return NextResponse.json(
        { error: "Ollama unavailable — rationales will refresh once it is back", code: "ollama_unavailable" },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "Narrative refresh failed";
    console.error("[portfolio/simulator/refresh-narrative]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
