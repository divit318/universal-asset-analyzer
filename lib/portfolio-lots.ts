/**
 * Portfolio lot aggregation — derives a position's live state from its
 * transaction ledger using the average-cost method.
 *
 * The portfolio moved from a single aggregate row per symbol (shares + avgCost)
 * to a lot ledger (one row per buy/sell). This pure function collapses a
 * symbol's lots back into the aggregate the rest of the app reads, and — as a
 * byproduct the old model could never produce — computes realized P&L and the
 * position's true inception date. Those unlock Phase 1 (XIRR, benchmark-relative
 * return, realized-vs-unrealized attribution).
 *
 * Average-cost method (the standard for a long-only personal tracker):
 *   - Buy:  folds its price and fees into the running average cost.
 *   - Sell: realizes P&L against the running average cost (net of fees); the
 *           average cost of the remaining shares is unchanged.
 *   - Flat: reaching zero shares resets the basis, so a later re-entry starts
 *           a fresh cost basis rather than inheriting the old one.
 *
 * Pure and deterministic — no DB, no I/O, fully unit-testable.
 */

import type { PortfolioLot } from "./types";

export interface PositionAggregate {
  symbol: string;
  name: string;
  /** Net open shares (0 when the position has been fully exited). */
  shares: number;
  /** Average cost per open share, in the position's currency. */
  avgCost: number;
  /** Cumulative realized P&L from sells, net of fees. */
  realizedPnl: number;
  /** Total transaction fees paid across all lots. */
  totalFees: number;
  /** Earliest lot's trade date — the position's inception. */
  firstTradeDate: string;
  /** How many transactions make up this position. */
  lotCount: number;
}

/** Round share quantities to kill floating-point summation dust (~1e-13) while
 *  preserving legitimate fractional-share precision (brokerages report to ~6-9
 *  dp). 9 dp is well below any real share fraction yet far above the dust. */
function tidy(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

/** Chronological order: by trade date, then insertion id as a stable tiebreak. */
function chronologically(a: PortfolioLot, b: PortfolioLot): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1;
  return a.id - b.id;
}

/**
 * Collapse one symbol's lots into its aggregate position. Returns null for an
 * empty ledger. `shares === 0` denotes a fully-closed position (kept so callers
 * can still surface realized P&L; the DB layer filters closed rows out of the
 * holdings list).
 */
export function aggregateLots(lots: PortfolioLot[]): PositionAggregate | null {
  if (lots.length === 0) return null;
  const sorted = [...lots].sort(chronologically);

  let shares = 0;
  let avgCost = 0;
  let realizedPnl = 0;
  let totalFees = 0;

  for (const lot of sorted) {
    totalFees += lot.fees;
    if (lot.kind === "buy") {
      const next = shares + lot.shares;
      // Capitalize the buy's fees into cost basis.
      avgCost = next > 0 ? (shares * avgCost + lot.shares * lot.price + lot.fees) / next : 0;
      shares = next;
    } else {
      // Realize against current basis on the shares actually held; fees reduce it.
      const basisShares = Math.min(lot.shares, Math.max(shares, 0));
      realizedPnl += basisShares * (lot.price - avgCost) - lot.fees;
      shares = Math.max(0, shares - lot.shares);
      if (shares === 0) avgCost = 0; // flat → basis resets for any re-entry
    }
  }

  return {
    symbol: sorted[0].symbol,
    name: sorted[sorted.length - 1].name, // most recent name wins
    shares: tidy(shares),
    avgCost,
    realizedPnl,
    totalFees,
    firstTradeDate: sorted[0].tradeDate,
    lotCount: lots.length,
  };
}

/**
 * Aggregate a mixed ledger of many symbols into one aggregate per symbol,
 * newest-inception first. Closed positions (0 shares) are excluded — this is
 * the holdings view.
 */
export function aggregateOpenPositions(lots: PortfolioLot[]): PositionAggregate[] {
  const bySymbol = new Map<string, PortfolioLot[]>();
  for (const lot of lots) {
    const list = bySymbol.get(lot.symbol);
    if (list) list.push(lot);
    else bySymbol.set(lot.symbol, [lot]);
  }
  const positions: PositionAggregate[] = [];
  for (const list of bySymbol.values()) {
    const agg = aggregateLots(list);
    if (agg && agg.shares > 0) positions.push(agg);
  }
  return positions.sort((a, b) => (a.firstTradeDate < b.firstTradeDate ? 1 : -1));
}
