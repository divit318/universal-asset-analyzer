import { COMPARISON_CACHE_MAX_AGE_MS, streamComparisonFields } from "@/lib/ai-compare";
import { subscribeGeneration, type BrokerFrame } from "@/lib/ai/report-broker";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/compare/stream
 * Body: { symbols: string[] } (2-5 symbols), { noCache?: boolean }
 *
 * The AI ranked verdict, streamed as **complete fields** rather than one
 * multi-minute wait — mirrors `/api/ai/report`'s protocol exactly (see that
 * route for the full design rationale):
 *
 *     {"type":"field","key":"executiveSummary","data":"…"}   ← seconds
 *     {"type":"field","key":"rankings","data":[…]}            ← near the end
 *     …
 *     {"type":"done","result":{…full ComparisonResult…}}
 *
 * This is ONE generation — the same prompt, same model, same evidence the
 * blocking `POST /api/compare` uses — parsed incrementally so each field
 * appears the instant it's syntactically complete. The final `result` is
 * byte-for-byte what the blocking route would have returned for the same
 * input; streaming only changes *when* the pieces arrive, never what they
 * are (see `lib/ai-compare.ts`'s `finalizeComparison`, shared by both paths).
 *
 * A cold-loading model (the case this whole thing exists for) now shows the
 * user real, growing content instead of one spinner for however long the
 * load takes.
 *
 * Repeat comparisons of the same symbols within the freshness window replay
 * the stored narrative instead of regenerating (see streamComparisonFields);
 * `noCache: true` — the Re-analyze button — forces a fresh generation.
 */
export async function POST(request: Request) {
  let body: { symbols?: string[]; noCache?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbols = (Array.isArray(body.symbols) ? body.symbols : [])
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(symbols)];

  if (unique.length < 2) {
    return NextResponse.json({ error: "At least two distinct symbols are required" }, { status: 400 });
  }
  if (unique.length > 5) {
    return NextResponse.json({ error: "At most 5 symbols can be compared at once" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          closed = true; // client disconnected
        }
      };

      try {
        // One generation per symbol set, no matter how many tabs asked (the
        // same guarantee /api/ai/report gets from this broker): the first
        // request starts the model call, concurrent ones replay the fields
        // emitted so far and then follow live. `noCache` (the Re-analyze
        // button) forks the key so an explicit regeneration never attaches to
        // — or is polluted by — a cache-replaying run already in flight.
        const generationKey = `compare:${body.noCache ? "fresh" : "cached"}:${unique.join(",")}`;
        const producer = async (emit: (frame: BrokerFrame) => void, signal: AbortSignal) => {
          const generator = streamComparisonFields(unique, {
            signal,
            maxAgeMs: body.noCache ? undefined : COMPARISON_CACHE_MAX_AGE_MS,
          });
          for (;;) {
            const next = await generator.next();
            if (next.done) {
              emit({ type: "done", result: next.value });
              break;
            }
            emit({ type: "field", key: next.value.key, data: next.value.value });
          }
        };
        for await (const frame of subscribeGeneration(generationKey, producer, { signal: request.signal })) {
          send(frame);
        }
      } catch (err) {
        if (!request.signal.aborted) {
          send({ type: "error", error: err instanceof Error ? err.message : "Comparison failed" });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
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
