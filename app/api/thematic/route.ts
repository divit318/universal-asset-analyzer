/**
 * Thematic Research API — POST /api/thematic
 *
 * Streams Server-Sent Events as each stage of the 10-stage
 * Industries & Commodities Discovery Framework completes.
 *
 * Request body: { theme: string, refresh?: boolean }
 * Each SSE event: data: <JSON>\n\n
 * Final event: data: {"stage":"done","report":{...}}\n\n
 */

import { readCache, writeCache, cacheKey } from "@/lib/platform/cache";
import { runThematicEngine, type ThematicProgressEvent, type ThematicReport } from "@/lib/thematic-engine";
import { normalizeTheme, themeCacheKey, isRenderableReport, MAX_THEME_LENGTH, REPORT_SCHEMA_VERSION } from "@/lib/thematic-theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Only enforced on Vercel (build-time metadata, a no-op for `next dev`/self-hosted).
// 8 sequential local-model calls can each take minutes on modest hardware —
// 120s was far short of that and would have silently truncated the response.
export const maxDuration = 300;

/**
 * In-flight runs, keyed by normalized theme.
 *
 * The pipeline is minutes long and runs its AI stages sequentially, so a
 * double-click on Analyse (or two tabs on the same theme) used to launch a
 * second full run that queued behind the first — doubling the wait for both and
 * for anything else in the app that needs the model. A repeat request joins the
 * run already happening instead of starting a rival one — and, since the
 * events are tiny (~24 per run), the run keeps them all so a joiner can
 * REPLAY the progress so far and then follow along live. Before the buffer
 * existed a joiner received two init events and then silence for minutes,
 * which the progress panel rendered as a run frozen on its first stage.
 *
 * The run owns its own AbortController: it stops when the LAST watcher
 * disconnects, not when the first one does — previously the originator
 * closing their tab killed the run under every joiner still watching it.
 */
interface InFlightRun {
  promise: Promise<ThematicReport>;
  events: ThematicProgressEvent[];
  listeners: Set<(e: ThematicProgressEvent) => void>;
  abort: AbortController;
}

const inFlight = new Map<string, InFlightRun>();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { theme?: unknown })?.theme;
  // Explicit typeof check: `body.theme?.trim()` threw a TypeError on any
  // non-string (a numeric theme returned a bodyless 500 rather than a 400).
  if (typeof raw !== "string") {
    return Response.json({ error: "theme must be a string" }, { status: 400 });
  }
  const theme = normalizeTheme(raw);
  if (!theme) {
    return Response.json({ error: "theme is required" }, { status: 400 });
  }
  if (theme.length < 2) {
    return Response.json({ error: "theme is too short to research" }, { status: 400 });
  }
  if (raw.trim().length > MAX_THEME_LENGTH) {
    return Response.json(
      { error: `theme must be ${MAX_THEME_LENGTH} characters or fewer` },
      { status: 400 },
    );
  }

  const refresh = (body as { refresh?: unknown })?.refresh === true;
  // The schema version is part of the key: a report persisted by an older
  // engine shape becomes a miss, never a render-time crash (see thematic-theme).
  const key = cacheKey("thematicReport", { theme: themeCacheKey(theme), v: REPORT_SCHEMA_VERSION });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // The client can disconnect at any point in a multi-minute stream;
      // enqueueing onto a closed controller throws and would surface as an
      // unhandled rejection in the server log.
      let closed = false;
      function send(event: ThematicProgressEvent & { report?: unknown; cached?: boolean }) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      }

      // A single stage can run minutes with no data frame in between, which
      // is longer than many proxy/browser idle timeouts. SSE comment frames
      // (lines starting with ":") keep the connection visibly alive and are
      // ignored by the client's `data: `-prefixed parser. They also double as
      // the traffic the client's stall watchdog counts on.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      /** This request's live tap into the shared run; detached on every exit. */
      const listener = (e: ThematicProgressEvent) => send(e);
      let entry: InFlightRun | undefined;
      const detach = () => {
        if (!entry) return;
        entry.listeners.delete(listener);
        // A run this expensive is aborted when the LAST watcher disconnects,
        // not left to finish into a void — Cancel and a closed tab free the
        // model, but only once nobody else is still following the run.
        if (entry.listeners.size === 0) entry.abort.abort();
      };
      req.signal.addEventListener("abort", detach);

      try {
        if (!refresh) {
          const hit = readCache<ThematicReport>(key);
          // Belt to the version key's braces: a row that somehow carries the
          // current version but not the current shape is a miss, not a crash.
          if (hit && isRenderableReport(hit.value)) {
            send({
              stage: "done",
              message: `Loaded the saved report for "${theme}" — generated ${new Date(hit.value.generatedAt).toLocaleString()}.`,
              report: hit.value,
              cached: true,
            });
            return;
          }
        }

        send({ stage: "init", message: `Starting thematic analysis for "${theme}"…` });

        entry = inFlight.get(key);
        if (!entry) {
          const abort = new AbortController();
          const events: ThematicProgressEvent[] = [];
          const listeners = new Set<(e: ThematicProgressEvent) => void>([listener]);
          const broadcast = (e: ThematicProgressEvent) => {
            events.push(e);
            for (const l of listeners) l(e);
          };
          const run: InFlightRun = {
            events,
            listeners,
            abort,
            promise: runThematicEngine({ theme, signal: abort.signal }, broadcast),
          };
          // The cache write belongs to the run, not to whichever request
          // happens to still be connected when it finishes.
          run.promise
            .then((report) => writeCache("thematicReport", key, report))
            .catch(() => {})
            .finally(() => {
              if (inFlight.get(key) === run) inFlight.delete(key);
            });
          inFlight.set(key, run);
          entry = run;
        } else {
          send({ stage: "init", message: `Joining the analysis already running for "${theme}"…` });
          // Replay everything the run has emitted so far, THEN follow live —
          // the progress panel resumes mid-run instead of freezing at stage 1.
          for (const e of entry.events) send(e);
          entry.listeners.add(listener);
        }

        const report = await entry.promise;
        send({ stage: "done", message: "Thematic report complete", report });
      } catch (err) {
        if (!entry?.abort.signal.aborted) {
          send({
            stage: "error",
            message: err instanceof Error ? err.message : "Unexpected error",
          });
        }
      } finally {
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", detach);
        detach();
        closed = true;
        try { controller.close(); } catch { /* already closed by the disconnect */ }
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
