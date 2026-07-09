/**
 * GET /api/dashboard
 *
 * Market Dashboard aggregation endpoint — the home page's compact teaser.
 * Pure composition, now sharing lib/mission-control.ts's gatherContext()
 * with the full /intelligence Mission Control digest instead of
 * independently re-fetching the same data. This used to self-fetch
 * /api/portfolio/report and /api/calendar over HTTP from within the same
 * process and separately recompute market regime — gatherContext() already
 * does all of that (plus a Scanner-snapshot-first regime that's richer than
 * the live-only computation this route used alone).
 *
 * Each source is still best-effort: a failure in one does not fail the
 * others (gatherContext()'s own per-source degradation already guarantees
 * this).
 */
import { NextResponse } from "next/server";
import { gatherContext } from "@/lib/mission-control";
import { getCalendarEvents } from "@/lib/calendar";
import type { PortfolioAlert, OpportunityRank as PortfolioOpportunity } from "@/lib/portfolio-analytics";
import type { MarketRegime, SectorRotationSnapshot, WatchlistAlert } from "@/lib/types";
import type { CalendarEvent } from "@/lib/calendar";

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

async function getUpcomingEvents(): Promise<CalendarEvent[]> {
  try {
    const { events } = await getCalendarEvents();
    const today = new Date().toISOString().slice(0, 10);
    return events
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
  } catch {
    return [];
  }
}

export async function GET() {
  const [ctx, upcomingEvents] = await Promise.all([
    gatherContext(),
    getUpcomingEvents(),
  ]);

  const response: DashboardResponse = {
    regime: ctx.regime,
    sectorRotation: ctx.rotation,
    portfolioAlerts: ctx.report?.alerts ?? [],
    topOpportunities: (ctx.report?.opportunities ?? []).slice(0, 5),
    watchlistAlerts: ctx.watchlistAlerts,
    upcomingEvents,
    portfolioHealthScore: ctx.report?.health.total ?? null,
    portfolioValue: ctx.report?.totalValue ?? null,
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}
