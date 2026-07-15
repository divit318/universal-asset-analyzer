import { NextResponse } from "next/server";
import { getIntradayHistory, intradayRetentionDays, type IntradayInterval } from "@/lib/yahoo";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_INTERVALS = new Set<IntradayInterval>(["5m", "15m", "30m", "60m"]);

/**
 * GET /api/chart-history?symbol=AAPL&interval=15m&days=30
 *
 * Real intraday bars for the chart workspace's Candle Interval control.
 * Only hit for intraday intervals (5m/15m/30m/60m) — 1D/1W/1M are derived
 * client-side from the daily history the Research page already fetched (see
 * lib/chart-aggregation.ts), so they never reach this route.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = normalizeSymbol(params.get("symbol"));
  const interval = params.get("interval");
  const daysParam = params.get("days");
  const days = daysParam ? Number(daysParam) : 30;

  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }
  if (!interval || !VALID_INTERVALS.has(interval as IntradayInterval)) {
    return NextResponse.json({ error: "`interval` must be one of 5m, 15m, 30m, 60m" }, { status: 400 });
  }
  if (!Number.isFinite(days) || days <= 0) {
    return NextResponse.json({ error: "`days` must be a positive number" }, { status: 400 });
  }

  try {
    const history = await getIntradayHistory(symbol, interval as IntradayInterval, days);
    const availableDays = intradayRetentionDays(interval as IntradayInterval);
    return NextResponse.json({ history, requestedDays: days, availableDays });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch intraday history";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
