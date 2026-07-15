/**
 * Request Deduplication Manager.
 *
 * If identical work is already in flight, attach to it instead of starting a
 * second copy. This sits in front of *every* fetch the platform makes —
 * including AI generation, which is by far the most expensive thing to
 * duplicate (tens of seconds of local inference).
 *
 * Why this is not just a nice-to-have: the research page alone fires five API
 * routes that each independently need the same symbol's quote, five-year
 * history, and asset profile. Without coalescing, the cache doesn't help —
 * they all miss simultaneously, all call Yahoo, and all write the same value
 * back. That is a textbook cache stampede, and it was happening on every page
 * load.
 *
 * Cancellation is refcounted. One consumer walking away (user switched symbols)
 * must not cancel a request three other consumers are still waiting on; the
 * underlying provider call is only aborted when the last consumer leaves.
 *
 * Client-safe (no server-only imports) so the client store can reuse it.
 */

interface InFlight<T = unknown> {
  promise: Promise<T>;
  controller: AbortController;
  /** How many consumers are currently awaiting this request. */
  consumers: number;
  startedAt: number;
  /**
   * True when this was started by a background stale-while-revalidate refresh.
   * A foreground request arriving mid-flight subscribes to it rather than
   * firing a duplicate — background and foreground work share one execution.
   */
  background: boolean;
}

const inflight = new Map<string, InFlight>();

export interface DedupStats {
  /** Requests that actually executed. */
  executed: number;
  /** Requests served by attaching to an already-running identical request. */
  coalesced: number;
  /** Requests aborted because the last consumer left. */
  cancelled: number;
}

const stats: DedupStats = { executed: 0, coalesced: 0, cancelled: 0 };

export function dedupStats(): Readonly<DedupStats> {
  return { ...stats };
}

/** Keys currently executing — surfaced by the platform's debug endpoint. */
export function inflightKeys(): string[] {
  return [...inflight.keys()];
}

export interface DedupOptions {
  /** Aborts this consumer's interest. Does NOT necessarily abort the shared request. */
  signal?: AbortSignal;
  /** Mark as a background refresh (see InFlight.background). */
  background?: boolean;
}

/**
 * Run `fn` under `key`, coalescing concurrent identical calls.
 *
 * Two requests are identical only when they require identical work, which is
 * entirely the caller's key's job to express: `history:AAPL:1825` and
 * `history:AAPL:180` are different work and must not share a key, while
 * `statements:AAPL:annual` requested by the research page and by the AI context
 * builder at the same moment are the same work and must.
 *
 * Every subscriber receives the same resolution — value or error. A rejection
 * propagates to all of them; nobody is left hanging.
 */
export function dedupe<T>(
  key: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: DedupOptions = {},
): Promise<T> {
  const existing = inflight.get(key) as InFlight<T> | undefined;

  if (existing) {
    stats.coalesced += 1;
    existing.consumers += 1;
    // A foreground consumer arriving on a background refresh upgrades it, so
    // the refresh is no longer abortable as "just a background job".
    if (!opts.background) existing.background = false;
    return attach(key, existing, opts.signal);
  }

  const controller = new AbortController();
  const entry: InFlight<T> = {
    promise: undefined as unknown as Promise<T>,
    controller,
    consumers: 1,
    startedAt: Date.now(),
    background: opts.background ?? false,
  };

  stats.executed += 1;

  // Always clean up the in-flight slot, success or failure, so a rejected
  // request is retryable immediately rather than being pinned as "running".
  entry.promise = fn(controller.signal).finally(() => {
    if (inflight.get(key) === (entry as InFlight)) inflight.delete(key);
  });

  inflight.set(key, entry as InFlight);
  return attach(key, entry, opts.signal);
}

/**
 * Bind one consumer to a shared in-flight request, honouring that consumer's
 * own AbortSignal without disturbing the others.
 */
function attach<T>(key: string, entry: InFlight<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return entry.promise.finally(() => release(key, entry, false));
  }

  if (signal.aborted) {
    release(key, entry, true);
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      release(key, entry, true);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    entry.promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        release(key, entry, false);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        release(key, entry, false);
        reject(err);
      },
    );
  });
}

/**
 * Drop one consumer's interest. The shared provider call is aborted only when
 * the last consumer that cared about it has gone away *and* it left by
 * cancelling — a normal completion needs no abort.
 */
function release<T>(key: string, entry: InFlight<T>, viaAbort: boolean): void {
  entry.consumers -= 1;
  if (entry.consumers > 0) return;
  if (!viaAbort) return;

  // Last consumer cancelled: nobody wants this result any more, so stop the
  // provider work rather than letting it run to completion unobserved.
  if (inflight.get(key) === (entry as InFlight)) {
    inflight.delete(key);
    entry.controller.abort();
    stats.cancelled += 1;
  }
}

/** Test/debug hook. */
export function resetDedup(): void {
  inflight.clear();
  stats.executed = 0;
  stats.coalesced = 0;
  stats.cancelled = 0;
}
