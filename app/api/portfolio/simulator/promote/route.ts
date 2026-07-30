/**
 * POST /api/portfolio/simulator/promote — turn a hypothetical book into real
 * holdings, after the user has reviewed the trade list.
 *
 *   { id, destination: { kind: "new", name } | { kind: "existing", portfolioId },
 *     symbols: string[] }   // the reviewed/selected subset ("CASH" = the sleeve)
 *
 * Every position is written as a BUY lot at the CURRENT live price (server-side
 * pricing is authoritative — the client's preview may be minutes old), through
 * the same atomic executeTradeBatch primitive the Optimize tab uses. Merging
 * into an existing portfolio nets overlapping tickers by construction: the lot
 * ledger aggregates same-symbol lots into one position, so a duplicate row is
 * structurally impossible. The simulation is marked "promoted" but kept —
 * still viewable, still comparable.
 */
import { NextResponse } from "next/server";
import {
  createPortfolio,
  executeTradeBatch,
  getPortfolioMeta,
  getSimulation,
  updateSimulation,
  type LotWrite,
} from "@/lib/db";
import { buildMarketContext } from "@/lib/portfolio/context";
import { simHoldingsToRaw } from "@/lib/portfolio/simulator/evaluate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: {
    id?: string;
    destination?: { kind?: string; name?: string; portfolioId?: number };
    symbols?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sim = typeof body.id === "string" ? getSimulation(body.id) : null;
  if (!sim) return NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  if (sim.holdings.length === 0) {
    return NextResponse.json({ error: "This simulation has no holdings to promote" }, { status: 400 });
  }

  const selected = new Set(
    (Array.isArray(body.symbols) ? body.symbols : []).filter((s): s is string => typeof s === "string"),
  );
  const holdings = sim.holdings.filter((h) => selected.has(h.symbol ?? "CASH"));
  if (holdings.length === 0) {
    return NextResponse.json({ error: "No trades selected" }, { status: 400 });
  }

  const dest = body.destination;
  if (!dest || (dest.kind !== "new" && dest.kind !== "existing")) {
    return NextResponse.json({ error: "destination must be 'new' or 'existing'" }, { status: 400 });
  }

  try {
    // Server-side live pricing for every non-cash position.
    const ctx = await buildMarketContext(simHoldingsToRaw(holdings), {
      baseCurrency: sim.profile.currency,
    });
    const lots: LotWrite[] = [];
    const unpriced: string[] = [];
    for (const h of holdings) {
      if (h.assetClass === "cash") {
        lots.push({
          symbol: `CASH-${h.currency.toUpperCase()}`,
          name: h.name,
          shares: h.quantity,
          price: 1,
          kind: "buy",
          assetClass: "cash",
          currency: h.currency,
          unit: "currency",
        });
        continue;
      }
      const q = h.symbol ? ctx.quotes.get(h.symbol) : undefined;
      if (!q) {
        unpriced.push(h.symbol ?? h.name);
        continue;
      }
      lots.push({
        symbol: h.symbol!,
        name: q.name ?? h.name,
        shares: h.quantity,
        price: q.price, // in the instrument's own currency, like every other lot
        kind: "buy",
        assetClass: h.assetClass,
        currency: q.currency ?? h.currency,
        unit: h.assetClass === "crypto" ? "coins" : "shares",
        meta: h.rationale ? { promotedFrom: sim.name, rationale: h.rationale } : { promotedFrom: sim.name },
      });
    }
    if (lots.length === 0) {
      return NextResponse.json(
        { error: `No live price for ${unpriced.join(", ")} — cannot promote right now` },
        { status: 502 },
      );
    }

    // Destination portfolio.
    let portfolio;
    if (dest.kind === "new") {
      const name = typeof dest.name === "string" ? dest.name.trim() : "";
      if (!name || name.length > 80) {
        return NextResponse.json({ error: "A portfolio name is required (max 80 characters)" }, { status: 400 });
      }
      portfolio = createPortfolio(name);
    } else {
      const pid = Number(dest.portfolioId);
      portfolio = Number.isInteger(pid) ? getPortfolioMeta(pid) : null;
      if (!portfolio) return NextResponse.json({ error: "Destination portfolio not found" }, { status: 404 });
    }

    executeTradeBatch(lots, [], portfolio.id);
    const updated = updateSimulation(sim.id, {
      status: "promoted",
      promotedAt: new Date().toISOString(),
    });

    return NextResponse.json({
      simulation: updated,
      portfolio,
      executedCount: lots.length,
      skipped: unpriced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Promotion failed";
    console.error("[portfolio/simulator/promote]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
