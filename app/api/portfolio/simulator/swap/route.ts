/**
 * POST /api/portfolio/simulator/swap — { id, symbol }
 *
 * AI-suggested alternatives for one holding, each with a measured
 * before/after impact preview (alignment, volatility, income) computed by
 * actually applying the swap and re-running the real engines against ONE
 * shared market snapshot — the Decisions tab's "expected portfolio state"
 * pattern, not a guess. Nothing is persisted here; the client confirms a
 * suggestion by PATCHing the holdings it previews.
 */
import { NextResponse } from "next/server";
import { AI_RECOVERY_HINT } from "@/lib/ai/availability";
import { runPromptWithMeta } from "@/lib/ai";
import { AllModelsFailedError } from "@/lib/ai/router";
import { getSimulation } from "@/lib/db";
import { buildMarketContext } from "@/lib/portfolio/context";
import {
  applySwap,
  buildSwapPrompt,
  parseSwapResponse,
} from "@/lib/portfolio/simulator/edit";
import { evaluateSimHoldings, simHoldingsToRaw } from "@/lib/portfolio/simulator/evaluate";
import { CURATED_UNIVERSE } from "@/lib/portfolio/simulator/universe";
import type { SimHolding } from "@/lib/portfolio/simulator/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SwapImpact {
  /** Alignment scores are null when the book is unscorable; the UI hides the row. */
  alignmentBefore: number | null;
  alignmentAfter: number | null;
  volatilityBefore: number | null;
  volatilityAfter: number | null;
  incomeBefore: number;
  incomeAfter: number;
}

export async function POST(request: Request) {
  let body: { id?: string; symbol?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sim = typeof body.id === "string" ? getSimulation(body.id) : null;
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const outSymbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  const out = sim.holdings.find((h) => h.symbol === outSymbol);
  if (!out) return NextResponse.json({ error: `No holding ${outSymbol} in this simulation` }, { status: 404 });
  if (out.assetClass === "cash") {
    return NextResponse.json({ error: "The cash sleeve has no alternatives" }, { status: 400 });
  }

  // 1. AI suggests — curated same-class candidates as the menu.
  const menuList = out.assetClass in CURATED_UNIVERSE
    ? CURATED_UNIVERSE[out.assetClass as keyof typeof CURATED_UNIVERSE]
    : [];
  const menu = menuList.map((c) => `  ${c.symbol} — ${c.name} (${c.role})`).join("\n") || "  (no curated menu for this class — suggest liquid instruments you are certain exist)";

  let suggestions;
  try {
    const { text } = await runPromptWithMeta(
      "portfolio-construction",
      buildSwapPrompt(sim.profile, sim.holdings, outSymbol, menu),
      { json: true, timeoutMs: 300_000, signal: request.signal },
    );
    suggestions = parseSwapResponse(text, sim.holdings, outSymbol);
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof AllModelsFailedError) {
      return NextResponse.json(
        { error: `AI unavailable — ${AI_RECOVERY_HINT}`, code: "ai_unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Swap suggestion failed" }, { status: 502 });
  }
  if (suggestions.length === 0) {
    return NextResponse.json({ error: "The AI produced no usable alternatives. Try again." }, { status: 502 });
  }

  // 2. Measure the impact of each — one market snapshot for everything.
  try {
    const ctx = await buildMarketContext(simHoldingsToRaw(sim.holdings), {
      baseCurrency: sim.profile.currency,
      candidateSymbols: suggestions.map((s) => s.symbol),
    });
    const before = await evaluateSimHoldings(sim.holdings, sim.profile.currency, ctx);
    const priceBase = (sym: string): number | null => {
      const q = ctx.quotes.get(sym);
      if (!q) return null;
      const cur = q.currency ?? "USD";
      return q.price * (cur === sim.profile.currency ? 1 : (ctx.fx[cur] ?? 1));
    };
    const outPrice = priceBase(outSymbol);
    if (outPrice === null) {
      return NextResponse.json({ error: `No live price for ${outSymbol} right now` }, { status: 502 });
    }

    const alternatives = [];
    for (const s of suggestions) {
      const inPrice = priceBase(s.symbol);
      if (inPrice === null) continue; // invented ticker dies here
      let nextHoldings: SimHolding[];
      try {
        ({ holdings: nextHoldings } = applySwap(
          sim.holdings,
          outSymbol,
          s,
          outPrice,
          inPrice,
          ctx.quotes.get(s.symbol)?.currency ?? "USD",
          sim.profile.currency,
        ));
      } catch {
        continue; // e.g. replacement price exceeds the position value
      }
      const after = await evaluateSimHoldings(nextHoldings, sim.profile.currency, ctx);
      alternatives.push({
        ...s,
        name: ctx.quotes.get(s.symbol)?.name ?? s.name,
        holdings: nextHoldings,
        impact: {
          alignmentBefore: before.alignment.score,
          alignmentAfter: after.alignment.score,
          volatilityBefore: before.risk.annualizedVolatility,
          volatilityAfter: after.risk.annualizedVolatility,
          incomeBefore: before.annualIncome,
          incomeAfter: after.annualIncome,
        } satisfies SwapImpact,
      });
    }
    if (alternatives.length === 0) {
      return NextResponse.json({ error: "No suggested alternative has a live price. Try again." }, { status: 502 });
    }
    return NextResponse.json({ outSymbol, alternatives });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Impact preview failed";
    console.error("[portfolio/simulator/swap]", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
