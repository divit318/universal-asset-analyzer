import { NextResponse } from "next/server";
import {
  syncTimelineEvents,
  syncSectorTimeline,
  getTimelineFeed,
  resolveScopeSymbols,
} from "@/lib/timeline";
import { SECTOR_ETF_MAP } from "@/lib/sector-rotation";
import type { TimelineScope, TimelineEventCategory, TimelineFilters } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;
const VALID_SCOPES: TimelineScope[] = ["symbol", "portfolio", "watchlist", "sector"];

function parseFilters(params: URLSearchParams): TimelineFilters {
  const categories = params.get("categories");
  const impact = params.get("impact");
  return {
    fromDate: params.get("fromDate") ?? undefined,
    toDate: params.get("toDate") ?? undefined,
    categories: categories ? (categories.split(",") as TimelineEventCategory[]) : undefined,
    minImportance: params.has("minImportance") ? Number(params.get("minImportance")) : undefined,
    minConfidence: params.has("minConfidence") ? Number(params.get("minConfidence")) : undefined,
    impact: impact === "bullish" || impact === "bearish" || impact === "neutral" ? impact : undefined,
    affectedSegment: params.get("segment") ?? undefined,
    relatedMetric: params.get("metric") ?? undefined,
    catalystOnly: params.get("catalystOnly") === "true",
    openThesisOnly: params.get("openThesisOnly") === "true",
  };
}

/**
 * GET /api/timeline?scope=symbol&id=AAPL[&fromDate=&toDate=&categories=&minImportance=&minConfidence=&impact=&segment=&metric=&catalystOnly=&openThesisOnly=]
 *
 * The historical event feed + thesis evolution for a symbol, portfolio,
 * watchlist, or sector. Syncs fresh raw sources (best-effort, rate-limited)
 * before reading the persisted, filtered feed.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = (params.get("scope") ?? "symbol") as TimelineScope;
  const id = params.get("id")?.trim();

  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: "Invalid `scope`; expected symbol, portfolio, watchlist, or sector" }, { status: 400 });
  }
  if (!id) {
    return NextResponse.json({ error: "An `id` query parameter is required" }, { status: 400 });
  }
  if (scope === "symbol" && !SYMBOL_RE.test(id.toUpperCase())) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  if (scope === "sector" && !(id in SECTOR_ETF_MAP)) {
    return NextResponse.json({ error: `Unknown sector "${id}"` }, { status: 400 });
  }

  try {
    if (scope === "symbol") {
      await syncTimelineEvents(id.toUpperCase());
    } else if (scope === "portfolio" || scope === "watchlist") {
      const { symbols } = resolveScopeSymbols(scope, id);
      await Promise.all(symbols.map((s) => syncTimelineEvents(s)));
    } else {
      syncSectorTimeline(id);
    }

    const feed = getTimelineFeed(scope, scope === "symbol" ? id.toUpperCase() : id, parseFilters(params));
    return NextResponse.json(feed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Timeline sync failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
