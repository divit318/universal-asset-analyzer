import { buildCompanyContext } from "@/lib/ai/context";
import { checkHealth } from "@/lib/ai/ollama";
import { buildModelOptions, pickDefaultModel } from "@/lib/ai/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/context?symbol=AAPL
 *
 * Warms the company context cache and returns the copilot's readiness state:
 * Ollama health, the available/default models for the picker, and which data
 * sources came up short — so the UI can render an honest "ready" panel before
 * the first question.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) {
    return Response.json({ error: "A `symbol` query parameter is required" }, { status: 400 });
  }

  const [health, ctxResult] = await Promise.all([
    checkHealth(),
    buildCompanyContext(symbol).then(
      (ctx) => ({ ctx, error: null as string | null }),
      (err: unknown) => ({ ctx: null, error: err instanceof Error ? err.message : "lookup failed" }),
    ),
  ]);

  if (!ctxResult.ctx) {
    return Response.json({ error: ctxResult.error }, { status: 404 });
  }

  const ctx = ctxResult.ctx;
  return Response.json({
    symbol: ctx.symbol,
    name: ctx.name,
    builtAt: ctx.builtAt,
    onWatchlist: ctx.onWatchlist,
    warnings: ctx.warnings,
    coverage: {
      hasProfile: ctx.profile != null,
      hasFundamentals: ctx.snapshot != null,
      hasStatements: ctx.statements != null,
      hasAnalyst: ctx.analyst != null,
      hasPeers: (ctx.peers?.peerCount ?? 0) > 0,
      filings: ctx.filings.length,
      news: ctx.news.length,
    },
    health: {
      reachable: health.reachable,
      defaultModel: pickDefaultModel(health.models),
      models: buildModelOptions(health.models),
    },
  });
}
