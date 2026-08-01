import { NextResponse } from "next/server";
import { getKnowledgeGraph, narrateGraph } from "@/lib/knowledge-graph";
import type { GraphScope } from "@/lib/knowledge-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES: GraphScope[] = ["symbol", "portfolio", "watchlist", "sector"];

/**
 * GET /api/knowledge-graph/narrative?scope=portfolio
 * AI read of the current graph state. Every observation cites node ids that
 * exist in the graph; unsupported claims are dropped server-side (see
 * lib/knowledge-graph/narrate.ts). Empty observations = nothing supportable.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = (params.get("scope") ?? "symbol") as GraphScope;
  const id = params.get("id")?.trim() ?? scope;

  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: "Invalid `scope`" }, { status: 400 });
  }

  try {
    const graph = await getKnowledgeGraph(scope, scope === "symbol" ? id.toUpperCase() : id);
    const narrative = await narrateGraph(graph);
    return NextResponse.json({ narrative });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Narrative generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
