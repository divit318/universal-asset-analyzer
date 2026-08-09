/**
 * Job Registry — server-side single-flight for long-running pipelines.
 *
 * A job is keyed by what it computes (the same key the result cache uses).
 * Starting a job that is already running ATTACHES to it instead of racing it:
 * the second subscriber replays the event history (progress, partials) and
 * then receives live events. Measured need (2026-07-31): the scheduler's
 * auto-scan and a /wire page scan ran the same pipeline concurrently, the backend
 * serialized them, and every queued call of the losing scan burned its whole
 * 300s budget waiting — it delivered zero opportunities as a silent success.
 *
 * Cancellation semantics:
 *   - `detached` jobs (the scheduler's) run to completion with no subscribers.
 *   - Client jobs are aborted `graceMs` after their LAST subscriber detaches —
 *     so a user's Cancel (or closed tab) actually stops server-side work, while
 *     React strict-mode's mount/unmount/remount (or a quick reload) re-attaches
 *     within the grace window instead of killing and restarting the pipeline.
 *
 * Held on a `globalThis` symbol so dev hot-reloads see one registry.
 */

export interface JobSnapshot {
  id: string;
  key: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  subscribers: number;
}

interface JobRecord {
  id: string;
  key: string;
  status: JobSnapshot["status"];
  startedAt: number;
  detached: boolean;
  graceMs: number;
  events: unknown[];
  subscribers: Set<(event: unknown) => void>;
  everAttached: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  controller: AbortController;
  settled: Promise<void>;
}

const REGISTRY_KEY = Symbol.for("uaa.platform.jobs");

function registry(): Map<string, JobRecord> {
  const g = globalThis as unknown as Record<symbol, Map<string, JobRecord> | undefined>;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

export interface JobHandle {
  id: string;
  /** Was this call attached to an already-running job (vs starting a new one)? */
  attached: boolean;
  /**
   * Subscribe to the job's events. The full history is replayed synchronously
   * first, so a late subscriber sees every partial and the final result/error.
   * Returns a detach function.
   */
  subscribe(listener: (event: unknown) => void): () => void;
  /** Abort the job's work immediately (all subscribers see the cancellation event). */
  cancel(): void;
  /** Resolves when the job settles (however it settles). */
  settled: Promise<void>;
}

export interface StartJobOptions {
  /** Run with no subscribers and never auto-abort (schedulers). Default false. */
  detached?: boolean;
  /** How long a client job survives with zero subscribers. Default 5s. */
  graceMs?: number;
}

/** Is a job with this key currently running? (e.g. so a scheduler can skip its tick.) */
export function hasRunningJob(keyPrefix: string): boolean {
  for (const job of registry().values()) {
    if (job.status === "running" && job.key.startsWith(keyPrefix)) return true;
  }
  return false;
}

/** Snapshot of running jobs, for diagnostics. */
export function listJobs(): JobSnapshot[] {
  return [...registry().values()].map((j) => ({
    id: j.id,
    key: j.key,
    status: j.status,
    startedAt: j.startedAt,
    subscribers: j.subscribers.size,
  }));
}

function scheduleGraceAbort(job: JobRecord): void {
  if (job.detached || job.status !== "running") return;
  if (!job.everAttached || job.subscribers.size > 0) return;
  if (job.graceTimer) return;
  job.graceTimer = setTimeout(() => {
    job.graceTimer = null;
    if (job.status === "running" && job.subscribers.size === 0) {
      job.status = "cancelled";
      job.controller.abort();
    }
  }, job.graceMs);
  job.graceTimer.unref?.();
}

function emitTo(job: JobRecord, event: unknown): void {
  job.events.push(event);
  for (const listener of [...job.subscribers]) {
    try {
      listener(event);
    } catch {
      // One subscriber's render error must not break the job or its peers.
    }
  }
}

/**
 * Start the pipeline under `key`, or attach to the one already running.
 *
 * `run` receives the job's AbortSignal (thread it into every stage/call) and
 * an `emit` for progress/partial events. Its RESOLVED value is emitted as the
 * final event via `makeResult`; a rejection is emitted via `makeError`. Both
 * land in the replay buffer, so even a subscriber attaching at the last
 * moment receives a terminal event — a job can never end silently.
 */
export function startOrAttachJob<R>(
  key: string,
  run: (signal: AbortSignal, emit: (event: unknown) => void) => Promise<R>,
  makeResult: (result: R) => unknown,
  makeError: (message: string, cancelled: boolean) => unknown,
  opts: StartJobOptions = {},
): JobHandle {
  const existing = registry().get(key);
  if (existing && existing.status === "running") {
    // A new subscriber arriving revives a job that was in its grace window.
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer);
      existing.graceTimer = null;
    }
    // A scheduler attaching to a user's job (or vice versa) must not let the
    // job die with the user's tab — the snapshot consumer still wants it.
    if (opts.detached) existing.detached = true;
    return toHandle(existing, true);
  }

  const controller = new AbortController();
  const job: JobRecord = {
    id: `job-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    key,
    status: "running",
    startedAt: Date.now(),
    detached: opts.detached ?? false,
    graceMs: opts.graceMs ?? 5_000,
    events: [],
    subscribers: new Set(),
    everAttached: false,
    graceTimer: null,
    controller,
    settled: Promise.resolve(),
  };

  job.settled = (async () => {
    try {
      const result = await run(controller.signal, (event) => emitTo(job, event));
      job.status = "done";
      emitTo(job, makeResult(result));
    } catch (err) {
      const cancelled = controller.signal.aborted;
      job.status = cancelled ? "cancelled" : "error";
      emitTo(job, makeError(err instanceof Error ? err.message : String(err), cancelled));
    } finally {
      // Jobs don't linger: the result cache owns reuse across requests. Only
      // delete if a newer job hasn't already replaced this key.
      if (registry().get(key) === job) registry().delete(key);
    }
  })();

  registry().set(key, job);
  return toHandle(job, false);
}

function toHandle(job: JobRecord, attached: boolean): JobHandle {
  return {
    id: job.id,
    attached,
    subscribe(listener: (event: unknown) => void): () => void {
      for (const event of job.events) listener(event);
      if (job.status !== "running") return () => {};
      job.subscribers.add(listener);
      job.everAttached = true;
      if (job.graceTimer) {
        clearTimeout(job.graceTimer);
        job.graceTimer = null;
      }
      return () => {
        job.subscribers.delete(listener);
        scheduleGraceAbort(job);
      };
    },
    cancel() {
      if (job.status !== "running") return;
      job.status = "cancelled";
      job.controller.abort();
    },
    settled: job.settled,
  };
}
