/**
 * Session sweeper — the backstop behind the provider's finally-terminate.
 *
 * The finally block covers every in-process failure path, but not a killed
 * process (SIGKILL, power loss) between create and terminate. This sweeper
 * lists org sessions tagged "uaa" that are still alive past a generous age
 * and terminates them. Amendment 1 of the Phase 5 approval.
 *
 * Invocation model matches the repo's in-process, on-demand style: callers
 * (the analysis façade) fire `sweepStaleSessions()` after each run; it
 * self-rate-limits to once per interval per process. No daemon.
 */

import { devinConfigured, listSessions, terminateSession } from "./client";

const SWEEP_INTERVAL_MS = 10 * 60_000;
/** Anything older than the longest devinTimeoutMs default (15 min) + slack is orphaned. */
const STALE_AGE_MS = 20 * 60_000;

const state = globalThis as unknown as { __uaaDevinSweepAt?: number };

const ALIVE = new Set(["new", "claimed", "running", "resuming"]);

export interface SweepReport {
  scanned: number;
  terminated: string[];
}

/** Force = ignore the rate limit (tests, manual cleanup scripts). */
export async function sweepStaleSessions(force = false): Promise<SweepReport | null> {
  if (!devinConfigured()) return null;
  const now = Date.now();
  if (!force && state.__uaaDevinSweepAt && now - state.__uaaDevinSweepAt < SWEEP_INTERVAL_MS) return null;
  state.__uaaDevinSweepAt = now;

  const sessions = await listSessions().catch(() => []);
  const stale = sessions.filter(
    (s) =>
      (s.tags ?? []).includes("uaa") &&
      ALIVE.has(s.status) &&
      // created_at/updated_at are epoch seconds or ms depending on endpoint
      // generation; normalize by magnitude.
      now - normalizeEpochMs(s.updated_at ?? s.created_at ?? now) > STALE_AGE_MS,
  );

  const terminated: string[] = [];
  for (const s of stale) {
    if (await terminateSession(s.session_id)) terminated.push(s.session_id);
  }
  if (terminated.length > 0) {
    console.warn(`[ai] devin sweeper terminated ${terminated.length} orphaned session(s): ${terminated.join(", ")}`);
  }
  return { scanned: sessions.length, terminated };
}

export function normalizeEpochMs(t: number): number {
  return t < 10_000_000_000 ? t * 1000 : t;
}
