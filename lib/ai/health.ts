/**
 * Model Health Tracker — in-memory, per-process, per-model-id failure memory.
 *
 * Not a persisted or distributed circuit breaker — just enough state so a
 * model that just failed (timeout, connection refused, missing) drops to the
 * back of the Router's candidate order for a short window instead of being
 * retried first on every subsequent request. Resets naturally: a success
 * clears the failure count immediately, and the process restarts clean.
 */

const FAILURE_THRESHOLD = 2; // consecutive failures before we consider a model "unhealthy"
const COOLDOWN_MS = 60_000; // how long an unhealthy model is deprioritized

interface ModelHealthState {
  consecutiveFailures: number;
  unhealthyUntil: number; // epoch ms; 0 when healthy
}

const state = new Map<string, ModelHealthState>();

function stateFor(modelId: string): ModelHealthState {
  let s = state.get(modelId);
  if (!s) {
    s = { consecutiveFailures: 0, unhealthyUntil: 0 };
    state.set(modelId, s);
  }
  return s;
}

export function markSuccess(modelId: string): void {
  state.set(modelId, { consecutiveFailures: 0, unhealthyUntil: 0 });
}

export function markFailure(modelId: string): void {
  const s = stateFor(modelId);
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
    s.unhealthyUntil = Date.now() + COOLDOWN_MS;
  }
}

/** True unless the model has recently failed enough times to be in cooldown. */
export function isHealthy(modelId: string): boolean {
  const s = state.get(modelId);
  if (!s) return true;
  if (s.unhealthyUntil === 0) return true;
  if (Date.now() >= s.unhealthyUntil) {
    // Cooldown elapsed — give it another chance rather than staying marked down forever.
    s.unhealthyUntil = 0;
    s.consecutiveFailures = 0;
    return true;
  }
  return false;
}

/** Test-only: clear all tracked state. */
export function resetHealth(): void {
  state.clear();
}
