/**
 * POST /api/portfolio/optimize/undo — Undo (Feature 9).
 *
 * Body: { snapshotId: string }
 *
 * Restores the portfolio to exactly the raw ledger state captured right
 * before an execution — full trade history included, not just the balance.
 */
import { NextResponse } from "next/server";
import { undoTransaction } from "@/lib/portfolio/engines/transaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { snapshotId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.snapshotId) {
    return NextResponse.json({ error: "`snapshotId` is required" }, { status: 400 });
  }

  try {
    const restored = undoTransaction(body.snapshotId);
    if (!restored) {
      return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to undo";
    console.error("[portfolio/optimize/undo]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
