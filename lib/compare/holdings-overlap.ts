/**
 * Portfolio overlap between compared funds — "are these two ETFs actually
 * different exposure, or the same handful of mega-caps wearing different
 * tickers?" is one of the most concrete questions an investor comparing
 * ETFs asks, and it's fully answerable from data the platform already has:
 * `topHoldings` (ScreenerCandidate / ClassCompareEntry), no new provider.
 *
 * Deliberately scoped to disclosed top holdings, not the full portfolio —
 * Yahoo's topHoldings module returns roughly the top 10. The overlap % is
 * therefore a lower bound on true portfolio overlap for broad funds (two
 * S&P 500 funds share far more than their top 10), and callers should say so
 * in the UI rather than imply full-portfolio precision.
 */

import type { FundHolding } from "../types";

export interface SharedHolding {
  symbol: string;
  name: string;
  /** Weight in each fund, keyed by that fund's ticker symbol. */
  weights: Record<string, number>;
}

export interface UniqueHolding {
  symbol: string;
  name: string;
  weightPercent: number;
}

export interface FundOverlapEntry {
  symbol: string;
  /** This fund's top holdings that appear in no other compared fund's top holdings, weight-sorted, capped. */
  unique: UniqueHolding[];
}

export interface HoldingsOverlapResult {
  /** Only meaningful for exactly 2 funds — a single headline % the UI can lead with. */
  pairOverlapPercent: number | null;
  /** Present when ≥2 funds have holdings data, sorted by combined weight desc. */
  shared: SharedHolding[];
  /** Per-fund holdings unique to that fund among the compared set. */
  perFund: FundOverlapEntry[];
}

const MAX_SHARED = 10;
const MAX_UNIQUE = 5;

/**
 * Weight-based overlap between two holdings lists: sum of min(weightA, weightB)
 * over shared names. Bounded by min(sum(weightsA), sum(weightsB)) ≤ 100 —
 * the same "portfolio overlap" definition Morningstar-style tools use.
 */
function pairwiseOverlapPercent(a: FundHolding[], b: FundHolding[]): number {
  const bBySymbol = new Map(b.map((h) => [h.symbol.toUpperCase(), h.weightPercent]));
  let overlap = 0;
  for (const h of a) {
    const bw = bBySymbol.get(h.symbol.toUpperCase());
    if (bw != null) overlap += Math.min(h.weightPercent, bw);
  }
  return Math.round(overlap * 10) / 10;
}

export function computeHoldingsOverlap(
  entries: { symbol: string; topHoldings?: FundHolding[] | null }[],
): HoldingsOverlapResult | null {
  const withHoldings = entries.filter((e) => e.topHoldings && e.topHoldings.length > 0);
  if (withHoldings.length < 2) return null;

  const holdingsBySymbol = new Map(withHoldings.map((e) => [e.symbol, e.topHoldings!]));
  const fundSymbols = withHoldings.map((e) => e.symbol);

  // Every distinct underlying holding across the compared funds, with which
  // fund(s) carry it and at what weight.
  const holdingMap = new Map<string, { name: string; weights: Map<string, number> }>();
  for (const [fundSymbol, holdings] of holdingsBySymbol) {
    for (const h of holdings) {
      const key = h.symbol.toUpperCase();
      const existing = holdingMap.get(key) ?? { name: h.name, weights: new Map<string, number>() };
      existing.weights.set(fundSymbol, h.weightPercent);
      holdingMap.set(key, existing);
    }
  }

  const shared: SharedHolding[] = [...holdingMap.entries()]
    .filter(([, v]) => v.weights.size >= 2)
    .map(([symbol, v]) => ({
      symbol,
      name: v.name,
      weights: Object.fromEntries(v.weights),
    }))
    .sort((a, b) => {
      const sumA = Object.values(a.weights).reduce((x, y) => x + y, 0);
      const sumB = Object.values(b.weights).reduce((x, y) => x + y, 0);
      return sumB - sumA;
    })
    .slice(0, MAX_SHARED);

  const sharedSymbols = new Set(shared.map((s) => s.symbol));
  // Unique holdings need the FULL shared set (not just the top MAX_SHARED),
  // so recompute membership directly off holdingMap rather than off `shared`.
  const perFund: FundOverlapEntry[] = withHoldings.map((e) => {
    const holdings = holdingsBySymbol.get(e.symbol)!;
    const unique = holdings
      .filter((h) => (holdingMap.get(h.symbol.toUpperCase())?.weights.size ?? 0) === 1)
      .sort((a, b) => b.weightPercent - a.weightPercent)
      .slice(0, MAX_UNIQUE)
      .map((h) => ({ symbol: h.symbol, name: h.name, weightPercent: h.weightPercent }));
    return { symbol: e.symbol, unique };
  });

  const pairOverlapPercent =
    fundSymbols.length === 2
      ? pairwiseOverlapPercent(holdingsBySymbol.get(fundSymbols[0])!, holdingsBySymbol.get(fundSymbols[1])!)
      : null;

  return { pairOverlapPercent, shared: shared.filter((s) => sharedSymbols.has(s.symbol)), perFund };
}
