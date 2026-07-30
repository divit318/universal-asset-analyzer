import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { isIdeaSource } from "@/lib/idea-source";
import type { TargetDirection } from "@/lib/types";
import {
  addToWatchlist,
  getFreshFundamentals,
  listWatchlist,
  listWatchlistByGroup,
  listWatchlistGroups,
  removeFromWatchlist,
  removeSymbolFromGroup,
  targetRevisionCounts,
  updateWatchlistItem,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/watchlist[?group=2] — saved symbols, enriched with cached sector data.
 *
 * Omitting `group` returns every tracked symbol, which is what every non-page
 * caller means and preserves the pre-named-lists contract exactly.
 */
export async function GET(request: Request) {
  try {
    const groupParam = new URL(request.url).searchParams.get("group");
    const groupId = groupParam != null ? Number(groupParam) : null;
    if (groupParam != null && !Number.isInteger(groupId)) {
      return NextResponse.json({ error: "`group` must be a watchlist id" }, { status: 400 });
    }

    // Sector/yield rarely change — tolerate week-old cache rows so the fit
    // scorer gets real inputs instead of scoring every symbol identically.
    const { rows } = getFreshFundamentals(7 * 24 * 60 * 60 * 1000);
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    const base = groupId != null ? listWatchlistByGroup(groupId) : listWatchlist();
    // Revision counts in one query, so the row can show a history affordance
    // without the page issuing 57 follow-up requests.
    const revisions = targetRevisionCounts(base.map((i) => i.symbol));
    const items = base.map((item) => {
      const f = bySymbol.get(item.symbol);
      return {
        ...item,
        sector: f?.sector ?? null,
        dividendYield: f?.dividendYield ?? null,
        targetRevisionCount: revisions.get(item.symbol) ?? 0,
      };
    });
    return NextResponse.json({ items, groups: listWatchlistGroups() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/watchlist — body { symbol, name, group?, source?, sourceDetail? }.
 *
 * `source` is the surface the idea came from (lib/idea-source.ts) and is what
 * makes "why am I seeing this?" answerable on the Pipeline board. An unknown or
 * absent value is stored as NULL — i.e. "origin not recorded" — rather than
 * being defaulted to this route, because a fabricated origin is indistinguishable
 * from a real one on every later read.
 */
export async function POST(request: Request) {
  let body: { symbol?: string; name?: string; group?: number; source?: unknown; sourceDetail?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json({ error: "`symbol` must be a valid ticker (e.g. AAPL)" }, { status: 400 });
  }
  if (body.group != null && !Number.isInteger(Number(body.group))) {
    return NextResponse.json({ error: "`group` must be a watchlist id" }, { status: 400 });
  }

  try {
    const detail = typeof body.sourceDetail === "string" ? body.sourceDetail.trim().slice(0, 120) || null : null;
    const item = addToWatchlist(
      symbol,
      body.name?.trim() || symbol.toUpperCase(),
      body.group != null ? Number(body.group) : undefined,
      isIdeaSource(body.source) ? { source: body.source, detail } : undefined,
    );
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add to watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/watchlist — body { symbol, targetPrice?, targetDirection?, alertPctDrop?, notes? }.
 *
 * Validates rather than coerces: a target of 0, a negative, NaN or a string is
 * rejected outright instead of being written and then dividing into the upside
 * formula as ±Infinity. `null` remains the way to clear a field.
 */
export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
  if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });

  const patch: {
    targetPrice?: number | null;
    targetDirection?: TargetDirection | null;
    alertPctDrop?: number | null;
    notes?: string | null;
    targetNote?: string | null;
  } = {};

  // Rationale for a target change. Attached to the revision row, never to the
  // watchlist row itself — it describes one edit, not the current state.
  if ("targetNote" in body) {
    const v = body.targetNote;
    if (v === null) patch.targetNote = null;
    else if (typeof v === "string") patch.targetNote = v.trim().slice(0, 280) || null;
    else return NextResponse.json({ error: "`targetNote` must be a string or null" }, { status: 400 });
  }

  if ("targetPrice" in body) {
    const v = body.targetPrice;
    if (v === null) patch.targetPrice = null;
    else if (typeof v === "number" && Number.isFinite(v) && v > 0) patch.targetPrice = v;
    else return NextResponse.json({ error: "`targetPrice` must be a number greater than 0, or null to clear it" }, { status: 400 });
  }

  if ("targetDirection" in body) {
    const v = body.targetDirection;
    if (v === null || v === "above" || v === "below") patch.targetDirection = v;
    else return NextResponse.json({ error: "`targetDirection` must be \"above\", \"below\", or null" }, { status: 400 });
  }

  if ("alertPctDrop" in body) {
    const v = body.alertPctDrop;
    if (v === null) patch.alertPctDrop = null;
    else if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 100) patch.alertPctDrop = v;
    else return NextResponse.json({ error: "`alertPctDrop` must be a number between 0 and 100, or null to clear it" }, { status: 400 });
  }

  if ("notes" in body) {
    const v = body.notes;
    if (v === null) patch.notes = null;
    else if (typeof v === "string") patch.notes = v.trim() || null;
    else return NextResponse.json({ error: "`notes` must be a string or null" }, { status: 400 });
  }

  // `targetNote` annotates another change rather than being one, so it does not
  // on its own constitute an update.
  const substantive = Object.keys(patch).filter((k) => k !== "targetNote");
  if (substantive.length === 0) {
    return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 });
  }

  try {
    updateWatchlistItem(symbol, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/**
 * DELETE /api/watchlist?symbol=AAPL[&group=2]
 *
 * With `group`, removes the symbol from that list only; its target, thesis and
 * stage survive as long as it remains in another list. Without `group`, removes
 * it everywhere — the pre-named-lists behaviour.
 */
export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });
  }
  const groupParam = url.searchParams.get("group");
  const groupId = groupParam != null ? Number(groupParam) : null;
  if (groupParam != null && !Number.isInteger(groupId)) {
    return NextResponse.json({ error: "`group` must be a watchlist id" }, { status: 400 });
  }

  try {
    if (groupId != null) {
      const { removedEntirely } = removeSymbolFromGroup(symbol, groupId);
      return NextResponse.json({ ok: true, removedEntirely });
    }
    removeFromWatchlist(symbol);
    return NextResponse.json({ ok: true, removedEntirely: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to remove from watchlist";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
