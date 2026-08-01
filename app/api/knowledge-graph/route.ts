import { isValidSymbol } from "@/lib/market";
import { NextResponse } from "next/server";
import { getKnowledgeGraph } from "@/lib/knowledge-graph";
import { canonicalizeSector } from "@/lib/gics-sectors";
import { SECTOR_ETF_MAP } from "@/lib/sector-rotation";
import type { GraphScope } from "@/lib/knowledge-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES: GraphScope[] = ["symbol", "portfolio", "watchlist", "sector"];

/**
 * GET /api/knowledge-graph?scope=symbol&id=AAPL
 * Investment Knowledge Graph — nodes/edges/insights for a symbol, portfolio,
 * watchlist, or sector, composed from existing UAA engines (never a new
 * scoring/analysis layer). `id` is not required for the singleton scopes
 * (portfolio, watchlist).
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = (params.get("scope") ?? "symbol") as GraphScope;
  const id = params.get("id")?.trim();

  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: "Invalid `scope`; expected symbol, portfolio, watchlist, or sector" }, { status: 400 });
  }
  if (scope === "portfolio" || scope === "watchlist") {
    try {
      return NextResponse.json(await getKnowledgeGraph(scope, scope));
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Knowledge graph build failed" }, { status: 502 });
    }
  }

  if (!id) {
    return NextResponse.json({ error: "An `id` query parameter is required for symbol and sector scopes" }, { status: 400 });
  }
  if (scope === "symbol" && !isValidSymbol(id.toUpperCase())) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }
  let resolvedId = id;
  if (scope === "sector") {
    const canonical = canonicalizeSector(id);
    if (canonical == null || !(canonical in SECTOR_ETF_MAP)) {
      return NextResponse.json({ error: `Unknown sector "${id}"` }, { status: 400 });
    }
    resolvedId = canonical;
  }

  try {
    const graph = await getKnowledgeGraph(scope, scope === "symbol" ? resolvedId.toUpperCase() : resolvedId);
    return NextResponse.json(graph);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Knowledge graph build failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
