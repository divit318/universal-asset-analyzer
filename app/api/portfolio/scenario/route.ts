/**
 * Portfolio stress testing.
 *
 *   GET  — the scenario library.
 *   POST — run one: { id: "gfc_2008" } or { shocks: { rates: 2, equityBeta: -30 } }
 *
 * Two things changed from the route this replaces:
 *
 *  1. SHOCKS ARE IN FACTOR SPACE, NOT SECTOR SPACE. The old body was
 *     { sector: "Technology", shockPct: -30 } — which could not express a rate move,
 *     an inflation surprise, or a dollar move, and marked every asset without a GICS
 *     sector (all bonds, all commodities, all crypto, cash, real estate) down a flat
 *     20% by default. Each asset class now declares its factor sensitivities and
 *     responds accordingly.
 *
 *  2. IT NO LONGER HTTP-FETCHES ITSELF. The old handler called
 *     `fetch("http://localhost:3000/api/portfolio/report")` to get its own data —
 *     a real network round-trip through the app's own server, with a hardcoded host.
 *     It now calls the engine directly.
 */
import { NextResponse } from "next/server";
import { listRawHoldings } from "@/lib/portfolio/store";
import { buildMarketContext } from "@/lib/portfolio/context";
import { normalizeHoldings } from "@/lib/portfolio/model/holding";
import { getScenario, runScenario, runCustomScenario, SCENARIOS } from "@/lib/portfolio/engines/scenario";
import { FACTORS, FACTOR_LABEL, FACTOR_SHOCK_UNIT, type Factor } from "@/lib/portfolio/model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    scenarios: SCENARIOS.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
    })),
    factors: FACTORS.map((f) => ({
      id: f,
      label: FACTOR_LABEL[f],
      unit: FACTOR_SHOCK_UNIT[f],
    })),
  });
}

export async function POST(request: Request) {
  let body: { id?: string; shocks?: Record<string, number>; name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const raws = listRawHoldings();
    if (raws.length === 0) {
      return NextResponse.json({ error: "No portfolio data available" }, { status: 404 });
    }

    const ctx = await buildMarketContext(raws);
    const { holdings, totalValue } = normalizeHoldings(raws, ctx);

    if (body.id) {
      const def = getScenario(body.id);
      if (!def) {
        return NextResponse.json({ error: `Unknown scenario "${body.id}"` }, { status: 400 });
      }
      return NextResponse.json({ scenario: runScenario(def, holdings, totalValue) });
    }

    if (body.shocks) {
      const shocks: Partial<Record<Factor, number>> = {};
      for (const [k, v] of Object.entries(body.shocks)) {
        // Reject an unknown factor rather than ignoring it. A typo'd name that
        // silently does nothing produces a stress test that appears to have run and
        // didn't — worse than an error.
        if (!FACTORS.includes(k as Factor)) {
          return NextResponse.json(
            { error: `Unknown factor "${k}". Valid: ${FACTORS.join(", ")}` },
            { status: 400 },
          );
        }
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return NextResponse.json({ error: `Shock for "${k}" must be a finite number` }, { status: 400 });
        }
        shocks[k as Factor] = v;
      }

      return NextResponse.json({
        scenario: runCustomScenario(shocks, holdings, totalValue, body.name?.trim() || "Custom Scenario"),
      });
    }

    return NextResponse.json({ error: "Provide either `id` or `shocks`" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scenario failed";
    console.error("[portfolio/scenario]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
