/**
 * GET /api/dashboard
 *
 * Market Dashboard aggregation endpoint — the "daily command center" view.
 * Synthesizes existing engines into one payload; introduces no new business
 * logic of its own (pure composition, per MASTER_ARCHITECTURE_BLUEPRINT.md §6.6):
 *   - Market regime (deterministic, from live macro/sector data — no AI, no
 *     dependency on the full multi-minute Scanner AI pipeline)
 *   - Sector Rotation snapshot (cached, instant)
 *   - Portfolio alerts + top opportunities (from the already-cached portfolio report)
 *   - Watchlist alerts (deterministic, lib/ai-watchlist.ts gatherWatchlistAlerts — no AI call)
 *   - Upcoming earnings/macro calendar (top 5 by date)
 *
 * Each source is best-effort: a failure in one does not fail the others.
 */
import { NextResponse } from "next/server";
import { fetchMacroSignals, fetchSectorPerformance } from "@/lib/scanner/signals";
import { assessMarketRegime } from "@/lib/scanner";
import { getLatestSectorRotation } from "@/lib/sector-rotation";
import { gatherWatchlistAlerts } from "@/lib/ai-watchlist";
import type { PortfolioReport, PortfolioAlert, OpportunityRank as PortfolioOpportunity } from "@/lib/portfolio-analytics";
import type { MarketRegime, SectorRotationSnapshot, WatchlistAlert } from "@/lib/types";
import type { CalendarResponse, CalendarEvent } from "@/app/api/calendar/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface DashboardResponse {
  regime: MarketRegime | null;
  sectorRotation: SectorRotationSnapshot | null;
  portfolioAlerts: PortfolioAlert[];
  topOpportunities: PortfolioOpportunity[];
  watchlistAlerts: WatchlistAlert[];
  upcomingEvents: CalendarEvent[];
  portfolioHealthScore: number | null;
  portfolioValue: number | null;
  generatedAt: string;
}

async function getPortfolioReport(host: string): Promise<PortfolioReport | null> {
  try {
    const res = await fetch(`${host}/api/portfolio/report`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return (await res.json()) as PortfolioReport;
  } catch {
    return null;
  }
}

async function getCalendar(host: string): Promise<CalendarEvent[]> {
  try {
    const res = await fetch(`${host}/api/calendar`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as CalendarResponse;
    const today = new Date().toISOString().slice(0, 10);
    return data.events
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  } catch {
    return [];
  }
}

async function getRegime(): Promise<MarketRegime | null> {
  try {
    const [macroSignals, sectorPerf] = await Promise.all([
      fetchMacroSignals(),
      fetchSectorPerformance(),
    ]);
    // No AI-detected events at dashboard-load speed — regime reflects live
    // macro/sector price action only (trend, breadth, dominant sectors).
    // dominantThemes requires Scanner's event pipeline and is intentionally
    // empty here; run a full scan on /scanner for theme-level detail.
    return assessMarketRegime(macroSignals, sectorPerf, []);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const host = new URL(request.url).origin;

  const [regime, sectorRotation, report, watchlistAlerts, upcomingEvents] = await Promise.all([
    getRegime(),
    Promise.resolve(getLatestSectorRotation()),
    getPortfolioReport(host),
    gatherWatchlistAlerts(),
    getCalendar(host),
  ]);

  const response: DashboardResponse = {
    regime,
    sectorRotation,
    portfolioAlerts: report?.alerts ?? [],
    topOpportunities: (report?.opportunities ?? []).slice(0, 5),
    watchlistAlerts,
    upcomingEvents,
    portfolioHealthScore: report?.health.total ?? null,
    portfolioValue: report?.totalValue ?? null,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
