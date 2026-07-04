import { buildCompanyContext } from "@/lib/ai/context";
import {
  ModelMissingError,
  OllamaUnavailableError,
  checkHealth,
  createThinkingSplitter,
  streamChat,
} from "@/lib/ai/ollama";
import { specForInstalled, pickDefaultModel } from "@/lib/ai/models";
import { buildBlocks, classifyIntent, selectBlocks } from "@/lib/ai/retrieval";
import { buildMessages } from "@/lib/ai/prompt";
import { getAction, suggestFollowUps } from "@/lib/ai/actions";
import { extractCitations, loadHistory, persistTurn } from "@/lib/ai/memory";
import type { ChatRequest, ChatStreamEvent, ResearchIntent, PortfolioContextForAI, ContextBlock } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const line = (ev: ChatStreamEvent) => encoder.encode(JSON.stringify(ev) + "\n");

function buildPortfolioContextBlock(ctx: PortfolioContextForAI): ContextBlock {
  const lines: string[] = [
    `Investment objective: ${ctx.objective.replace(/_/g, " ")}`,
    `Portfolio positions: ${ctx.holdingSymbols.length} holdings`,
  ];
  if (ctx.holdingSymbols.length > 0) {
    lines.push(`Holdings: ${ctx.holdingSymbols.slice(0, 10).join(", ")}${ctx.holdingSymbols.length > 10 ? ` (+${ctx.holdingSymbols.length - 10} more)` : ""}`);
  }
  if (ctx.sectorWeights.length > 0) {
    const top = ctx.sectorWeights.slice(0, 5);
    lines.push(`Top sector weights: ${top.map((s) => `${s.sector}: ${s.weight.toFixed(1)}%`).join(", ")}`);
  }
  if (ctx.missingSectors.length > 0) lines.push(`Missing sectors (zero exposure): ${ctx.missingSectors.join(", ")}`);
  if (ctx.overweightSectors.length > 0) lines.push(`Overweight sectors: ${ctx.overweightSectors.join(", ")}`);
  if (ctx.fitScore != null) {
    lines.push(`Portfolio fit score for this stock: ${ctx.fitScore}/100 (${ctx.fitTier ?? ""})`);
  }
  if (ctx.fitReasons?.length) lines.push(`Fit reasons: ${ctx.fitReasons.join("; ")}`);
  if (ctx.isInPortfolio != null) lines.push(`Currently held in portfolio: ${ctx.isInPortfolio ? "YES — already a holding" : "No — new position"}`);
  if (ctx.suggestedAllocationPct != null) {
    const amt = ctx.suggestedAmount != null ? ` (~$${Math.round(ctx.suggestedAmount).toLocaleString()})` : "";
    lines.push(`Suggested position size: ${ctx.suggestedAllocationPct.toFixed(1)}% of portfolio${amt}`);
  }
  if (ctx.concentrationWarning) lines.push(`Concentration warning: adding this would create high sector concentration`);
  return {
    id: "portfolio",
    source: "portfolio:context",
    heading: "User Portfolio Context",
    body: lines.join("\n"),
    priority: 90,
  };
}

/**
 * POST /api/research/chat — the streaming Chat API Layer.
 *
 * Orchestrates the eight layers per turn: build/reuse the company context,
 * classify intent + retrieve the relevant evidence under a token budget,
 * construct the prompt with compressed history, then stream the answer from
 * Ollama as newline-delimited JSON events, finishing with a `meta` event
 * (citations + suggested follow-ups) and persisting the exchange.
 */
export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const SYMBOL_RE = /^[A-Z0-9.\-]{1,12}$/;
  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !SYMBOL_RE.test(symbol)) {
    return Response.json({ error: "A valid `symbol` is required (e.g. AAPL)" }, { status: 400 });
  }

  const action = getAction(body.action);
  const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() || action?.label || "";
  if (!question && !action) {
    return Response.json({ error: "A question or action is required" }, { status: 400 });
  }

  // Resolve a model up-front so we can fail with a clean status before streaming.
  const { reachable, models } = await checkHealth();
  if (!reachable) {
    return Response.json(
      { error: new OllamaUnavailableError().message, code: "ollama_unavailable" },
      { status: 503 },
    );
  }
  const model = body.model && models.includes(body.model)
    ? body.model
    : pickDefaultModel(models);
  if (!model) {
    return Response.json(
      { error: "No Ollama models are installed. Run `ollama pull qwen3` (or mistral).", code: "model_missing" },
      { status: 503 },
    );
  }

  // Build context (quote required). A bad symbol fails fast, before streaming.
  let ctx;
  try {
    ctx = await buildCompanyContext(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not load company data";
    return Response.json({ error: message }, { status: 404 });
  }

  const spec = specForInstalled(model);
  const intents: ResearchIntent[] = action
    ? Array.from(new Set([...action.intents, ...classifyIntent(question)]))
    : classifyIntent(question);

  // Retrieval: evidence blocks selected + budgeted to ~30% of the window.
  const dossierBudget = Math.min(4000, Math.max(1500, Math.round(spec.contextWindow * 0.3)));
  const blocks = selectBlocks(buildBlocks(ctx), intents, dossierBudget);

  // Prepend portfolio context block when available — always included regardless of token budget.
  const portfolioAware = !!(body.portfolioContext?.hasPortfolio);
  if (portfolioAware) {
    blocks.unshift(buildPortfolioContextBlock(body.portfolioContext!));
  }

  const history = body.sessionId ? loadHistory(body.sessionId) : (body.messages ?? []);
  const messages = buildMessages({
    symbol: ctx.symbol,
    name: ctx.name,
    blocks,
    asOf: ctx.builtAt,
    history,
    question,
    action,
    portfolioAware,
  });

  const suggestions = suggestFollowUps(intents, action);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      let reasoning = "";
      const splitter = createThinkingSplitter({
        onAnswer: (t) => {
          answer += t;
          controller.enqueue(line({ type: "delta", text: t }));
        },
        onReasoning: (t) => {
          reasoning += t;
          controller.enqueue(line({ type: "reasoning", text: t }));
        },
      });

      try {
        for await (const delta of streamChat({
          model,
          messages,
          temperature: spec.temperature,
          numCtx: spec.contextWindow,
          signal: request.signal,
        })) {
          splitter.push(delta);
        }
        splitter.end();

        const citations = extractCitations(answer, ctx);
        controller.enqueue(line({ type: "meta", citations, suggestions, model }));

        if (body.sessionId && answer.trim()) {
          try {
            persistTurn(body.sessionId, symbol, question, {
              content: answer.trim(),
              citations,
              reasoning: reasoning.trim(),
            });
          } catch {
            /* persistence is non-critical */
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Client navigated away / cancelled — just close.
        } else {
          const code =
            err instanceof OllamaUnavailableError
              ? "ollama_unavailable"
              : err instanceof ModelMissingError
                ? "model_missing"
                : "internal";
          const message = err instanceof Error ? err.message : "Generation failed";
          controller.enqueue(line({ type: "error", message, code }));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
