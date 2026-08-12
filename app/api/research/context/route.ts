import { buildCompanyContext } from "@/lib/ai/context";
import { normalizeSymbol } from "@/lib/market";
import { checkPlatformHealth } from "@/lib/ai/platform-health";
import { loadHistory } from "@/lib/ai/memory";
import { buildModelOptions, pickDefaultModel } from "@/lib/ai/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/context?symbol=AAPL[&sessionId=…]
 *
 * Warms the company context cache and returns the copilot's readiness state:
 * AI-platform health across every provider, the available/default models for
 * the picker, and which data sources came up short — so the UI can render an
 * honest "ready" panel before the first question.
 *
 * With `sessionId`, also returns that session's persisted conversation.
 * Turns were ALWAYS persisted per session (lib/ai/memory.ts) but nothing ever
 * read them back into the UI — the client minted a fresh sessionId on every
 * mount, so a refresh silently discarded the conversation the database still
 * held. The client now keeps the sessionId per symbol and restores from here.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  const sessionId = url.searchParams.get("sessionId")?.trim() || null;
  if (!symbol) {
    return Response.json({ error: "A valid `symbol` query parameter is required" }, { status: 400 });
  }

  const [health, ctxResult] = await Promise.all([
    checkPlatformHealth(),
    buildCompanyContext(symbol).then(
      (ctx) => ({ ctx, error: null as string | null }),
      (err: unknown) => ({ ctx: null, error: err instanceof Error ? err.message : "lookup failed" }),
    ),
  ]);

  if (!ctxResult.ctx) {
    return Response.json({ error: ctxResult.error }, { status: 404 });
  }

  // The restored conversation, when the client presents its remembered
  // session. Best-effort: an unreadable history restores an empty thread,
  // never blocks readiness.
  let history: { role: "user" | "assistant"; content: string }[] = [];
  if (sessionId) {
    try {
      history = loadHistory(sessionId).map((m) => ({ role: m.role, content: m.content }));
    } catch {
      history = [];
    }
  }

  const ctx = ctxResult.ctx;
  return Response.json({
    symbol: ctx.symbol,
    name: ctx.name,
    builtAt: ctx.builtAt,
    onWatchlist: ctx.onWatchlist,
    warnings: ctx.warnings,
    history,
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
