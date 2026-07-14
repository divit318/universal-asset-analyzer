/**
 * Request Orchestration.
 *
 * Callers declare *what* they need and which parts genuinely depend on each
 * other; the orchestrator decides execution order, concurrency, failure
 * isolation, retries, and cancellation. Pages never hand-roll `Promise.all`
 * chains again — that is what produced the research page's four-stage
 * waterfall, where `await getQuote()` blocked a `Promise.all` that itself
 * blocked a sector-history fetch, and none of the ten client-side fetches could
 * even start until all of it finished.
 *
 * The rules it enforces:
 *   - Independent steps run concurrently. Always. No exceptions.
 *   - Dependent steps (statements → ratios → AI) stay strictly ordered, because
 *     parallelising a real dependency doesn't make it faster, it makes it wrong.
 *   - A failed step never cancels unrelated work. It records an error, its
 *     dependents are skipped, and every other branch completes. Partial data
 *     beats a blank page.
 *   - Concurrency is capped so a 500-symbol screen can't open 500 sockets and
 *     get the app rate-limited out of Yahoo.
 *
 * Client-safe (no server-only imports).
 */

import type { PlanResult, PlanStep, StepResult, StepStatus } from "./types";

export interface PlanOptions {
  /** Max steps executing at once. Guards provider rate limits and socket exhaustion. */
  concurrency?: number;
  /** Default per-step timeout. */
  timeoutMs?: number;
  /** Cancels the entire plan (user navigated away, newer request superseded this one). */
  signal?: AbortSignal;
  /**
   * Fired the moment each step settles, in completion order.
   *
   * This is the seam where parallel fetching feeds progressive rendering: the
   * bundle route streams each step to the browser as it lands instead of waiting
   * for the slowest one, so the quote paints while the peer comparison is still
   * fanning out across the sector. Without this, `runPlan` would be internally
   * concurrent but externally still all-or-nothing.
   */
  onStep?: (result: StepResult) => void;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 20_000;

class StepTimeoutError extends Error {
  constructor(id: string, ms: number) {
    super(`Step "${id}" timed out after ${ms}ms`);
    this.name = "StepTimeoutError";
  }
}

class StepAbortedError extends Error {
  constructor(id: string) {
    super(`Step "${id}" was cancelled`);
    this.name = "StepAbortedError";
  }
}

/**
 * Race a step against its timeout AND its abort signal.
 *
 * Racing the abort signal (not just passing it in) matters: a step whose `run`
 * ignores the signal — a plain `await sleep()`, a provider SDK with no abort
 * support — would otherwise run to completion and be recorded as a success long
 * after the user navigated away. We must stop *waiting* on it the moment the
 * plan is cancelled, whether or not the work itself can be torn down.
 *
 * The controller is fired on timeout too, so a slow provider call that *does*
 * honour abort is actually torn down rather than left holding a socket.
 */
async function withTimeout<T>(
  id: string,
  ms: number,
  controller: AbortController,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Reject BEFORE aborting. `controller.abort()` synchronously fires the
          // abort listener below, which would otherwise win the race and report
          // a timeout as a cancellation. Promise.race keeps the first settlement,
          // so settling as a timeout first preserves the true cause.
          reject(new StepTimeoutError(id, ms));
          controller.abort();
        }, ms);
      }),
      new Promise<never>((_, reject) => {
        if (controller.signal.aborted) {
          reject(new StepAbortedError(id));
          return;
        }
        onAbort = () => reject(new StepAbortedError(id));
        controller.signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * Execute a dependency graph of steps.
 *
 * Never rejects on a step failure — the PlanResult carries per-step status so
 * the caller can render what succeeded and message what didn't. It only rejects
 * if a `required: true` step fails (there is no meaningful page without a quote,
 * for instance) or the whole plan is aborted.
 */
export async function runPlan(
  steps: PlanStep[],
  opts: PlanOptions = {},
): Promise<PlanResult> {
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  const defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = Date.now();

  const byId = new Map(steps.map((s) => [s.id, s]));
  const results = new Map<string, StepResult>();

  // Validate the graph up front. A typo'd or cyclic `dependsOn` should fail
  // loudly at the call site, not deadlock at runtime with steps waiting forever.
  for (const step of steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${dep}"`);
      }
    }
  }
  assertAcyclic(steps, byId);

  const pending = new Set(steps.map((s) => s.id));
  const running = new Map<string, Promise<void>>();

  const settle = (id: string, status: StepStatus, value: unknown, error: string | null, durationMs: number) => {
    const result: StepResult = { id, status, value, error, durationMs };
    results.set(id, result);
    pending.delete(id);
    try {
      opts.onStep?.(result);
    } catch {
      // A throwing observer (a closed SSE stream, say) must never take down the
      // plan that is feeding it.
    }
  };

  /** A step is ready when every dependency has settled successfully. */
  const readySteps = (): PlanStep[] => {
    const ready: PlanStep[] = [];
    for (const id of pending) {
      if (running.has(id)) continue;
      const step = byId.get(id) as PlanStep;
      const deps = step.dependsOn ?? [];
      if (deps.every((d) => results.get(d)?.status === "ok")) ready.push(step);
    }
    return ready;
  };

  /**
   * Steps whose dependency chain is broken (an upstream step failed, was
   * skipped, or was cancelled). They can never run, so settle them as `skipped`
   * immediately rather than leaving them pending forever.
   */
  const skipBlocked = (): void => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of [...pending]) {
        if (running.has(id)) continue;
        const step = byId.get(id) as PlanStep;
        const deps = step.dependsOn ?? [];
        const broken = deps.some((d) => {
          const r = results.get(d);
          return r != null && r.status !== "ok";
        });
        if (broken) {
          settle(id, "skipped", null, "Upstream dependency failed", 0);
          changed = true;
        }
      }
    }
  };

  const runStep = async (step: PlanStep): Promise<void> => {
    const stepStart = Date.now();

    if (opts.signal?.aborted) {
      settle(step.id, "cancelled", null, "Cancelled", Date.now() - stepStart);
      return;
    }

    const deps: Record<string, unknown> = {};
    for (const d of step.dependsOn ?? []) deps[d] = results.get(d)?.value ?? null;

    const attempts = (step.retries ?? 0) + 1;
    const timeoutMs = step.timeoutMs ?? defaultTimeout;
    let lastError = "Unknown error";

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (opts.signal?.aborted) {
        settle(step.id, "cancelled", null, "Cancelled", Date.now() - stepStart);
        return;
      }

      // Each attempt gets a fresh controller, chained to the plan's signal so a
      // plan-wide abort tears down in-flight provider calls immediately.
      const controller = new AbortController();
      const onPlanAbort = () => controller.abort();
      opts.signal?.addEventListener("abort", onPlanAbort, { once: true });

      try {
        const value = await withTimeout(step.id, timeoutMs, controller, (signal) =>
          step.run(deps, signal),
        );
        settle(step.id, "ok", value, null, Date.now() - stepStart);
        return;
      } catch (err) {
        lastError = errorMessage(err);
        if (opts.signal?.aborted) {
          settle(step.id, "cancelled", null, "Cancelled", Date.now() - stepStart);
          return;
        }
        // Exponential backoff between retries; skipped after the final attempt.
        if (attempt < attempts - 1) {
          await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
        }
      } finally {
        opts.signal?.removeEventListener("abort", onPlanAbort);
      }
    }

    settle(step.id, "failed", null, lastError, Date.now() - stepStart);
  };

  while (pending.size > 0) {
    skipBlocked();
    if (pending.size === 0) break;

    const ready = readySteps().slice(0, Math.max(0, concurrency - running.size));

    if (ready.length === 0 && running.size === 0) {
      // Nothing runnable and nothing running: every remaining step is blocked
      // by a failure the skipBlocked pass will have caught. Defensive only.
      for (const id of [...pending]) settle(id, "skipped", null, "Unreachable step", 0);
      break;
    }

    for (const step of ready) {
      const promise = runStep(step).finally(() => running.delete(step.id));
      running.set(step.id, promise);
    }

    if (running.size > 0) await Promise.race(running.values());
  }

  await Promise.allSettled(running.values());

  const stepResults: Record<string, StepResult> = {};
  for (const [id, r] of results) stepResults[id] = r;

  // A required step failing means the plan produced nothing usable — the caller
  // needs to know that as an exception, not as a half-empty result object.
  for (const step of steps) {
    if (step.required && stepResults[step.id]?.status !== "ok") {
      throw new Error(
        `Required step "${step.id}" failed: ${stepResults[step.id]?.error ?? "unknown"}`,
      );
    }
  }

  return {
    steps: stepResults,
    durationMs: Date.now() - startedAt,
    partial: Object.values(stepResults).some((r) => r.status !== "ok"),
  };
}

/** Depth-first cycle detection — a cyclic plan would otherwise hang forever. */
function assertAcyclic(steps: PlanStep[], byId: Map<string, PlanStep>): void {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>(steps.map((s) => [s.id, WHITE]));

  const visit = (id: string, path: string[]): void => {
    const state = colour.get(id);
    if (state === BLACK) return;
    if (state === GREY) {
      throw new Error(`Cyclic dependency in plan: ${[...path, id].join(" → ")}`);
    }
    colour.set(id, GREY);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep, [...path, id]);
    colour.set(id, BLACK);
  };

  for (const s of steps) visit(s.id, []);
}

/** Convenience: pull a step's typed value out of a PlanResult, or null if it didn't succeed. */
export function stepValue<T>(plan: PlanResult, id: string): T | null {
  const r = plan.steps[id];
  return r?.status === "ok" ? (r.value as T) : null;
}

/** Convenience: the error message for a step, or null when it succeeded/never ran. */
export function stepError(plan: PlanResult, id: string): string | null {
  const r = plan.steps[id];
  return r?.status === "ok" ? null : r?.error ?? null;
}

/**
 * Bounded-concurrency map — the batch counterpart to `runPlan`, for the case
 * where the "graph" is just N independent items (score 500 screener symbols,
 * refresh 40 watchlist quotes). Same rate-limit protection, far less ceremony.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker),
  );
  return results;
}
