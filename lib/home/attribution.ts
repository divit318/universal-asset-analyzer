/**
 * Performance Attribution — what actually drove the return.
 *
 * Reads per-holding unrealized P&L (which `UniversalPortfolioReport` already
 * carries) and decomposes total return into contributions by holding and by
 * sector, plus a cash-drag term. It is deliberately *cumulative* attribution,
 * not intraday: the digest ships no per-holding live quote to the client, so an
 * honest "today, by holding" is not derivable on this surface — cumulative is,
 * and the module labels it as such rather than implying a day figure it can't
 * source.
 *
 * Cash drag is the standard opportunity-cost term: the return the idle-cash
 * weight would have earned had it been invested at the portfolio's own realised
 * rate. It is negative in an up market (cash held you back) and positive in a
 * down one (cash cushioned you) — both are true and both are shown.
 *
 * Pure — no I/O. Unit-tested in tests/home-attribution.test.ts.
 */

import type { UniversalPortfolioReport } from "../portfolio/report";
import type { PerformanceAttribution, AttributionRow } from "./contracts";

const EMPTY: PerformanceAttribution = {
  status: "empty",
  totalReturnPct: 0,
  totalReturnDollar: 0,
  byHolding: [],
  bySector: [],
  cashDrag: null,
  benchmark: null,
};

/** Contribution to total return in pp of cost basis: pnl / cost × 100. */
function pct(dollar: number, cost: number): number {
  return cost > 0 ? (dollar / cost) * 100 : 0;
}

/** Ranks rows by contribution magnitude and keeps the n that move the needle. */
function topByMagnitude(rows: AttributionRow[], n: number): AttributionRow[] {
  return rows
    .filter((r) => Math.abs(r.contributionDollar) >= 0.005 * Math.max(1, Math.abs(rows.reduce((s, x) => s + x.contributionDollar, 0))))
    .sort((a, b) => Math.abs(b.contributionDollar) - Math.abs(a.contributionDollar))
    .slice(0, n);
}

export function buildAttribution(
  report: UniversalPortfolioReport | null,
  benchmark: { symbol: string; excessPct: number } | null,
): PerformanceAttribution {
  if (!report || report.holdingCount === 0 || report.totalCost <= 0) return EMPTY;

  const cost = report.totalCost;

  // By holding.
  const holdingRows: AttributionRow[] = report.holdings
    .filter((h) => h.unrealizedPL != null && (h.symbol || h.name))
    .map((h) => {
      const dollar = h.unrealizedPL as number;
      return {
        id: `attr-h-${h.symbol ?? h.name}`,
        label: h.symbol ?? h.name,
        kind: "holding" as const,
        contributionDollar: dollar,
        contributionPct: pct(dollar, cost),
      };
    });

  // By sector — aggregate unrealized P&L across the sector-classified book.
  const sectorTotals = new Map<string, number>();
  for (const h of report.holdings) {
    if (h.unrealizedPL == null) continue;
    const sector = h.attributes?.sector ?? null;
    if (!sector) continue;
    sectorTotals.set(sector, (sectorTotals.get(sector) ?? 0) + h.unrealizedPL);
  }
  const sectorRows: AttributionRow[] = [...sectorTotals.entries()].map(([sector, dollar]) => ({
    id: `attr-s-${sector}`,
    label: sector,
    kind: "sector" as const,
    contributionDollar: dollar,
    contributionPct: pct(dollar, cost),
  }));

  // Cash drag — opportunity cost of the idle-cash weight at the book's own rate.
  const cashSlice = report.allocation.byAssetClass.slices.find((s) => s.key === "cash");
  const investedReturnRate = report.totalCost > 0 ? report.totalReturnDollar / report.totalCost : 0;
  let cashDrag: AttributionRow | null = null;
  if (cashSlice && cashSlice.value > 0) {
    const dragDollar = -cashSlice.value * investedReturnRate;
    if (Math.abs(dragDollar) >= 1) {
      cashDrag = {
        id: "attr-cash-drag",
        label: "Cash drag",
        kind: "cash",
        contributionDollar: dragDollar,
        contributionPct: pct(dragDollar, cost),
      };
    }
  }

  return {
    status: "ok",
    totalReturnPct: report.totalReturn,
    totalReturnDollar: report.totalReturnDollar,
    byHolding: topByMagnitude(holdingRows, 6),
    bySector: topByMagnitude(sectorRows, 6),
    cashDrag,
    benchmark,
  };
}
