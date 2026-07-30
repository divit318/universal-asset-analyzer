/**
 * POST /api/portfolio/simulator/edit — manual holding edits, server-side so
 * the value-conservation invariant (every edit funds from / refills the cash
 * sleeve) and FX conversion live in exactly one place.
 *
 *   { id, action: "adjust", symbol, quantity }
 *   { id, action: "remove", symbol }
 *   { id, action: "add",    symbol, name?, assetClass, quantity }
 *
 * Returns { simulation, changedSymbols, note } — the client refetches the
 * evaluation and fires refresh-narrative with changedSymbols afterwards.
 */
import { NextResponse } from "next/server";
import { getSimulation, updateSimulation } from "@/lib/db";
import { buildMarketContext } from "@/lib/portfolio/context";
import { PORTFOLIO_ASSET_CLASSES } from "@/lib/portfolio/model/types";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { addHolding, applyQuantityEdit, removeHolding, type EditResult } from "@/lib/portfolio/simulator/edit";
import { simHoldingsToRaw } from "@/lib/portfolio/simulator/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    id?: string;
    action?: string;
    symbol?: string;
    quantity?: number;
    name?: string;
    assetClass?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sim = typeof body.id === "string" ? getSimulation(body.id) : null;
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  try {
    // One market snapshot prices the outgoing position AND any incoming one.
    const ctx = await buildMarketContext(simHoldingsToRaw(sim.holdings), {
      baseCurrency: sim.profile.currency,
      candidateSymbols: body.action === "add" ? [symbol] : [],
    });
    const priceBase = (sym: string): number | null => {
      const q = ctx.quotes.get(sym);
      if (!q) return null;
      const cur = q.currency ?? "USD";
      return q.price * (cur === sim.profile.currency ? 1 : (ctx.fx[cur] ?? 1));
    };

    let result: EditResult;
    if (body.action === "adjust") {
      const price = priceBase(symbol);
      if (price === null) return NextResponse.json({ error: `No live price for ${symbol} right now` }, { status: 502 });
      result = applyQuantityEdit(sim.holdings, symbol, Number(body.quantity), price, sim.profile.currency);
    } else if (body.action === "remove") {
      const price = priceBase(symbol);
      if (price === null) return NextResponse.json({ error: `No live price for ${symbol} right now` }, { status: 502 });
      result = removeHolding(sim.holdings, symbol, price, sim.profile.currency);
    } else if (body.action === "add") {
      const q = ctx.quotes.get(symbol);
      const price = priceBase(symbol);
      if (!q || price === null) {
        return NextResponse.json({ error: `${symbol} has no live quote — it cannot be added` }, { status: 400 });
      }
      const assetClass = body.assetClass as PortfolioAssetClass;
      if (!PORTFOLIO_ASSET_CLASSES.includes(assetClass) || assetClass === "cash") {
        return NextResponse.json({ error: "Unknown asset class" }, { status: 400 });
      }
      result = addHolding(
        sim.holdings,
        {
          symbol,
          name: q.name ?? (typeof body.name === "string" && body.name.trim() ? body.name.trim() : symbol),
          assetClass,
          currency: q.currency ?? "USD",
          quantity: Number(body.quantity),
        },
        price,
        sim.profile.currency,
      );
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const updated = updateSimulation(sim.id, { holdings: result.holdings });
    return NextResponse.json({
      simulation: updated,
      changedSymbols: result.changedSymbols,
      note: result.note,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Edit failed";
    // Domain violations (overdrawn sleeve, duplicate symbol…) are 400s, not 500s.
    const domain = /cash|already|Invalid|Quantity|price|No holding/.test(message);
    if (!domain) console.error("[portfolio/simulator/edit]", err);
    return NextResponse.json({ error: message }, { status: domain ? 400 : 500 });
  }
}
