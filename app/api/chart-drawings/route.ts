import { NextResponse } from "next/server";
import { deleteChartDrawing, insertChartDrawing, listChartDrawings, updateChartDrawing } from "@/lib/db";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/chart-drawings?symbol=AAPL&timeframe=1D — list drawings for a symbol+timeframe. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = normalizeSymbol(params.get("symbol"));
  const timeframe = params.get("timeframe")?.trim();
  if (!symbol || !timeframe) {
    return NextResponse.json({ error: "A valid `symbol` and `timeframe` are required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ drawings: listChartDrawings(symbol, timeframe) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** POST /api/chart-drawings — body { symbol, timeframe, type, data } creates a drawing. */
export async function POST(request: Request) {
  let body: { symbol?: string; timeframe?: string; type?: string; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const symbol = normalizeSymbol(body.symbol);
  const timeframe = body.timeframe?.trim();
  const type = body.type?.trim();
  if (!symbol || !timeframe || !type || body.data == null) {
    return NextResponse.json({ error: "A valid `symbol`, `timeframe`, `type`, and `data` are required" }, { status: 400 });
  }
  try {
    const record = insertChartDrawing(symbol, timeframe, type, JSON.stringify(body.data));
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** PATCH /api/chart-drawings — body { id, data } updates a drawing's payload. */
export async function PATCH(request: Request) {
  let body: { id?: number; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!Number.isInteger(body.id) || body.data == null) {
    return NextResponse.json({ error: "A valid `id` and `data` are required" }, { status: 400 });
  }
  try {
    updateChartDrawing(body.id as number, JSON.stringify(body.data));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** DELETE /api/chart-drawings?id=42 — delete a single drawing by id. */
export async function DELETE(request: Request) {
  const idStr = new URL(request.url).searchParams.get("id");
  const id = idStr ? Number(idStr) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid `id` is required" }, { status: 400 });
  }
  try {
    deleteChartDrawing(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
