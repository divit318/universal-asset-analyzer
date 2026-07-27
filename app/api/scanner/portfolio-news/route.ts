/**
 * GET /api/scanner/portfolio-news
 *
 * Streams recent news for each portfolio holding as newline-delimited JSON
 * (NDJSON) — same wire format as /api/scanner/v2. Deliberately NOT built on
 * mapLimit() (lib/platform/orchestrator.ts): mapLimit resolves the whole
 * batch at once, and the point of Portfolio Watch is that each holding's
 * headlines reach the client the moment they're ready, not after the
 * slowest holding finishes. Bounded concurrency here is a small worker pool
 * that writes to the stream per-completion instead of collecting.
 *
 * getCompanyNews() (lib/news.ts) is already platform-cached (15min TTL / 1h
 * SWR, see lib/platform/registry.ts), so this is cheap even on a large
 * portfolio.
 */
import { listPortfolio } from "@/lib/db";
import { getCompanyNews } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONCURRENCY = 4;
const ITEMS_PER_HOLDING = 4;

export async function GET() {
  const symbols = [...new Set(listPortfolio().map((p) => p.symbol))];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function sendLine(obj: object) {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      }

      if (symbols.length === 0) {
        controller.close();
        return;
      }

      let cursor = 0;
      async function worker() {
        while (cursor < symbols.length) {
          const symbol = symbols[cursor++];
          try {
            const items = await getCompanyNews(symbol, ITEMS_PER_HOLDING);
            if (items.length > 0) sendLine({ type: "holding", symbol, items });
          } catch {
            // A single holding's news failing shouldn't stop the rest.
          }
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker),
      );

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
