/**
 * IOS server-side helpers — used only in API routes (Node.js runtime).
 *
 * Loads the portfolio so the IOS API routes can personalise ideas without
 * duplicating data-loading logic.
 *
 * ── Why this file changed ─────────────────────────────────────────────────────
 *
 * It used to call `computePortfolioReport()` — a second portfolio engine — over
 * `listPortfolio()`, the pre-universal `portfolio` table. That was wrong twice:
 *
 *   1. TWO ENGINES. The legacy report computed its own total return (against a
 *      different denominator), its own risk analytics, its own health score and
 *      its own benchmark comparison (a fixed 252-day SPY window rather than the
 *      portfolio's own holding period). Everything the Portfolio page showed, this
 *      computed differently, so "your portfolio" meant one thing on /portfolio and
 *      another in the Wire's fit badges.
 *   2. HALF A PORTFOLIO. It consumed `listPortfolio()` — ticker positions only.
 *      Cash arrives there as a synthetic `CASH-USD` position (scored as if it were
 *      a stock), and manually-valued assets do not arrive at all: on the real book
 *      that silently excluded a $1.25M cash sleeve, a property, a private stake and
 *      a collectible. Every weight, sector share and HHI the legacy engine produced
 *      was therefore computed against the wrong denominator.
 *
 * Both are gone: this is now a thin loader over `buildPortfolioReport()`, the one
 * canonical Portfolio analytics pipeline, and the profile adapter it feeds
 * (`fromUniversalReport`) already existed for the client-side path.
 *
 * There is also no private cache here any more. The platform data layer already
 * caches, dedups and revalidates every provider call `buildPortfolioReport()`
 * makes, so a module-level `let cachedReport` only added a second, invisible TTL
 * that could serve a portfolio from before the user's last trade.
 */

import { getPortfolioReport, type UniversalPortfolioReport } from "@/lib/portfolio/report";
import { DEFAULT_CONSTRAINTS, type PortfolioObjective, type PortfolioConstraints } from "./types";

export interface IOSServerContext {
  report: UniversalPortfolioReport | null;
  objective: PortfolioObjective;
  constraints: PortfolioConstraints;
}

export async function getPortfolioForIOS(): Promise<IOSServerContext> {
  // Objective + constraints are client-side localStorage values; server-side
  // we use sensible defaults (the fit scorer degrades gracefully).
  const objective: PortfolioObjective = "ai_optimized";
  const constraints: PortfolioConstraints = DEFAULT_CONSTRAINTS;

  try {
    // Through the platform's portfolioReport dataset (audit PF-02): every
    // consumer of the IOS context now shares one 2-minute report build.
    const report = await getPortfolioReport();
    // An empty book is not an error — IOS simply has nothing to personalise against.
    return { report: report.holdingCount > 0 ? report : null, objective, constraints };
  } catch {
    // Portfolio is optional — IOS degrades gracefully when unavailable.
    return { report: null, objective, constraints };
  }
}
