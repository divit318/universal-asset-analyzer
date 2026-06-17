import { NextResponse } from "next/server";
import { listPortfolio, upsertPosition, removePosition } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/portfolio — list all positions. */
export async function GET() {
  try {
    return NextResponse.json({ positions: listPortfolio() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read portfolio";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/portfolio — body { symbol, name, shares, avgCost } upserts a position. */
export async function POST(request: Request) {
  let body: { symbol?: string; name?: string; shares?: number; avgCost?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim();
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });
  if (typeof body.shares !== "number" || body.shares <= 0)
    return NextResponse.json({ error: "`shares` must be a positive number" }, { status: 400 });
  if (typeof body.avgCost !== "number" || body.avgCost < 0)
    return NextResponse.json({ error: "`avgCost` must be a non-negative number" }, { status: 400 });

  try {
    const pos = upsertPosition(
      symbol,
      body.name?.trim() || symbol.toUpperCase(),
      body.shares,
      body.avgCost,
    );
    return NextResponse.json(pos, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save position";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/portfolio?symbol=AAPL — remove a position. */
export async function DELETE(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim();
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });

  try {
    removePosition(symbol);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove position";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
