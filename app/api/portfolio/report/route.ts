/**
 * GET /api/portfolio/report
 *
 * Orchestrates all portfolio data fetching and runs the analytics engine.
 * Results are cached for 5 minutes to keep subsequent tab switches instant.
 * All computation is deterministic — the AI explanation layer is a separate
 * endpoint (/api/portfolio/audit).
 */
import { NextResponse } from "next/server";
import { listPortfolio } from "@/lib/db";
import { getQuotes, getHistory } from "@/lib/yahoo";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { computePortfolioReport, type PortfolioReport, type PositionInput } from "@/lib/portfolio-analytics";
import { getLatestSectorRotation } from "@/lib/sector-rotation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { report: PortfolioReport; at: number } | null = null;

/** Settled best-effort: returns null on any failure. */
async function tryOr<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

async function getSpyReturn1y(): Promise<number | null> {
  try {
    const hist = await getHistory("SPY", 380);
    if (hist.length < 240) return null;
    const first = hist[0].adjClose ?? hist[0].close;
    const last = hist[hist.length - 1].adjClose ?? hist[hist.length - 1].close;
    return first > 0 ? ((last - first) / first) * 100 : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fresh = url.searchParams.get("fresh") === "1";

  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.report);
  }

  const positions = listPortfolio();
  if (positions.length === 0) {
    const empty = computePortfolioReport([], [], null);
    return NextResponse.json(empty);
  }

  const symbols = positions.map((p) => p.symbol);

  // Parallel: quotes + SPY history (fast), then fundamentals + position histories (slower)
  const [quotes, spyHistory, spyReturn1y] = await Promise.all([
    getQuotes(symbols).catch(() => [] as Awaited<ReturnType<typeof getQuotes>>),
    getHistory("SPY", 120).catch(() => []),
    getSpyReturn1y(),
  ]);

  const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

  // Fetch fundamentals + 90-day history for each position in parallel
  const inputs: PositionInput[] = await Promise.all(
    positions.map(async (position): Promise<PositionInput> => {
      const [fundamentals, statements, history] = await Promise.all([
        tryOr(() => getFundamentals(position.symbol)),
        tryOr(() => getFinancialStatements(position.symbol)),
        getHistory(position.symbol, 90).catch(() => []),
      ]);

      return {
        position,
        quote: quoteMap.get(position.symbol) ?? null,
        snapshot: fundamentals?.snapshot ?? null,
        statements,
        analyst: fundamentals?.analyst ?? null,
        history,
      };
    }),
  );

  const rotationSnapshot = getLatestSectorRotation();
  const report = computePortfolioReport(inputs, spyHistory, spyReturn1y, rotationSnapshot);
  cached = { report, at: Date.now() };

  return NextResponse.json(report);
}
