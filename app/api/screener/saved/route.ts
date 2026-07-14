import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { deleteSavedScreen, listSavedScreens, saveScreen } from "@/lib/db";
import { getAssetClass, isAssetClassId } from "@/lib/assets/registry";
import { parseFilters } from "@/lib/screener/filter-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/screener/saved?class=<id> — saved screens, optionally scoped to one asset class. */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("class");
  const assetClass = raw && isAssetClassId(raw) ? raw : undefined;
  return NextResponse.json({ screens: listSavedScreens(assetClass) });
}

/**
 * POST /api/screener/saved — create or update.
 * Body: { id?, name, assetClass, templateId, filters, sortKey, sortDir }
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: "Name is too long (80 characters max)" }, { status: 400 });
  }

  if (!isAssetClassId(body.assetClass)) {
    return NextResponse.json(
      { error: `Unknown asset class: ${String(body.assetClass)}` },
      { status: 400 },
    );
  }
  const assetClass = body.assetClass;
  const def = getAssetClass(assetClass);

  const templateId =
    typeof body.templateId === "string" && def.templates.some((t) => t.id === body.templateId)
      ? body.templateId
      : null;

  // Validate the filters against the registry before persisting, so a saved
  // screen can never contain a filter the engine would refuse to honour.
  const filters = parseFilters(assetClass, body.filters);

  const screen = saveScreen({
    id: typeof body.id === "string" && body.id ? body.id : randomUUID(),
    name,
    assetClass,
    templateId,
    filters,
    sortKey: typeof body.sortKey === "string" ? body.sortKey : def.defaultSort.key,
    sortDir: body.sortDir === "asc" ? "asc" : "desc",
  });

  return NextResponse.json({ screen });
}

/** DELETE /api/screener/saved?id=<id> */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "An id is required" }, { status: 400 });
  deleteSavedScreen(id);
  return NextResponse.json({ ok: true });
}
