/**
 * Model Health Tracker — per-model-id failure memory, persisted to a small
 * local JSON file so it survives a process restart and (best-effort) is
 * shared across multiple server processes if the app is ever run that way.
 *
 * Deliberately NOT in the app's SQLite database (lib/db.ts): this is
 * disposable, advisory routing state — losing it costs nothing worse than
 * briefly re-trying a model that was cooling down — so it doesn't belong in
 * the same durability/backup story as watchlists, portfolios, and notes.
 * A dedicated file also means this module never has to coordinate with
 * lib/db.ts's own schema/migrations for what is, at most, a few hundred
 * bytes of routing hints.
 *
 * Persistence is best-effort in every direction: a read failure (missing
 * file, corrupt JSON, read-only filesystem) silently falls back to a clean
 * in-memory state, and a write failure is swallowed — routing must never
 * fail, slow down, or throw because disk I/O had a bad moment.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FAILURE_THRESHOLD = 2; // consecutive failures before we consider a model "unhealthy"
const COOLDOWN_MS = 60_000; // how long an unhealthy model is deprioritized

interface ModelHealthState {
  consecutiveFailures: number;
  unhealthyUntil: number; // epoch ms; 0 when healthy
  /** epoch ms of the last successful completion; 0 if never. */
  lastSuccessAt: number;
}

const state = new Map<string, ModelHealthState>();

const PERSIST_PATH =
  process.env.AI_HEALTH_PATH ?? path.join(process.cwd(), "data", "ai-health.json");

/**
 * Off under the test runner UNLESS a test explicitly opts in by setting
 * `AI_HEALTH_PATH` itself (see tests/ai-health.test.ts, which points it at a
 * temp file). Without this, `tests/ai-router.test.ts` — which drives
 * hundreds of `markSuccess`/`markFailure` calls with fake model ids on every
 * run — would otherwise write real files into this repo's `data/` directory
 * on every `vitest run`.
 */
const PERSISTENCE_ENABLED =
  process.env.AI_HEALTH_PATH != null ||
  (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test");

function loadPersisted(): void {
  if (!PERSISTENCE_ENABLED) return;
  try {
    if (!existsSync(PERSIST_PATH)) return;
    const raw = JSON.parse(readFileSync(PERSIST_PATH, "utf8")) as Record<string, ModelHealthState>;
    for (const [id, s] of Object.entries(raw)) {
      if (
        typeof s?.consecutiveFailures === "number" &&
        typeof s?.unhealthyUntil === "number" &&
        typeof s?.lastSuccessAt === "number"
      ) {
        state.set(id, s);
      }
    }
  } catch {
    // Missing/corrupt file, or no read permission — start clean. Routing
    // must work identically to a brand-new install, never worse.
  }
}
loadPersisted();

/**
 * Fire-and-forget write of the current state. Called after every
 * success/failure — infrequent enough (one AI completion, not one token)
 * that a synchronous write is not a meaningful cost, and synchronous means
 * no unhandled promise rejection can ever surface from a routing decision.
 */
function persist(): void {
  if (!PERSISTENCE_ENABLED) return;
  try {
    mkdirSync(path.dirname(PERSIST_PATH), { recursive: true });
    writeFileSync(PERSIST_PATH, JSON.stringify(Object.fromEntries(state)));
  } catch {
    // Read-only filesystem, disk full, etc. Health tracking degrades to
    // in-memory-only for this process — never a reason to fail a request.
  }
}

function stateFor(modelId: string): ModelHealthState {
  let s = state.get(modelId);
  if (!s) {
    s = { consecutiveFailures: 0, unhealthyUntil: 0, lastSuccessAt: 0 };
    state.set(modelId, s);
  }
  return s;
}

export function markSuccess(modelId: string): void {
  state.set(modelId, { consecutiveFailures: 0, unhealthyUntil: 0, lastSuccessAt: Date.now() });
  persist();
}

/**
 * Did we ourselves successfully complete a call to this exact model within
 * the last `windowMs`? A second, independent warmth signal alongside the
 * Router's `/api/ps` residency probe: that probe is one HTTP round trip
 * taken at one instant, so it can race a genuinely concurrent use of the
 * same model (another request's completion lands right as this probe fires)
 * or simply lag the daemon's own bookkeeping by a beat. Our own very-recent
 * success is stronger, cheaper evidence than a second network call, and
 * costs nothing to check.
 */
export function recentSuccessWithinMs(modelId: string, windowMs: number): boolean {
  const s = state.get(modelId);
  if (!s || s.lastSuccessAt === 0) return false;
  return Date.now() - s.lastSuccessAt <= windowMs;
}

export function markFailure(modelId: string): void {
  const s = stateFor(modelId);
  s.consecutiveFailures += 1;
  if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
    s.unhealthyUntil = Date.now() + COOLDOWN_MS;
  }
  persist();
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
