import { NextResponse } from "next/server";
import { getKnowledgeGraph, explainConnection } from "@/lib/knowledge-graph";
import type { GraphScope } from "@/lib/knowledge-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SCOPES: GraphScope[] = ["symbol", "portfolio", "watchlist", "sector"];

/**
 * GET /api/knowledge-graph/explain?scope=symbol&id=AAPL&from=<nodeId>&to=<nodeId>
 * "Why is this connected?" — deterministic path + AI narrative between two
 * nodes in the graph currently loaded for the given scope.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scope = (params.get("scope") ?? "symbol") as GraphScope;
  const id = params.get("id")?.trim();
  const from = params.get("from")?.trim();
  const to = params.get("to")?.trim();

  if (!VALID_SCOPES.includes(scope)) {
    return NextResponse.json({ error: "Invalid `scope`" }, { status: 400 });
  }
  if (!id || !from || !to) {
    return NextResponse.json({ error: "`id`, `from`, and `to` query parameters are required" }, { status: 400 });
  }

  try {
    const graph = await getKnowledgeGraph(scope, scope === "symbol" ? id.toUpperCase() : id);
    const explanation = await explainConnection(graph.nodes, graph.edges, from, to);
    return NextResponse.json({ explanation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Connection explanation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
