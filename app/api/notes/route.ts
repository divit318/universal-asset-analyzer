import { NextResponse } from "next/server";
import { addNote, deleteNote, listNotes } from "@/lib/db";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/notes?symbol=AAPL — list saved notes for a symbol. */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol) return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  try {
    return NextResponse.json({ notes: listNotes(symbol) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** POST /api/notes — body { symbol, content } saves a note. */
export async function POST(request: Request) {
  let body: { symbol?: string; content?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const symbol = normalizeSymbol(body.symbol);
  const content = body.content?.trim();
  if (!symbol || !content) {
    return NextResponse.json({ error: "A valid `symbol` and `content` are required" }, { status: 400 });
  }
  try {
    return NextResponse.json(addNote(symbol, content), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** DELETE /api/notes?id=42 — delete a note by id. */
export async function DELETE(request: Request) {
  const idStr = new URL(request.url).searchParams.get("id");
  const id = idStr ? Number(idStr) : NaN;
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Valid `id` is required" }, { status: 400 });
  }
  try {
    deleteNote(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
