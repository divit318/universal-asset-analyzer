/**
 * GET /api/portfolio/optimize/snapshots — Portfolio Snapshots (Feature 10).
 *
 * Every implementation records a "pre-execution" and "post-execution"
 * snapshot (see lib/portfolio/engines/transaction.ts). This lists them —
 * the foundation for future scenario analysis, and the same records that
 * back Undo (POST /api/portfolio/optimize/undo takes a snapshotId from here
 * or from an execute response).
 */
import { NextResponse } from "next/server";
import { listPortfolioSnapshots } from "@/lib/portfolio/engines/transaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "20");

  try {
    const snapshots = listPortfolioSnapshots(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({ snapshots });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list snapshots";
    console.error("[portfolio/optimize/snapshots]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
