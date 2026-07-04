/**
 * Thematic Research API — POST /api/thematic
 *
 * Streams Server-Sent Events as each stage of the 10-stage
 * Industries & Commodities Discovery Framework completes.
 *
 * Request body: { theme: string }
 * Each SSE event: data: <JSON>\n\n
 * Final event: data: {"stage":"done","report":{...}}\n\n
 */

import { runThematicEngine, type ThematicProgressEvent } from "@/lib/thematic-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: { theme?: string };
  try {
    body = (await req.json()) as { theme?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const theme = body.theme?.trim();
  if (!theme) {
    return Response.json({ error: "theme is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: ThematicProgressEvent & { report?: unknown }) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }

      try {
        send({ stage: "init", message: `Starting thematic analysis for "${theme}"…` });

        const report = await runThematicEngine(
          { theme },
          (event) => send(event),
        );

        send({ stage: "done", message: "Thematic report complete", report });
      } catch (err) {
        send({
          stage: "error",
          message: err instanceof Error ? err.message : "Unexpected error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
