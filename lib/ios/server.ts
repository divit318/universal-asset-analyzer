/**
 * IOS server-side helpers — used only in API routes (Node.js runtime).
 *
 * Fetches the portfolio report and user preferences so the IOS API routes
 * can serve personalized data without duplicating data-loading logic.
 */

import { listPortfolio } from "@/lib/db";
import { getQuotes } from "@/lib/yahoo";
import { getFundamentals } from "@/lib/fundamentals";
import { getFinancialStatements } from "@/lib/statements";
import { getHistory } from "@/lib/yahoo";
import { computePortfolioReport } from "@/lib/portfolio-analytics";
import type { PortfolioReport, PortfolioObjective, PortfolioConstraints } from "@/lib/portfolio-analytics";
import { DEFAULT_CONSTRAINTS } from "@/lib/portfolio-analytics";

// 5-minute server-side cache (same TTL as the portfolio report route)
let cachedReport: PortfolioReport | null = null;
let cachedAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

export interface IOSServerContext {
  report: PortfolioReport | null;
  objective: PortfolioObjective;
  constraints: PortfolioConstraints;
}

export async function getPortfolioForIOS(): Promise<IOSServerContext> {
  // Objective + constraints are client-side localStorage values; server-side
  // we use sensible defaults (the fit scorer degrades gracefully).
  const objective: PortfolioObjective = "ai_optimized";
  const constraints: PortfolioConstraints = DEFAULT_CONSTRAINTS;

  if (cachedReport && Date.now() - cachedAt < CACHE_TTL) {
    return { report: cachedReport, objective, constraints };
  }

  try {
    const positions = listPortfolio();
    if (positions.length === 0) {
      return { report: null, objective, constraints };
    }

    const symbols = positions.map((p) => p.symbol);
    const [quotes, spyHistory] = await Promise.all([
      getQuotes(symbols),
      getHistory("SPY", 120),
    ]);

    // SPY return for benchmark
    const spyReturn1y: number | null = spyHistory.length >= 252
      ? ((spyHistory.at(-1)!.close - spyHistory[spyHistory.length - 252].close) /
          spyHistory[spyHistory.length - 252].close) * 100
      : null;

    const positionInputs = await Promise.all(
      positions.map(async (pos) => {
        const quote = quotes.find((q) => q.symbol === pos.symbol) ?? null;
        const [fundamentals, statements, history] = await Promise.all([
          getFundamentals(pos.symbol).catch(() => null),
          getFinancialStatements(pos.symbol).catch(() => null),
          getHistory(pos.symbol, 90).catch(() => []),
        ]);
        return {
          position: pos,
          quote,
          snapshot: fundamentals?.snapshot ?? null,
          statements: statements ?? null,
          analyst: fundamentals?.analyst ?? null,
          history,
        };
      }),
    );

    cachedReport = computePortfolioReport(positionInputs, spyHistory, spyReturn1y);
    cachedAt = Date.now();
  } catch {
    // Portfolio is optional — IOS degrades gracefully when unavailable
    cachedReport = null;
  }

  return { report: cachedReport, objective, constraints };
}
