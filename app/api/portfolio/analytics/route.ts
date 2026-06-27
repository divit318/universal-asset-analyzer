import { NextResponse } from "next/server";
import { listPortfolio } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { getQuoteSummary } from "@/lib/yahoo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SectorAllocation {
  sector: string;
  value: number;
  weight: number; // 0-100
  positionCount: number;
}

interface ConcentrationWarning {
  type: "position" | "sector";
  label: string;
  pct: number;
  message: string;
}

export interface PortfolioAnalytics {
  totalCost: number;
  totalValue: number;
  totalReturn: number;   // %
  totalReturnDollar: number;
  sectorAllocation: SectorAllocation[];
  positionWeights: { symbol: string; name: string; weight: number; value: number }[];
  concentrationWarnings: ConcentrationWarning[];
  /** SPY 1-year return for benchmark context. */
  spyReturn: number | null;
  positionCount: number;
}

interface RawSectorProfile {
  assetProfile?: { sector?: string };
}

/** Fetch sector for a batch of symbols. Best-effort per symbol. */
async function getSectors(symbols: string[]): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  await Promise.allSettled(
    symbols.map(async (sym) => {
      try {
        const raw = (await getQuoteSummary(sym, ["assetProfile"])) as RawSectorProfile;
        const sector = raw.assetProfile?.sector;
        if (sector) results[sym] = sector;
      } catch {
        // best-effort
      }
    }),
  );
  return results;
}

interface RawSpyQuote {
  regularMarketPrice?: number;
  fiftyTwoWeekChangePercent?: number;
}

async function getSpyReturn(): Promise<number | null> {
  try {
    const raw = (await getQuoteSummary("SPY", ["price"])) as { price?: RawSpyQuote };
    const v = raw.price?.fiftyTwoWeekChangePercent;
    return typeof v === "number" && Number.isFinite(v) ? v * 100 : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/portfolio/analytics
 * Enriches each portfolio position with sector data and computes allocation
 * statistics, concentration warnings, and a SPY benchmark return.
 */
export async function GET() {
  const positions = listPortfolio();
  if (positions.length === 0) {
    return NextResponse.json({
      totalCost: 0, totalValue: 0, totalReturn: 0, totalReturnDollar: 0,
      sectorAllocation: [], positionWeights: [], concentrationWarnings: [],
      spyReturn: null, positionCount: 0,
    } satisfies PortfolioAnalytics);
  }

  const symbols = positions.map((p) => p.symbol);
  const [quotes, sectors, spyReturn] = await Promise.all([
    getQuotes(symbols).catch(() => []),
    getSectors(symbols),
    getSpyReturn(),
  ]);

  const quoteMap: Record<string, number> = {};
  for (const q of quotes) if (q.price > 0) quoteMap[q.symbol] = q.price;

  const enriched = positions.map((p) => {
    const price = quoteMap[p.symbol] ?? null;
    const cost = p.shares * p.avgCost;
    const value = price != null ? p.shares * price : null;
    return { ...p, price, cost, value, sector: sectors[p.symbol] ?? "Unknown" };
  });

  const totalCost = enriched.reduce((s, p) => s + p.cost, 0);
  const totalValue = enriched.reduce((s, p) => s + (p.value ?? p.cost), 0);
  const totalReturnDollar = totalValue - totalCost;
  const totalReturn = totalCost > 0 ? (totalReturnDollar / totalCost) * 100 : 0;

  // Position weights (by current value)
  const positionWeights = enriched
    .map((p) => ({
      symbol: p.symbol,
      name: p.name,
      value: p.value ?? p.cost,
      weight: totalValue > 0 ? ((p.value ?? p.cost) / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  // Sector allocation
  const sectorMap = new Map<string, { value: number; count: number }>();
  for (const p of enriched) {
    const v = p.value ?? p.cost;
    const existing = sectorMap.get(p.sector) ?? { value: 0, count: 0 };
    sectorMap.set(p.sector, { value: existing.value + v, count: existing.count + 1 });
  }
  const sectorAllocation: SectorAllocation[] = [...sectorMap.entries()]
    .map(([sector, { value, count }]) => ({
      sector,
      value,
      positionCount: count,
      weight: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  // Concentration warnings
  const concentrationWarnings: ConcentrationWarning[] = [];
  for (const pos of positionWeights) {
    if (pos.weight >= 25) {
      concentrationWarnings.push({
        type: "position",
        label: pos.symbol,
        pct: pos.weight,
        message: `${pos.symbol} is ${pos.weight.toFixed(1)}% of your portfolio — single-stock concentration risk`,
      });
    }
  }
  for (const sec of sectorAllocation) {
    if (sec.weight >= 40 && sec.sector !== "Unknown") {
      concentrationWarnings.push({
        type: "sector",
        label: sec.sector,
        pct: sec.weight,
        message: `${sec.sector} is ${sec.weight.toFixed(1)}% of your portfolio — sector concentration risk`,
      });
    }
  }

  return NextResponse.json({
    totalCost,
    totalValue,
    totalReturn,
    totalReturnDollar,
    sectorAllocation,
    positionWeights,
    concentrationWarnings,
    spyReturn,
    positionCount: positions.length,
  } satisfies PortfolioAnalytics);
}
