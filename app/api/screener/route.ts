import { NextResponse } from "next/server";
import {
  getDatasetStatus,
  getScreenerData,
  refreshScreenerData,
} from "@/lib/dataset";
import { applyScreen, parseFundamentalCriteria } from "@/lib/fundamental-screener";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/screener — dataset build status (for polling while it warms). */
export async function GET() {
  return NextResponse.json({ status: getDatasetStatus() });
}

/**
 * POST /api/screener
 * Body: { filters, sector, industry, sortField, sortDir, size, offset, refresh }
 * Filters the cached, scored fundamental dataset for the ~1000-name US universe.
 * While the dataset is still warming, returns whatever is ready plus a status
 * the client polls on.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.refresh === true) {
    return NextResponse.json({ status: refreshScreenerData(), rows: [], total: 0 });
  }

  const criteria = parseFundamentalCriteria(body);
  const size = Math.min(Math.max(Number(body.size) || 50, 1), 200);
  const offset = Math.max(Number(body.offset) || 0, 0);

  let status, metrics;
  try {
    ({ status, metrics } = await getScreenerData());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Screener data unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const matches = applyScreen(metrics, criteria);
  return NextResponse.json({
    status,
    total: matches.length,
    universeReady: metrics.length,
    offset,
    rows: matches.slice(offset, offset + size),
  });
}
