/**
 * The Idea Pipeline (§4.5) — one view over every tracked symbol by lifecycle
 * stage.
 *
 * GET   /api/pipeline           → the board rows (watchlist ∪ current holdings).
 * PATCH /api/pipeline {symbol,stage} → move an idea to a stage; returns whether
 *        it actually changed so the client raises a Journal prompt exactly once.
 *
 * Holdings that aren't on the watchlist are merged in as derived `owned` rows so
 * the board reflects the real portfolio without a migration side effect; moving
 * such a row persists it (one pipeline, one object). Stages are descriptive —
 * nothing here gates any action.
 */
import { NextResponse } from "next/server";
import { listWatchlist, listLots, setIdeaStage } from "@/lib/db";
import { aggregateOpenPositions } from "@/lib/portfolio-lots";
import { isIdeaStage, daysInStage } from "@/lib/idea-stage";
import type { IdeaStage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PipelineRow {
  symbol: string;
  name: string;
  stage: IdeaStage;
  daysInStage: number;
  /** True when persisted on the watchlist; false for a held-but-untracked name. */
  tracked: boolean;
  /** True when currently held in the portfolio. */
  held: boolean;
}

const isTicker = (s: string) => !s.toUpperCase().startsWith("CASH-") && /^[A-Z0-9][A-Z0-9.\-]{0,9}$/.test(s.toUpperCase());

export async function GET() {
  try {
    const watchlist = listWatchlist();
    const watched = new Set(watchlist.map((w) => w.symbol.toUpperCase()));

    const open = aggregateOpenPositions(listLots()).filter((p) => p.shares > 1e-9 && isTicker(p.symbol));
    const heldSet = new Set(open.map((p) => p.symbol.toUpperCase()));

    const rows: PipelineRow[] = watchlist.map((w) => ({
      symbol: w.symbol.toUpperCase(),
      name: w.name,
      stage: w.stage,
      daysInStage: daysInStage(w.stageChangedAt, w.addedAt),
      tracked: true,
      held: heldSet.has(w.symbol.toUpperCase()),
    }));

    // Held names not yet on the watchlist show as derived `owned` rows — real,
    // but not persisted until the user moves them.
    for (const p of open) {
      if (!watched.has(p.symbol.toUpperCase())) {
        rows.push({
          symbol: p.symbol.toUpperCase(),
          name: p.name,
          stage: "owned",
          daysInStage: daysInStage(null, p.firstTradeDate),
          tracked: false,
          held: true,
        });
      }
    }

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("[api/pipeline GET]", err);
    return NextResponse.json({ error: "Failed to build the pipeline" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as { symbol?: unknown; stage?: unknown; name?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
    const stage = body.stage;
    const name = typeof body.name === "string" ? body.name : undefined;

    if (!symbol) return NextResponse.json({ error: "`symbol` is required" }, { status: 400 });
    if (!isIdeaStage(stage)) return NextResponse.json({ error: "invalid stage" }, { status: 400 });

    const result = setIdeaStage(symbol, stage, { createIfMissing: true, name });
    return NextResponse.json({ ok: true, symbol, to: stage, from: result.from, changed: result.changed });
  } catch (err) {
    console.error("[api/pipeline PATCH]", err);
    return NextResponse.json({ error: "Failed to update stage" }, { status: 500 });
  }
}
