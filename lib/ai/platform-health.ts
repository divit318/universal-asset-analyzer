/**
 * Platform Health — "can UAA do AI right now?", across every provider.
 *
 * Distinct from ./health.ts, which tracks per-*model* failure streaks to order
 * the Router's candidates. This answers the question the UI actually asks
 * before rendering a copilot panel or an audit button.
 *
 * ## Why this module exists
 *
 * Four routes used to import Ollama's `checkHealth()` directly and gate their
 * whole feature on it:
 *
 *   app/api/research/chat/route.ts, app/api/research/context/route.ts,
 *   app/api/portfolio/audit/route.ts, app/api/screener/nl/route.ts
 *
 * That was already a layering violation (they reached past the provider
 * interface to a specific backend), but it was harmless while Ollama was the
 * only backend. The moment a second provider exists it becomes a bug: with
 * Ollama stopped and Devin working perfectly, every one of those routes would
 * return 503 "start Ollama" while the Router sitting right next to them was
 * happily answering. Readiness is a property of the *platform*, not of one
 * daemon.
 */

import { defaultProviders } from "./router";
import { aiUnavailableMessage } from "./availability";
import type { AIProvider } from "./provider";

export interface ProviderStatus {
  id: string;
  reachable: boolean;
  /** Model ids this provider can currently serve. */
  models: string[];
}

export interface PlatformHealth {
  /** True when at least one provider can serve at least one model. */
  reachable: boolean;
  /** Union of every routable model id, best provider first. */
  models: string[];
  /** Per-provider detail, in routing order — for diagnostics and UI copy. */
  providers: ProviderStatus[];
}

/**
 * Health probes are not free (a process spawn for Devin, an HTTP round trip
 * with a 4s timeout for Ollama) and the copilot page fires several readiness
 * checks in quick succession, so results are memoized very briefly.
 *
 * Successes and failures get *different* lifetimes on purpose. Caching an
 * outage for as long as an all-clear is how "Start Ollama" ends up pinned on
 * screen for a full TTL after the user has already started it — the failure
 * window is therefore short enough that recovery looks immediate.
 */
const OK_TTL_MS = 30_000;
const FAIL_TTL_MS = 2_000;

let cache: { value: PlatformHealth; expiresAt: number } | null = null;

export async function checkPlatformHealth(): Promise<PlatformHealth> {
  if (cache && Date.now() < cache.expiresAt) return cache.value;

  const providers = defaultProviders();
  const statuses = await Promise.all(
    providers.map(async (p: AIProvider): Promise<ProviderStatus> => {
      try {
        const h = await p.healthCheck();
        return { id: p.id, reachable: h.reachable, models: h.models };
      } catch {
        // A provider that throws on its own health check is, definitionally,
        // unhealthy. It must not take the other providers down with it.
        return { id: p.id, reachable: false, models: [] };
      }
    }),
  );

  const models = [...new Set(statuses.flatMap((s) => s.models))];
  const value: PlatformHealth = {
    reachable: statuses.some((s) => s.reachable) && models.length > 0,
    models,
    providers: statuses,
  };

  cache = { value, expiresAt: Date.now() + (value.reachable ? OK_TTL_MS : FAIL_TTL_MS) };
  return value;
}

/** Test hook / manual refresh: drop the memoized result. */
export function resetPlatformHealthCache(): void {
  cache = null;
}

/**
 * The message to show when no provider can answer. Re-exported from
 * ./availability so server routes can reach it alongside the health check
 * they just ran, without every client component importing this module (which
 * transitively pulls in node:child_process).
 */
export const unavailableMessage = aiUnavailableMessage;
