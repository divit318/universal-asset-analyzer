import { NextResponse } from "next/server";
import { buildVerdictContext } from "@/lib/ai/context";
import { readPortfolioFacts } from "@/lib/ai/facts";
import { sectionFor, sectionsInOrder } from "@/lib/ai/report-sections";
import { runTaskStream } from "@/lib/ai/orchestrator";
import { JsonFieldStreamer } from "@/lib/ai/streaming-json";
import {
  assembleVerdict,
  cacheVerdict,
  offlineVerdict,
  peekVerdictWithMeta,
  planVerdict,
  verdictCacheParams,
  type InvestmentVerdict,
  type VerdictPlan,
} from "@/lib/ai/verdict";
import { personalizationParams, stableVerdictIdentity } from "@/lib/ai/verdict-params";
import {
  isGenerationActive,
  refreshGeneration,
  subscribeGeneration,
  type BrokerFrame,
} from "@/lib/ai/report-broker";
import { warmDevinAcp } from "@/lib/ai/devin-acp";
import { normalizeSymbol } from "@/lib/market";
import { cacheKey } from "@/lib/platform/registry";
import { REPORT_SECTIONS } from "@/lib/ai/report-sections";
import { timeStage } from "@/lib/debug-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/ai/report?symbol=AAPL
 *
 * The investment verdict, streamed as **complete sections** rather than as one
 * 40-second wait or as a jitter of half-written tokens:
 *
 *     {"type":"manifest","sections":[…],"cache":"miss","timings":{…}}   ← instant
 *     {"type":"section","id":"headline","data":"…"}                     ← ~4s
 *     {"type":"section","id":"thesis","data":"…"}                       ← ~9s
 *     …
 *     {"type":"done","verdict":{…},"grounding":{…},"model":"…"}
 *
 * This is ONE generation, using the exact prompt/context/schema that
 * `/api/ai/verdict` uses (both build the same {@link planVerdict} plan), parsed
 * incrementally so each top-level field is emitted the instant it is
 * syntactically complete.
 *
 * Serves **every** asset class. The plan decides which task, prompt, and
 * evidence block to use — equity, fund, crypto, commodity, forex, or macro —
 * and all six emit the same eight top-level JSON keys, so the same section
 * streamer works for all of them without branching here.
 *
 * ## Phase 2 (2026-08-11) — the pipeline around the model
 *
 *   - **Critical-path context only.** {@link buildVerdictContext} fetches the
 *     five sources the verdict actually consumes instead of the copilot's
 *     nine-plus fan-out; every fetch still goes through the platform's cache +
 *     dedup, so nothing is duplicated for other AI features.
 *   - **Stable cache identity.** The cache key uses
 *     {@link stableVerdictIdentity} — tier/action/objective/gaps — not the raw
 *     personalization, whose volatile numbers (fitScore, free-text reasons)
 *     forked the cache on every market tick.
 *   - **Coalescing.** Concurrent identical requests attach to ONE shared
 *     generation via {@link subscribeGeneration}; a consumer aborting detaches
 *     only itself.
 *   - **Stale-while-revalidate.** A stale-but-servable verdict replays
 *     instantly AND schedules one background regeneration, exactly like the
 *     blocking route's getDataset path.
 *   - **Instrumentation.** The manifest carries context/plan timings and the
 *     cache outcome (`hit-fresh` / `hit-stale` / `miss` / attach mode); the
 *     `done` frame carries total duration. The ai_call ledger continues to
 *     record the model call itself (TTFT, tokens, outcome).
 *
 * Consequences, all of them deliberate:
 *   - The assembled report is **the same object** the non-streamed route would
 *     have returned — no prompt shortened, no context trimmed, no smaller
 *     model substituted, and no extra inference paid for streaming.
 *   - The user reads finished ideas. A section appears only when its string,
 *     array, or object has closed.
 *   - Grounding verification runs on the complete report at the end, exactly
 *     as it does for the non-streamed verdict.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  // The ACP child (the streaming transport to the model) costs ~1s to spawn
  // when cold. Kick it now so that spawn overlaps the context fetches below
  // instead of being paid serially after them. No-op when already running.
  warmDevinAcp();

  // The AI never begins reasoning on incomplete data: the verdict context is
  // assembled first, and only then does generation start. A context failure is
  // a real 404, not a stream of section errors.
  const requestStartedAt = Date.now();
  let ctx;
  try {
    ctx = await timeStage("ai:report", "context", () => buildVerdictContext(symbol));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data for this symbol" },
      { status: 404 },
    );
  }
  const contextMs = Date.now() - requestStartedAt;

  // Planning is the only remaining I/O (asset-class score + fact block). Doing
  // it before the stream opens keeps a data failure a real HTTP error instead
  // of an error event the client has to special-case.
  let plan: VerdictPlan;
  try {
    plan = await timeStage("ai:report", "plan", () => planVerdict(ctx, readPortfolioFacts(url)));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data for this symbol" },
      { status: 404 },
    );
  }
  const planMs = Date.now() - requestStartedAt - contextMs;

  const cacheParams = verdictCacheParams(
    ctx.symbol,
    plan.kind,
    stableVerdictIdentity(personalizationParams(url)),
  );
  const generationKey = cacheKey("aiVerdict", cacheParams);
  const cached = url.searchParams.get("refresh") === "1" ? null : peekVerdictWithMeta(cacheParams);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = Date.now();
      let closed = false;

      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true; // client disconnected
        }
      };
      const close = () => {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      // The manifest goes out immediately so the UI can render every section's
      // header and "generating…" state at once — and it carries the pipeline
      // instrumentation for this request: where the pre-model time went and
      // whether the verdict came from cache, a shared generation, or a fresh one.
      const manifest = (cache: "hit-fresh" | "hit-stale" | "miss") =>
        send({
          type: "manifest",
          symbol: ctx.symbol,
          name: ctx.name,
          assetClass: plan.kind,
          warnings: ctx.warnings,
          cache,
          timings: { contextMs, planMs },
          sections: sectionsInOrder().map((s) => ({ id: s.id, title: s.title, order: s.order })),
        });

      // One machine-parseable line per request outcome, so cache-hit rate,
      // duplicate (attached) rate, and cancellation rate are measurable from
      // the server log alone; the ai_call ledger covers the model call itself.
      const logRequest = (outcome: string, extra: Record<string, unknown> = {}) =>
        console.log(
          "[verdict-request]",
          JSON.stringify({
            at: new Date().toISOString(),
            symbol: ctx.symbol,
            kind: plan.kind,
            outcome,
            contextMs,
            planMs,
            totalMs: Date.now() - requestStartedAt,
            ...extra,
          }),
        );

      /* A cached report replays instantly, section by section, in the same
         protocol a live generation uses — so the client needs no special case
         and a repeat visit costs nothing instead of another generation. */
      if (cached) {
        manifest(cached.freshness === "fresh" ? "hit-fresh" : "hit-stale");
        replayVerdict(cached.verdict, send, startedAt);

        // Inside the SWR window: the user already has their verdict, so the
        // refresh happens behind them — one shared background generation that
        // writes the cache for the NEXT view. Never blocks this response.
        const revalidated = cached.freshness !== "fresh" && !isGenerationActive(generationKey);
        if (revalidated) {
          refreshGeneration(generationKey, (emit, signal) =>
            produceVerdict(plan, cacheParams, ctx.symbol, emit, signal),
          );
        }
        logRequest(cached.freshness === "fresh" ? "hit-fresh" : "hit-stale", { revalidated });
        close();
        return;
      }

      manifest("miss");

      /* Live generation, through the broker: identical concurrent requests
         attach to ONE model call, and this consumer disconnecting only aborts
         the generation if nobody else (including a background refresh) is
         still attached. */
      let attachMode = "started";
      try {
        const frames = subscribeGeneration(
          generationKey,
          (emit, signal) => produceVerdict(plan, cacheParams, ctx.symbol, emit, signal),
          { signal: request.signal },
        );
        for await (const frame of frames) {
          attachMode = frame.attach;
          send(frame);
        }
        logRequest("generated", { attach: attachMode });
      } catch (err) {
        if (!request.signal.aborted) {
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Generation failed",
            completed: [],
            fallback: offlineVerdict(plan),
          });
          logRequest("error", { attach: attachMode, message: err instanceof Error ? err.message : String(err) });
        } else {
          logRequest("cancelled", { attach: attachMode });
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * ONE verdict generation: model stream → per-field section frames → assembled,
 * grounded verdict → cache write → done frame.
 *
 * Runs under the broker, so it executes at most once per cache identity no
 * matter how many consumers are streaming it, and its cache write happens
 * exactly once. The frames it emits are the wire protocol — consumers forward
 * them untouched.
 */
async function produceVerdict(
  plan: VerdictPlan,
  cacheParams: Record<string, string>,
  symbol: string,
  emit: (frame: BrokerFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  const parser = new JsonFieldStreamer();
  let model = "unknown";

  try {
    const generation = runTaskStream(plan.task, plan.prompt, {
      json: true,
      signal,
    });

    for (;;) {
      const next = await generation.next();
      if (next.done) {
        model = next.value ?? model;
        break;
      }

      for (const field of parser.push(next.value)) {
        const spec = sectionFor(field.key);
        if (!spec) continue; // a key the schema doesn't define — ignore, don't render
        emit({
          type: "section",
          id: spec.id,
          title: spec.title,
          order: spec.order,
          data: field.value,
          elapsedMs: Date.now() - startedAt,
        });
      }
    }

    // Anything the model closed right at the end.
    for (const field of parser.end()) {
      const spec = sectionFor(field.key);
      if (!spec) continue;
      emit({
        type: "section",
        id: spec.id,
        title: spec.title,
        order: spec.order,
        data: field.value,
        elapsedMs: Date.now() - startedAt,
      });
    }

    // Coercion + grounding run through the SAME assembler the blocking route
    // uses, so the streamed report is the same object rather than a look-alike:
    // identical defaults for omitted fields, identical claim extraction,
    // identical evidence block.
    const verdict = assembleVerdict(plan, parser.result(), model);

    // Persist under the registry's `aiVerdict` policy so the next view is
    // instant. `cacheVerdict` refuses to store an offline fallback, so an AI
    // outage cannot pin a stale recovery hint for the whole TTL.
    cacheVerdict(cacheParams, verdict, symbol);

    emit({
      type: "done",
      verdict,
      grounding: verdict.grounding,
      model,
      durationMs: Date.now() - startedAt,
    });
  } catch (err) {
    if (!signal.aborted) {
      // Sections that already streamed stay on screen — the client keeps them
      // and marks only the incomplete ones as stopped. A partial report is
      // worth more than a wiped one. `fallback` carries the actionable offline
      // verdict for a client that got nothing usable.
      emit({
        type: "error",
        error: err instanceof Error ? err.message : "Generation failed",
        completed: parser.keys(),
        fallback: parser.keys().length === 0 ? offlineVerdict(plan) : undefined,
      });
    } else {
      throw err; // aborted: let the broker tear down without a synthetic frame
    }
  }
}

/** Replay a finished verdict in the live protocol: schema-ordered sections, then done. */
function replayVerdict(
  verdict: InvestmentVerdict,
  send: (obj: unknown) => void,
  startedAt: number,
): void {
  const record = verdict as unknown as Record<string, unknown>;
  for (const spec of REPORT_SECTIONS) {
    if (record[spec.id] === undefined) continue;
    send({
      type: "section",
      id: spec.id,
      title: spec.title,
      order: spec.order,
      data: record[spec.id],
      elapsedMs: 0,
    });
  }
  send({
    type: "done",
    verdict,
    grounding: verdict.grounding,
    model: verdict.model,
    durationMs: Date.now() - startedAt,
    fromCache: true,
  });
}
