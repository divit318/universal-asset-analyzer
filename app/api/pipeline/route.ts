/**
 * The Idea Pipeline (§4.5) — one view over every tracked symbol by lifecycle
 * stage.
 *
 * GET   /api/pipeline           → the board rows (watchlist ∪ current holdings).
 * PATCH /api/pipeline {symbol,stage} → move an idea to a stage; returns whether
 *        it actually changed so the client raises a Journal prompt exactly once.
 *
 * The holdings come from `listRawHoldings()` — the same call the Holdings tab
 * renders — rather than from a second read of the lot ledger, so "Owned" and
 * "Holdings" cannot answer the same question differently. Which of those
 * holdings is an idea at all is `isPipelineSymbol()`, and the stage the board
 * shows is `effectiveStage()`: the ledger decides `owned`, never the stored
 * stage. Stages are descriptive — nothing here gates any action.
 *
 * Always portfolio 1: the Pipeline tab is clamped away for non-main portfolios
 * (see VIEW_ONLY_TABS in app/portfolio/page.tsx), which are read-only.
 */
import { NextResponse } from "next/server";
import { listWatchlist, setIdeaStage } from "@/lib/db";
import { listRawHoldings } from "@/lib/portfolio/store";
import { isIdeaStage, isPipelineSymbol, buildPipelineRows } from "@/lib/idea-stage";
import type { PipelineRow } from "@/lib/idea-stage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { PipelineRow };

/**
 * How much of the portfolio the board is answerable for, so the Owned count can
 * be reconciled against the Holdings count on the page rather than in someone's
 * head: the difference is exactly the holdings no market quotes.
 */
export interface PipelineCoverage {
  /** Every holding on the Holdings tab, both ledgers. */
  holdings: number;
  /** Those with a quoted symbol — the set the Owned column must equal. */
  quoted: number;
}

export interface PipelineResponse {
  rows: PipelineRow[];
  coverage: PipelineCoverage;
}

export async function GET() {
  try {
    const holdings = listRawHoldings();
    const rows = buildPipelineRows({
      tracked: listWatchlist(),
      holdings,
    });

    const response: PipelineResponse = {
      rows,
      coverage: {
        holdings: holdings.length,
        quoted: holdings.filter((h) => isPipelineSymbol(h.symbol)).length,
      },
    };
    return NextResponse.json(response);
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
