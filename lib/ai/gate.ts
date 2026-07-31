/**
 * Generation Gate — a process-wide semaphore in front of the local model.
 *
 * Ollama serves one generation at a time (default n_slots = 1), so every
 * concurrent request the app fires is silently queued inside Ollama — and a
 * request's deadline (`AbortSignal.timeout` in ../ollama.ts) starts counting
 * the moment fetch() is called, i.e. while it is still WAITING ITS TURN.
 * Measured on 2026-07-31: two concurrent Wire scans serialized behind each
 * other and every queued call burned its entire 300s budget in the queue,
 * timing out having never generated a token; the losing scan completed
 * "successfully" with zero opportunities.
 *
 * Queueing in-process instead makes each call's timeout race only its own
 * generation time. The limit is configurable (`OLLAMA_CONCURRENCY`) for hosts
 * that run Ollama with OLLAMA_NUM_PARALLEL > 1.
 *
 * Held on a `globalThis` symbol so dev-server hot reloads share one gate.
 */

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
}

interface GateState {
  active: number;
  queue: Waiter[];
}

const GATE_KEY = Symbol.for("uaa.ai.generation-gate");

function limit(): number {
  const n = Number(process.env.OLLAMA_CONCURRENCY);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function state(): GateState {
  const g = globalThis as unknown as Record<symbol, GateState | undefined>;
  if (!g[GATE_KEY]) g[GATE_KEY] = { active: 0, queue: [] };
  return g[GATE_KEY];
}

/** How many requests are waiting for a generation slot right now. */
export function generationQueueDepth(): number {
  return state().queue.length;
}

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}

function dispatch(s: GateState): void {
  while (s.active < limit() && s.queue.length > 0) {
    const next = s.queue.shift() as Waiter;
    if (next.signal?.aborted) {
      next.reject(abortError());
      continue;
    }
    s.active += 1;
    next.resolve(makeRelease(s));
  }
}

function makeRelease(s: GateState): () => void {
  let released = false;
  return () => {
    if (released) return; // release is idempotent — a finally block may run twice across retries
    released = true;
    s.active -= 1;
    dispatch(s);
  };
}

/**
 * Wait for a generation slot. Resolves with a `release` function the caller
 * MUST invoke (in a `finally`) when its request to the model has settled.
 * Rejects with an AbortError if `signal` fires while still queued — the
 * caller withdrew, so it must not consume a slot at all.
 */
export function acquireGenerationSlot(signal?: AbortSignal): Promise<() => void> {
  const s = state();
  if (signal?.aborted) return Promise.reject(abortError());
  if (s.active < limit()) {
    s.active += 1;
    return Promise.resolve(makeRelease(s));
  }
  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal };
    s.queue.push(waiter);
    signal?.addEventListener(
      "abort",
      () => {
        const idx = s.queue.indexOf(waiter);
        if (idx !== -1) {
          s.queue.splice(idx, 1);
          reject(abortError());
        }
      },
      { once: true },
    );
  });
}
