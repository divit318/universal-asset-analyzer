/**
 * POST /api/portfolio/invest
 * Body: { cashAmount: number }
 *
 * Returns an optimized allocation of new cash across portfolio positions,
 * derived entirely from the current PortfolioReport analytics.
 */
import { NextResponse } from "next/server";
import { computeCashAllocation } from "@/lib/portfolio-analytics";
import type { PortfolioReport } from "@/lib/portfolio-analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-use the report cache from the report route via a shared fetch
async function getReport(): Promise<PortfolioReport | null> {
  try {
    const host = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    const res = await fetch(`${host}/api/portfolio/report`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PortfolioReport;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: { cashAmount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cash = Number(body.cashAmount);
  if (!Number.isFinite(cash) || cash <= 0) {
    return NextResponse.json({ error: "cashAmount must be a positive number" }, { status: 400 });
  }

  const report = await getReport();
  if (!report || report.positionCount === 0) {
    return NextResponse.json({ error: "No portfolio data available" }, { status: 404 });
  }

  const allocations = computeCashAllocation(cash, report);
  return NextResponse.json({ cashAmount: cash, allocations });
}
