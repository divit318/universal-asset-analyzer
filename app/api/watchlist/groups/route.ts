/**
 * Named watchlists.
 *
 * GET    /api/watchlist/groups                  → every list, in display order
 * POST   /api/watchlist/groups                  → create, or duplicate an existing one
 * PATCH  /api/watchlist/groups                  → rename / set benchmark / reorder
 * DELETE /api/watchlist/groups?id=2             → delete (never the last one)
 *
 * Membership lives on `/api/watchlist` (which takes an optional `group`), because
 * adding a symbol to a list is an operation on the symbol, not on the list.
 */
import { NextResponse } from "next/server";
import { isValidSymbol } from "@/lib/market";
import {
  createWatchlistGroup,
  deleteWatchlistGroup,
  duplicateWatchlistGroup,
  listWatchlistGroups,
  reorderWatchlistGroups,
  updateWatchlistGroup,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAME = 60;

/** A list name has to be visible and bounded; everything else is the user's business. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > MAX_NAME) return null;
  return name;
}

export async function GET() {
  try {
    return NextResponse.json({ groups: listWatchlistGroups() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read watchlists";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = cleanName(body.name);
  if (!name) {
    return NextResponse.json(
      { error: `\`name\` must be a non-empty string of at most ${MAX_NAME} characters` },
      { status: 400 },
    );
  }

  // A benchmark is a ticker; validate it as one rather than storing free text
  // that would later fail silently in the quote batch.
  let benchmark: string | null = null;
  if (body.benchmark != null && body.benchmark !== "") {
    if (typeof body.benchmark !== "string" || !isValidSymbol(body.benchmark.trim().toUpperCase())) {
      return NextResponse.json({ error: "`benchmark` must be a valid ticker, or null" }, { status: 400 });
    }
    benchmark = body.benchmark.trim().toUpperCase();
  }

  try {
    if (body.duplicateOf != null) {
      const sourceId = Number(body.duplicateOf);
      if (!Number.isInteger(sourceId)) {
        return NextResponse.json({ error: "`duplicateOf` must be a watchlist id" }, { status: 400 });
      }
      const copy = duplicateWatchlistGroup(sourceId, name);
      if (!copy) return NextResponse.json({ error: "That watchlist no longer exists" }, { status: 404 });
      return NextResponse.json({ group: copy }, { status: 201 });
    }
    return NextResponse.json({ group: createWatchlistGroup(name, benchmark) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create the watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Reorder is a whole-collection operation, so it takes no id.
  if (Array.isArray(body.order)) {
    const ids = body.order.map(Number);
    if (ids.some((n) => !Number.isInteger(n))) {
      return NextResponse.json({ error: "`order` must be an array of watchlist ids" }, { status: 400 });
    }
    try {
      reorderWatchlistGroups(ids);
      return NextResponse.json({ ok: true, groups: listWatchlistGroups() });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
    }
  }

  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "`id` must be a watchlist id" }, { status: 400 });
  }

  const patch: { name?: string; benchmark?: string | null } = {};
  if ("name" in body) {
    const name = cleanName(body.name);
    if (!name) {
      return NextResponse.json(
        { error: `\`name\` must be a non-empty string of at most ${MAX_NAME} characters` },
        { status: 400 },
      );
    }
    patch.name = name;
  }
  if ("benchmark" in body) {
    const v = body.benchmark;
    if (v === null || v === "") patch.benchmark = null;
    else if (typeof v === "string" && isValidSymbol(v.trim().toUpperCase())) {
      patch.benchmark = v.trim().toUpperCase();
    } else {
      return NextResponse.json({ error: "`benchmark` must be a valid ticker, or null to clear it" }, { status: 400 });
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 });
  }

  try {
    updateWatchlistGroup(id, patch);
    return NextResponse.json({ ok: true, groups: listWatchlistGroups() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "`id` must be a watchlist id" }, { status: 400 });
  }
  try {
    const result = deleteWatchlistGroup(id);
    if (!result.deleted) {
      // 409, not 500: refusing to delete the last list is a rule, not a failure.
      return NextResponse.json({ error: result.reason ?? "Could not delete" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      movedSymbols: result.movedSymbols,
      groups: listWatchlistGroups(),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
