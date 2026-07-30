/**
 * The Portfolio store — the ONE place the whole portfolio is read from.
 *
 * This file is where the biggest bug in the audit gets fixed. The user's real
 * estate, private-market stakes, alternatives and structured products have been
 * sitting in the `manual_asset` table all along, fully modelled, with working
 * metrics engines and AI research — reachable from the Research Hub and INVISIBLE
 * to the Portfolio. lib/types.ts:1096 stated it plainly:
 *
 *     "Standalone from Portfolio's aggregate analytics for now."
 *
 * The consequence was not cosmetic. Every number the Portfolio produced — total
 * value, every weight, concentration, health, risk, every scenario — was computed
 * against a denominator that EXCLUDED a large part of the actual portfolio. A user
 * with a house and an angel investment was shown percentages of the wrong whole.
 *
 * listRawHoldings() reads both ledgers and returns one list. That single change is
 * what makes the Portfolio the user's portfolio rather than their brokerage account.
 *
 * Server-only: imports lib/db.ts (node:sqlite). Never import from a client component.
 */

import {
  listManualAssets,
  listUniversalLots,
  removePosition,
  upsertUniversalPosition,
} from "../db";
import { aggregateOpenPositions } from "../portfolio-lots";
import type { PortfolioLot } from "../types";
import type { HoldingUnit, PortfolioAssetClass, RawHolding } from "./model/types";
import { hasClassAdapter } from "./model/adapter";
import "./classes";  // register adapters so hasClassAdapter() is populated

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Coerce a stored asset_class into a known one.
 *
 * An unrecognized value (a class that was removed, or a typo written by an older
 * build) falls back to "equity" — the historical default — rather than throwing.
 * Losing a holding from the portfolio because its class string is unknown would be
 * a far worse failure than mis-classifying it, and the fallback is visible in the UI.
 */
function coerceClass(raw: string | null): PortfolioAssetClass {
  if (raw && hasClassAdapter(raw)) return raw;
  return "equity";
}

/* -------------------------------------------------------------------------- */
/* Market-priced + cash holdings (the `portfolio_lot` ledger)                   */
/* -------------------------------------------------------------------------- */

function listLedgerHoldings(portfolioId: number): RawHolding[] {
  const rows = listUniversalLots(portfolioId);

  // Class/currency/unit/meta are properties of the SYMBOL, not of an individual
  // transaction, so take them from the first lot for that symbol. (A later lot
  // disagreeing would mean the user re-classified the holding; the earliest lot is
  // the one that established it, and the edit path rewrites the whole ledger.)
  const attrs = new Map<string, { assetClass: PortfolioAssetClass; currency: string; unit: HoldingUnit; meta: Record<string, unknown> }>();
  for (const r of rows) {
    if (attrs.has(r.symbol)) continue;
    attrs.set(r.symbol, {
      assetClass: coerceClass(r.asset_class),
      currency: (r.currency ?? "USD").toUpperCase(),
      unit: (r.unit ?? "shares") as HoldingUnit,
      meta: parseMeta(r.meta),
    });
  }

  const lots: PortfolioLot[] = rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    shares: r.shares,
    price: r.price,
    kind: r.kind as PortfolioLot["kind"],
    fees: r.fees,
    tradeDate: r.trade_date,
    createdAt: r.created_at,
  }));

  // Reuse the existing average-cost aggregation — realized P&L and avg-cost logic
  // are already correct and tested there (lib/portfolio-lots.ts). No reimplementation.
  return aggregateOpenPositions(lots).map((p) => {
    const a = attrs.get(p.symbol) ?? {
      assetClass: "equity" as PortfolioAssetClass,
      currency: "USD",
      unit: "shares" as HoldingUnit,
      meta: {},
    };

    return {
      id: `lot:${p.symbol}`,
      assetClass: a.assetClass,
      symbol: a.assetClass === "cash" ? null : p.symbol,
      name: p.name,
      currency: a.currency,
      quantity: p.shares,
      unit: a.unit,
      costBasis: p.shares * p.avgCost,
      acquiredAt: p.firstTradeDate,
      manualValue: null,
      manualValueAsOf: null,
      meta: a.meta,
    } satisfies RawHolding;
  });
}

/* -------------------------------------------------------------------------- */
/* Manually-valued holdings (the `manual_asset` ledger)                        */
/* -------------------------------------------------------------------------- */

function listManualHoldings(portfolioId: number): RawHolding[] {
  return listManualAssets(undefined, portfolioId).map((a) => ({
    id: `manual:${a.id}`,
    assetClass: a.category as PortfolioAssetClass,
    symbol: null,
    name: a.name,
    // The manual-asset ledger has never carried a currency. Defaulting to USD is
    // honest for now (it matches how the values were entered) and is the obvious
    // next thing to collect — noted in the PLAN's remaining-debt section.
    currency: "USD",
    quantity: 1,
    unit: a.category === "private_market" ? "stake" : "units",
    costBasis: a.acquisitionCost,
    acquiredAt: a.acquisitionDate,
    manualValue: a.currentValue,
    manualValueAsOf: a.currentValueAsOf,
    // The class adapters read `details` back out of here — see classes/manual-base.ts.
    meta: { details: a.details },
  } satisfies RawHolding));
}

/* -------------------------------------------------------------------------- */

/** THE portfolio: every asset the user owns, from both ledgers, in one list. */
export function listRawHoldings(portfolioId = 1): RawHolding[] {
  return [...listLedgerHoldings(portfolioId), ...listManualHoldings(portfolioId)];
}

/** Every symbol the portfolio needs market data for. */
export function portfolioSymbols(raws: RawHolding[]): string[] {
  const out = new Set<string>();
  for (const r of raws) {
    if (r.symbol) out.add(r.symbol.toUpperCase());
    // Structured products are valued off their underlyings' live prices, so those
    // symbols must be fetched too even though the product itself has no ticker.
    const details = r.meta.details as { underlyingSymbols?: string[] } | undefined;
    for (const u of details?.underlyingSymbols ?? []) out.add(u.toUpperCase());
  }
  return [...out];
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export interface UpsertHoldingInput {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  assetClass: PortfolioAssetClass;
  currency?: string;
  unit?: HoldingUnit;
  meta?: Record<string, unknown>;
}

/**
 * Set a holding to an absolute quantity/cost. Mirrors the existing
 * upsertPosition() semantics (replace the ledger with one opening lot) but carries
 * the asset class through, so a bond fund is stored AS a bond fund rather than
 * being silently recorded as an equity — which is what happens today.
 */
export function upsertHolding(input: UpsertHoldingInput): void {
  upsertUniversalPosition({
    symbol: input.symbol,
    name: input.name,
    quantity: input.quantity,
    avgCost: input.avgCost,
    assetClass: input.assetClass,
    currency: input.currency,
    unit: input.unit,
    meta: input.meta ?? null,
  });
}

/** Record or update a cash position. Cash is a holding, not a residual. */
export function upsertCash(
  currency: string,
  amount: number,
  opts: { yieldPct?: number; vehicle?: string } = {},
): void {
  const cur = currency.toUpperCase();
  upsertHolding({
    // A synthetic symbol so cash lives in the same ledger as everything else and
    // needs no parallel storage path.
    symbol: `CASH-${cur}`,
    name: `${cur} Cash`,
    quantity: amount,
    avgCost: 1,
    assetClass: "cash",
    currency: cur,
    unit: "currency",
    meta: { yieldPct: opts.yieldPct ?? null, vehicle: opts.vehicle ?? null },
  });
}

export function removeHolding(symbol: string): void {
  removePosition(symbol);
}
