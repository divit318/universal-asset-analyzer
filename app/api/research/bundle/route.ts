import { detectAssetClass } from "@/lib/asset-class";
import { isValidSymbol, normalizeSymbol } from "@/lib/market";
import { getQuote } from "@/lib/yahoo";
import { researchPlan } from "@/lib/research-bundle";
import { runPlan } from "@/lib/platform/orchestrator";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/research/bundle?symbol=AAPL
 *
 * The research page's single data call. Streams NDJSON — one JSON object per
 * line, flushed the instant each step of the orchestrated plan settles:
 *
 *     {"type":"step","id":"quote","status":"ok","data":{…}}      ← ~150ms
 *     {"type":"step","id":"history","status":"ok","data":[…]}    ← ~400ms
 *     {"type":"step","id":"news","status":"failed","error":"…"}  ← degrades alone
 *     {"type":"step","id":"peers","status":"ok","data":{…}}      ← ~4s, arrives last
 *     {"type":"done","durationMs":4210,"partial":true}
 *
 * This is what replaces the old four-stage waterfall. Every independent request
 * starts at t=0; the browser paints each section the moment its data lands
 * rather than waiting for the slowest one; and a failed section (news, filings)
 * arrives as an error for that section only, leaving the other eleven to render
 * normally.
 *
 * Cancellation is wired end-to-end: when the user searches a new symbol the
 * client aborts this request, `request.signal` fires, the plan is cancelled, and
 * the in-flight Yahoo/SEC calls are torn down rather than left to complete
 * unobserved and overwrite fresher state.
 */
export async function GET(request: Request) {
  const symbol = normalizeSymbol(new URL(request.url).searchParams.get("symbol"));
  if (!symbol || !isValidSymbol(symbol)) {
    return NextResponse.json(
      { error: "A valid `symbol` query parameter is required (e.g. AAPL)" },
      { status: 400 },
    );
  }

  // The quote gates the whole page, so resolve it before opening the stream:
  // a bad ticker should be an honest 404, not a 200 whose first streamed line
  // happens to be an error the client has to special-case.
  let quote;
  try {
    quote = await getQuote(symbol);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote lookup failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }

  const assetClass = detectAssetClass(quote);
  // Same predicate the research page uses (app/research/page.tsx) — the bundle
  // must not disagree with the UI about which sections an asset even has.
  const isEquity = !quote.assetType || quote.assetType === "EQUITY";

  const encoder = new TextEncoder();
  const steps = researchPlan(symbol, { isEquity });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // The client went away mid-stream. Stop writing; the plan's own
          // cancellation (below) tears the provider work down.
          closed = true;
        }
      };

      // The quote is already resolved — send it immediately rather than making
      // the client wait for the plan to re-derive it. (The plan still includes
      // it; the platform's cache makes that second call free.)
      send({ type: "step", id: "quote", status: "ok", data: quote });
      send({ type: "meta", assetClass, isEquity });

      try {
        const plan = await runPlan(steps, {
          concurrency: 8,
          signal: request.signal,
          onStep: (result) => {
            if (result.id === "quote") return; // already sent above
            send({
              type: "step",
              id: result.id,
              status: result.status,
              data: result.status === "ok" ? result.value : null,
              error: result.error,
              durationMs: result.durationMs,
            });
          },
        });

        send({ type: "done", durationMs: plan.durationMs, partial: plan.partial });
      } catch (err) {
        // Only a required-step failure or an abort reaches here.
        if (!request.signal.aborted) {
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Research plan failed",
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client disconnecting */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Progressive rendering depends on bytes actually reaching the browser as
      // they're written, not being held back by an intermediary buffer.
      "X-Accel-Buffering": "no",
    },
  });
}
