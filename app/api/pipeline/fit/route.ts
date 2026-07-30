/**
 * GET /api/pipeline/fit — the research inputs the fit engine needs for every
 * symbol on the Idea Pipeline board.
 *
 * Deliberately a SEPARATE request from `/api/pipeline`:
 *
 *  - the board's structure (who is in which column) is a pure database read and
 *    must stay instant;
 *  - this is a fundamentals + quotes fetch over ~60 symbols, and folding it into
 *    the structure call would make the whole tab wait for the network.
 *
 * The board therefore renders its columns first and layers relevance on when it
 * arrives, exactly as the Watchlist page does.
 *
 * `enrichForFit` is the same function `/api/watchlist/fit` calls, over a symbol
 * set that is the watchlist PLUS any quoted holding that isn't on it — so a name
 * you own but never tracked is scored too, and so a symbol appearing on both
 * surfaces is scored from identical inputs. The fit score itself is computed
 * client-side from these inputs by `computePortfolioFit`, which is what keeps one
 * engine and one number across every page.
 */
import { NextResponse } from "next/server";
import { listWatchlist } from "@/lib/db";
import { listRawHoldings } from "@/lib/portfolio/store";
import { buildPipelineRows, isPipelineSymbol } from "@/lib/idea-stage";
import { isValidSymbol } from "@/lib/market";
import { enrichForFit, type FitEnrichment } from "@/lib/watchlist-fit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface PipelineFitResponse {
  items: FitEnrichment[];
  /**
   * Symbols on the board that no provider will price for us — futures, forex
   * pairs, index levels. They are listed rather than silently dropped: an idea
   * with no fit score has to read as "not assessable", never as a low score.
   */
  unassessable: string[];
}

export async function GET() {
  try {
    const rows = buildPipelineRows({
      tracked: listWatchlist(),
      holdings: listRawHoldings(),
    });

    // `isValidSymbol` is the fundamentals pipeline's own gate; anything it
    // rejects would come back empty and score as a data-poor neutral, which is
    // indistinguishable from a genuine poor fit. Report those separately.
    const assessable: { symbol: string; name: string }[] = [];
    const unassessable: string[] = [];
    for (const row of rows) {
      if (isPipelineSymbol(row.symbol) && isValidSymbol(row.symbol)) {
        assessable.push({ symbol: row.symbol, name: row.name });
      } else {
        unassessable.push(row.symbol);
      }
    }

    const items = await enrichForFit(assessable);
    return NextResponse.json({ items, unassessable } satisfies PipelineFitResponse);
  } catch (err) {
    console.error("[api/pipeline/fit]", err);
    const message = err instanceof Error ? err.message : "Failed to enrich the pipeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
