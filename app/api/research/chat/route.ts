import { isValidSymbol } from "@/lib/market";
import { detectAssetClass } from "@/lib/asset-class";
import { buildCompanyContext } from "@/lib/ai/context";
import { classifyAiError } from "@/lib/ai/errors";
import { checkPlatformHealth, unavailableMessage } from "@/lib/ai/platform-health";
import { specForInstalled } from "@/lib/ai/models";
import { pickModel } from "@/lib/ai/router";
import { runTaskChat, runTaskStream } from "@/lib/ai/orchestrator";
import type { TaskType } from "@/lib/ai/task-registry";
import { buildBlocks, classifyIntent, selectBlocks } from "@/lib/ai/retrieval";
import { buildMessages } from "@/lib/ai/prompt";
import { getAction, suggestFollowUps } from "@/lib/ai/actions";
import { extractCitations, loadHistory, persistTurn } from "@/lib/ai/memory";
import { verifyGrounding } from "@/lib/ai/grounding";
import type { ChatRequest, ChatStreamEvent, ResearchIntent, PortfolioContextForAI, ContextBlock } from "@/lib/ai/types";
import { getFundProfile, getHistory, getMacroSummary } from "@/lib/yahoo";
import { computeFundScore } from "@/lib/fund-scoring";
import { fundChatPrompt } from "@/lib/ai-fund-research";
import { computeCryptoScore } from "@/lib/crypto-scoring";
import { cryptoChatPrompt } from "@/lib/ai-crypto-research";
import { computeCommodityScore } from "@/lib/commodity-scoring";
import { commodityChatPrompt } from "@/lib/ai-commodity-research";
import { COMMODITY_BENCHMARK_SYMBOL } from "@/lib/research-engines/commodity";
import { computeForexScore, DOLLAR_INDEX_SYMBOL } from "@/lib/forex-scoring";
import { forexChatPrompt } from "@/lib/ai-forex-research";
import { macroChatPrompt } from "@/lib/ai-macro-research";
import type { NewsItem, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const line = (ev: ChatStreamEvent) => encoder.encode(JSON.stringify(ev) + "\n");

/**
 * Stream one non-equity chat turn as NDJSON — the shared delivery for the
 * fund/crypto/commodity/forex/macro paths below.
 *
 * These paths used to buffer the whole answer through runPromptWithMeta and
 * emit ONE delta (a notification handoff on a portfolio ETF measured 25.8s to
 * first content, Phase-4 audit). Same prompt builders, same evidence, same
 * grounding verification — the only change is real token delivery via the
 * platform's streaming path.
 */
function streamSimpleChat(opts: {
  taskType: TaskType;
  prompt: string;
  /** What verifyGrounding checks the answer against. */
  evidence: unknown;
  followUps: string[];
  symbol: string;
  question: string;
  sessionId: string | undefined;
  signal: AbortSignal;
}): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      try {
        const turns = runTaskStream(opts.taskType, opts.prompt, { maxTokens: 800, signal: opts.signal });
        let step = await turns.next();
        while (!step.done) {
          answer += step.value;
          controller.enqueue(line({ type: "delta", text: step.value }));
          step = await turns.next();
        }
        const model = step.value;

        const grounding = verifyGrounding(answer, JSON.stringify(opts.evidence), {});
        controller.enqueue(line({ type: "meta", citations: [], suggestions: opts.followUps, model, grounding }));

        if (opts.sessionId && answer.trim()) {
          try {
            persistTurn(opts.sessionId, opts.symbol, opts.question, {
              content: answer.trim(),
              citations: [],
              reasoning: "",
              grounding,
            });
          } catch {
            /* persistence is non-critical */
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const message = err instanceof Error ? err.message : "Generation failed";
          controller.enqueue(line({ type: "error", message, code: "internal" }));
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

const FUND_FOLLOWUPS = [
  "What are the top holdings?",
  "How does the expense ratio compare to peers?",
  "Is this fund concentrated or diversified?",
];

/**
 * Fund-native chat path: no equity CompanyContext/retrieval/citations — just
 * fund data, token-streamed through streamSimpleChat above.
 */
async function respondAsFund(
  symbol: string,
  name: string,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const [fund, priceHistory] = await Promise.all([getFundProfile(symbol), getHistory(symbol, 730)]);
  const score = computeFundScore(fund, priceHistory);
  return streamSimpleChat({
    taskType: "fund-research",
    prompt: fundChatPrompt({ symbol, name, fund, score, history, question }),
    evidence: { fund, score },
    followUps: FUND_FOLLOWUPS,
    symbol,
    question,
    sessionId,
    signal,
  });
}

const CRYPTO_FOLLOWUPS = [
  "How is this performing vs BTC?",
  "What's the risk-adjusted return?",
  "How far is this from its recent high?",
];

/**
 * Crypto-native chat path: market-data only (momentum/relative-strength/
 * risk), no equity CompanyContext/retrieval/citations — same shape as
 * respondAsFund above.
 */
async function respondAsCrypto(
  quote: Quote,
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const symbol = quote.symbol;
  const isBtc = symbol.toUpperCase().startsWith("BTC-USD");
  const [priceHistory, btcHistory] = await Promise.all([
    getHistory(symbol, 730),
    isBtc ? Promise.resolve([]) : getHistory("BTC-USD", 730),
  ]);
  const score = computeCryptoScore(symbol, priceHistory, btcHistory.length > 0 ? btcHistory : null);
  const facts = {
    symbol,
    name: quote.name,
    price: quote.price,
    currency: quote.currency,
    changePercent: quote.changePercent,
    marketCap: quote.marketCap,
  };
  return streamSimpleChat({
    taskType: "crypto-research",
    prompt: cryptoChatPrompt({ facts, score, history, question }),
    evidence: { facts, score },
    followUps: CRYPTO_FOLLOWUPS,
    symbol,
    question,
    sessionId,
    signal,
  });
}

const COMMODITY_FOLLOWUPS = [
  "What does recent news suggest about supply/demand?",
  "How is this performing vs the commodity index?",
  "What's the risk-adjusted return?",
];

/**
 * Commodity-native chat path: market-data + news (for supply/demand
 * context), no equity CompanyContext retrieval/citations — same shape as
 * respondAsCrypto above. `news` is ctx.news (already fetched by
 * buildCompanyContext for every symbol), not a second fetch.
 */
async function respondAsCommodity(
  quote: Quote,
  news: NewsItem[],
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const symbol = quote.symbol;
  const [priceHistory, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    getHistory(COMMODITY_BENCHMARK_SYMBOL, 730),
  ]);
  const score = computeCommodityScore(priceHistory, benchmarkHistory.length > 0 ? benchmarkHistory : null);
  const facts = {
    symbol,
    name: quote.name,
    price: quote.price,
    currency: quote.currency,
    changePercent: quote.changePercent,
  };
  return streamSimpleChat({
    taskType: "commodity-research",
    prompt: commodityChatPrompt({ facts, score, news, history, question }),
    evidence: { facts, score, news },
    followUps: COMMODITY_FOLLOWUPS,
    symbol,
    question,
    sessionId,
    signal,
  });
}

const FOREX_FOLLOWUPS = [
  "What does recent news suggest about central banks/rates?",
  "How is this performing vs the US Dollar Index?",
  "What's the risk-adjusted return?",
];

/**
 * Forex-native chat path: market-data + news (for macro context), no equity
 * CompanyContext retrieval/citations — same shape as respondAsCommodity
 * above. `news` is ctx.news, not a second fetch.
 */
async function respondAsForex(
  quote: Quote,
  news: NewsItem[],
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const symbol = quote.symbol;
  const isDxy = symbol.toUpperCase() === DOLLAR_INDEX_SYMBOL.toUpperCase();
  const [priceHistory, benchmarkHistory] = await Promise.all([
    getHistory(symbol, 730),
    isDxy ? Promise.resolve([]) : getHistory(DOLLAR_INDEX_SYMBOL, 730),
  ]);
  const score = computeForexScore(symbol, priceHistory, benchmarkHistory.length > 0 ? benchmarkHistory : null);
  const facts = {
    symbol,
    name: quote.name,
    price: quote.price,
    currency: quote.currency,
    changePercent: quote.changePercent,
  };
  return streamSimpleChat({
    taskType: "forex-research",
    prompt: forexChatPrompt({ facts, score, news, history, question }),
    evidence: { facts, score, news },
    followUps: FOREX_FOLLOWUPS,
    symbol,
    question,
    sessionId,
    signal,
  });
}

const MACRO_FOLLOWUPS = [
  "Is the yield curve inverted right now?",
  "Is the curve steepening or flattening?",
  "What does recent news suggest about inflation or Fed policy?",
];

/**
 * Macro-native chat path: the full 4-tenor yield curve + news, no equity
 * CompanyContext retrieval/citations — same shape as respondAsForex above,
 * except the "symbol" searched doesn't change what's fetched (always the
 * whole curve, not just the one tenor searched).
 */
async function respondAsMacro(
  symbol: string,
  news: NewsItem[],
  question: string,
  history: { role: "user" | "assistant"; content: string }[],
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const summary = await getMacroSummary();
  return streamSimpleChat({
    taskType: "macro-research",
    prompt: macroChatPrompt({ summary, news, history, question }),
    evidence: { summary, news },
    followUps: MACRO_FOLLOWUPS,
    symbol,
    question,
    sessionId,
    signal,
  });
}

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
 * the model as newline-delimited JSON events, finishing with a `meta` event
 * (citations + suggested follow-ups) and persisting the exchange.
 */
export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  if (!symbol || !isValidSymbol(symbol)) {
    return Response.json({ error: "A valid `symbol` is required (e.g. AAPL)" }, { status: 400 });
  }

  const action = getAction(body.action);
  const lastUser = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  const question = lastUser?.content?.trim() || action?.label || "";
  if (!question && !action) {
    return Response.json({ error: "A question or action is required" }, { status: 400 });
  }

  // Resolve a model up-front so we can fail with a clean status before streaming.
  const { reachable, models } = await checkPlatformHealth();
  if (!reachable) {
    return Response.json(
      { error: unavailableMessage("the research copilot"), code: "ai_unavailable" },
      { status: 503 },
    );
  }
  // A user-picked model is honored strictly; otherwise the Router decides.
  const pinnedModel = body.model && models.includes(body.model) ? body.model : undefined;
  const model = pinnedModel ?? (await pickModel("company-research"));
  if (!model) {
    return Response.json(
      { error: unavailableMessage("the research copilot"), code: "model_missing" },
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

  const history = body.sessionId ? loadHistory(body.sessionId) : (body.messages ?? []);

  // Funds have no P/E, no filings, no analyst coverage — routing them through
  // the equity retrieval/prompt pipeline would just produce a context full of
  // nulls. Branch to the fund-native path before any equity-specific work.
  const assetClass = detectAssetClass(ctx.quote);
  if (assetClass === "fund") {
    return respondAsFund(symbol, ctx.name, question, history, body.sessionId, request.signal);
  }
  if (assetClass === "crypto") {
    return respondAsCrypto(ctx.quote, question, history, body.sessionId, request.signal);
  }
  if (assetClass === "commodity") {
    return respondAsCommodity(ctx.quote, ctx.news, question, history, body.sessionId, request.signal);
  }
  if (assetClass === "forex") {
    return respondAsForex(ctx.quote, ctx.news, question, history, body.sessionId, request.signal);
  }
  if (assetClass === "macro") {
    return respondAsMacro(symbol, ctx.news, question, history, body.sessionId, request.signal);
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

      try {
        // The platform owns model choice, generation settings, fallback, and the
        // separation of reasoning from answer. This route supplies a task name
        // and a conversation — it never touches a provider directly.
        const turns = runTaskChat("company-research", messages, {
          model: pinnedModel,
          signal: request.signal,
          onReasoning: (t) => {
            reasoning += t;
            controller.enqueue(line({ type: "reasoning", text: t }));
          },
        });

        // Drive the generator by hand rather than with `for await`, which
        // discards a generator's return value — here that is the id of the model
        // that actually answered, which may differ from our up-front pick if the
        // Router had to fall back.
        let step = await turns.next();
        while (!step.done) {
          answer += step.value;
          controller.enqueue(line({ type: "delta", text: step.value }));
          step = await turns.next();
        }
        const answeredBy = step.value;

        const citations = extractCitations(answer, ctx);
        // Verify the answer against the exact evidence it was handed: trace
        // every figure back to a dossier number and confirm cited sources are
        // real. Replaces cosmetic "confidence" with a signal from the output.
        const grounding = verifyGrounding(
          answer,
          blocks.map((b) => b.body).join("\n\n"),
          { allowedTags: blocks.map((b) => b.source) },
        );
        controller.enqueue(
          line({ type: "meta", citations, suggestions, model: answeredBy, grounding }),
        );

        if (body.sessionId && answer.trim()) {
          try {
            persistTurn(body.sessionId, symbol, question, {
              content: answer.trim(),
              citations,
              reasoning: reasoning.trim(),
              grounding,
            });
          } catch {
            /* persistence is non-critical */
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Client navigated away / cancelled — just close.
        } else {
          // classifyAiError sees through the Router's exhausted-candidates
          // wrapper, so a missing key that failed the whole chain still maps
          // to the recovery affordance rather than a generic failure.
          const classified = classifyAiError(err);
          const code = classified.category === "no_api_key" ? "ai_unavailable" : "internal";
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
