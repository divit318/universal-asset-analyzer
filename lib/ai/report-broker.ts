/**
 * Verdict generation broker — one model generation per cache identity, no
 * matter how many consumers are streaming it.
 *
 * ## Why (Phase 2, 2026-08-11)
 *
 * `runTask` (the blocking path) coalesces identical concurrent work through
 * the platform's dedup manager, but `runTaskStream` never did — a generator
 * has no single promise to share. So two components (or two tabs, or a
 * StrictMode double-fire that slipped past the client guard) asking for the
 * same symbol's verdict at the same moment each paid a full Opus generation.
 *
 * This broker gives streamed generations the same guarantee the blocking path
 * has always had:
 *
 *   - The FIRST subscriber for a key starts the producer (one model call).
 *   - Later subscribers replay the frames emitted so far, then follow live.
 *   - One subscriber aborting only detaches that subscriber; the underlying
 *     generation is aborted only when the LAST interested consumer has left
 *     (background refreshes count as a consumer, so a user closing their tab
 *     cannot kill a refresh the cache is waiting on).
 *
 * Frames are the route's own NDJSON event objects (section/done/error), so the
 * route needs no special case for an attached consumer — it forwards frames
 * identically whether it started the generation or joined one.
 */

export interface BrokerFrame {
  /**
   * The consumer surface's own frame vocabulary — "section"/"done"/"error" for
   * the verdict report, "field"/"done"/"error" for the comparison stream. The
   * broker itself only distinguishes terminal frames ("done"/"error"), which
   * every surface shares.
   */
  type: string;
  [key: string]: unknown;
}

/** How one consumer experienced the generation — for instrumentation. */
export type BrokerAttachMode = "started" | "attached";

interface Subscriber {
  push: (frame: BrokerFrame) => void;
  end: () => void;
}

interface SharedGeneration {
  frames: BrokerFrame[];
  finished: boolean;
  consumers: number;
  controller: AbortController;
  subscribers: Set<Subscriber>;
}

const active = new Map<string, SharedGeneration>();

/** True when a live generation for this key is already running — used to
 *  avoid double-scheduling a stale-while-revalidate refresh. */
export function isGenerationActive(key: string): boolean {
  return active.has(key);
}

/**
 * Subscribe to the shared generation for `key`, starting it if absent.
 *
 * `producer` runs at most once per key per moment in time. It receives an
 * `emit` for frames and the SHARED abort signal — which fires only when every
 * consumer (including any background refresh) has walked away.
 *
 * Returns an async generator of frames for THIS consumer: already-emitted
 * frames first (instant replay), then live ones. The generator finishes when
 * the producer does, or throws `AbortError` when `signal` fires.
 */
export async function* subscribeGeneration(
  key: string,
  producer: (emit: (frame: BrokerFrame) => void, signal: AbortSignal) => Promise<void>,
  opts: { signal?: AbortSignal } = {},
): AsyncGenerator<BrokerFrame & { attach: BrokerAttachMode }, void, unknown> {
  let shared = active.get(key);
  const attach: BrokerAttachMode = shared ? "attached" : "started";

  if (!shared) {
    const controller = new AbortController();
    const entry: SharedGeneration = {
      frames: [],
      finished: false,
      consumers: 0,
      controller,
      subscribers: new Set(),
    };
    active.set(key, entry);
    shared = entry;

    const emit = (frame: BrokerFrame) => {
      entry.frames.push(frame);
      for (const sub of entry.subscribers) sub.push(frame);
    };

    void producer(emit, controller.signal)
      .catch((err) => {
        // A producer that throws without having emitted an error frame still
        // owes its subscribers a terminal event — nobody may be left hanging.
        if (!entry.frames.some((f) => f.type === "error" || f.type === "done")) {
          emit({ type: "error", error: err instanceof Error ? err.message : "Generation failed", completed: [] });
        }
      })
      .finally(() => {
        entry.finished = true;
        if (active.get(key) === entry) active.delete(key);
        for (const sub of entry.subscribers) sub.end();
        entry.subscribers.clear();
      });
  }

  const entry = shared;
  entry.consumers += 1;

  // Per-consumer queue, seeded with everything emitted so far.
  const queue: BrokerFrame[] = [...entry.frames];
  let done = entry.finished;
  let wake: (() => void) | null = null;
  const sub: Subscriber = {
    push: (frame) => {
      queue.push(frame);
      wake?.();
    },
    end: () => {
      done = true;
      wake?.();
    },
  };
  if (!entry.finished) entry.subscribers.add(sub);

  const detach = (viaAbort: boolean) => {
    entry.subscribers.delete(sub);
    entry.consumers -= 1;
    // Last consumer cancelled a still-running generation: stop the model call
    // rather than paying for an answer nobody will read. A normal completion
    // needs no abort.
    if (viaAbort && entry.consumers <= 0 && !entry.finished) {
      if (active.get(key) === entry) active.delete(key);
      entry.controller.abort();
    }
  };

  const signal = opts.signal;
  const onAbort = () => wake?.();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      if (signal?.aborted) {
        detach(true);
        throw new DOMException("Aborted", "AbortError");
      }
      if (queue.length > 0) {
        const frame = queue.shift()!;
        yield { ...frame, attach };
        continue;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (done || queue.length > 0 || signal?.aborted) resolve();
      });
      wake = null;
    }
    detach(false);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Run the producer for `key` in the background with no consumer attached —
 * the stale-while-revalidate refresh path. No-op if a generation for the key
 * is already running (the active one will write the cache when it finishes).
 *
 * The synthetic consumer below never aborts, so the refresh runs to
 * completion (and caches) even if every human walked away — that is the whole
 * point of a background refresh.
 */
export function refreshGeneration(
  key: string,
  producer: (emit: (frame: BrokerFrame) => void, signal: AbortSignal) => Promise<void>,
): void {
  if (active.has(key)) return;
  void (async () => {
    try {
      const frames = subscribeGeneration(key, producer);
      // Drain — the producer's side effects (the cache write) are the product.
      for (;;) {
        const { done } = await frames.next();
        if (done) break;
      }
    } catch {
      /* a failed background refresh leaves the stale value in place — correct */
    }
  })();
}

/** Test hook. */
export function resetBrokerForTests(): void {
  for (const entry of active.values()) entry.controller.abort();
  active.clear();
}
