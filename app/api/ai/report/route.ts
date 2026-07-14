import { NextResponse } from "next/server";
import { buildCompanyContext } from "@/lib/ai/context";
import { readPortfolioFacts } from "@/lib/ai/facts";
import { buildVerdictPrompt, sectionFor, sectionsInOrder } from "@/lib/ai/report-sections";
import { runTaskStream } from "@/lib/ai/orchestrator";
import { JsonFieldStreamer } from "@/lib/ai/streaming-json";
import { collectClaimText, verifyGrounding } from "@/lib/ai/grounding";
import { normalizeSymbol } from "@/lib/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/ai/report?symbol=AAPL
 *
 * The investment verdict, streamed as **complete sections** rather than as one
 * 40-second wait or as a jitter of half-written tokens:
 *
 *     {"type":"manifest","sections":[…]}                       ← instant: the report's shape
 *     {"type":"section","id":"headline","data":"…"}            ← ~4s
 *     {"type":"section","id":"thesis","data":"…"}              ← ~9s
 *     {"type":"section","id":"catalysts","data":[…]}           ← ~15s
 *     …
 *     {"type":"done","verdict":{…},"grounding":{…},"model":"…"}
 *
 * This is ONE generation, using the exact prompt/context/schema that
 * `/api/ai/verdict` uses (both call `buildVerdictPrompt`), parsed incrementally
 * so each top-level field is emitted the instant it is syntactically complete.
 *
 * Consequences, all of them deliberate:
 *   - The assembled report is **the same object** the non-streamed route would
 *     have returned — not an approximation of it. No prompt was shortened, no
 *     context trimmed, no smaller model substituted, and no extra inference was
 *     paid for the privilege of streaming.
 *   - Total time is unchanged; only *time-to-first-useful-content* improves.
 *   - The user reads finished ideas. A section appears only when its string,
 *     array, or object has closed.
 *   - Grounding verification runs on the complete report at the end, exactly as
 *     it does for the non-streamed verdict.
 *
 * See lib/ai/report-sections.ts for why per-section generation was measured,
 * rejected, and replaced by this.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json({ error: "A valid `symbol` is required" }, { status: 400 });
  }

  // The AI never begins reasoning on incomplete data: the full CompanyContext is
  // assembled first, and only then does generation start. A context failure is a
  // real 404, not a stream of section errors.
  let ctx;
  try {
    ctx = await buildCompanyContext(symbol);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load data for this symbol" },
      { status: 404 },
    );
  }

  const { prompt, evidence } = buildVerdictPrompt(ctx, readPortfolioFacts(url));
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

      // The manifest goes out immediately so the UI can render every section's
      // header and "generating…" state at once — the user sees the shape of the
      // report they're about to get instead of one undifferentiated spinner.
      send({
        type: "manifest",
        symbol: ctx.symbol,
        name: ctx.name,
        warnings: ctx.warnings,
        sections: sectionsInOrder().map((s) => ({ id: s.id, title: s.title, order: s.order })),
      });

      const parser = new JsonFieldStreamer();
      let model = "unknown";

      try {
        const generation = runTaskStream("investment-thesis", prompt, {
          json: true,
          signal: request.signal,
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
            send({
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
          send({
            type: "section",
            id: spec.id,
            title: spec.title,
            order: spec.order,
            data: field.value,
            elapsedMs: Date.now() - startedAt,
          });
        }

        const verdict = parser.result();

        // Same grounding check the non-streamed verdict runs: every figure in the
        // generated prose must trace back to a line in the evidence block.
        const claims = collectClaimText([
          verdict.headline as string,
          verdict.thesis as string,
          (verdict.catalysts as string[]) ?? [],
          (verdict.risks as string[]) ?? [],
          ((verdict.keyMetrics as { label: string; value: string }[]) ?? []).map(
            (m) => `${m.label} ${m.value}`,
          ),
        ]);

        send({
          type: "done",
          verdict,
          grounding: verifyGrounding(claims, evidence),
          model,
          durationMs: Date.now() - startedAt,
        });
      } catch (err) {
        if (!request.signal.aborted) {
          // Sections that already streamed stay on screen — the client keeps
          // them and marks only the incomplete ones as stopped. A partial report
          // is worth more than a wiped one.
          send({
            type: "error",
            error: err instanceof Error ? err.message : "Generation failed",
            completed: parser.keys(),
          });
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
