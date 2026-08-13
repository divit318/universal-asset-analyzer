import { analyzeForDemo, DemoError } from "@/lib/landing-demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/landing/demo?symbol=RELIANCE.NS
 *
 * The Try It section's live analysis path. Streams NDJSON so the client can
 * show real engine progress instead of a spinner:
 *
 *   {"type":"stage","id":"quote","label":"Quote & asset class","ms":312}
 *   {"type":"stage","id":"data","label":"Fundamentals, statements, 5y prices","ms":940}
 *   {"type":"stage","id":"score","label":"Deterministic score","ms":0}
 *   {"type":"result","analysis":{...},"elapsedMs":1257}
 *
 * or, terminally: {"type":"error","code":"unknown_symbol","message":"..."}
 *
 * Rate limited per IP (and globally) because every run hits the free market
 * data sources on the visitor's behalf; the demo must be polite to them.
 */

const PER_IP_LIMIT = 6; // runs per window per visitor
const GLOBAL_LIMIT = 60; // runs per window across all visitors
const WINDOW_MS = 60_000;

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

function rateLimited(ip: string): boolean {
  const now = Date.now();
  globalHits = globalHits.filter((t) => now - t < WINDOW_MS);
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= PER_IP_LIMIT || globalHits.length >= GLOBAL_LIMIT) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  globalHits.push(now);
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (ipHits.size > 1000) {
    for (const [key, arr] of ipHits) {
      if (arr.every((t) => now - t >= WINDOW_MS)) ipHits.delete(key);
    }
  }
  return false;
}

export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") ?? "";
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";

  if (rateLimited(ip)) {
    // Delivered as a stream-shaped error event over 200, like every other
    // failure on this endpoint: the demo UI is its only caller, and an HTTP
    // 429 would log a browser console error on a page that must stay clean.
    return new Response(
      JSON.stringify({
        type: "error",
        code: "rate_limited",
        message: `The demo runs at most ${PER_IP_LIMIT} live analyses a minute per visitor, to stay polite to the free market data sources. Give it a minute.`,
      }) + "\n",
      { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      const t0 = Date.now();
      try {
        const analysis = await analyzeForDemo(symbol, (stage) => send({ type: "stage", ...stage }));
        send({ type: "result", analysis, elapsedMs: Date.now() - t0 });
      } catch (err) {
        if (err instanceof DemoError) {
          send({ type: "error", code: err.code, message: err.message });
        } else {
          send({
            type: "error",
            code: "source_down",
            message: "The market data source didn't answer. That's the feed, not the engines. Try again in a few seconds.",
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
    },
  });
}
