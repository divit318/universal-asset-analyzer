/**
 * A generic background-building, TTL'd universe cache.
 *
 * This is lib/dataset.ts's lifecycle — kick off a build, serve whatever's
 * ready while it warms, rebuild in the background when stale, never block a
 * request on a cold cache — generalized so that six more asset classes get it
 * for free instead of each reimplementing it. (Equities keep using
 * lib/dataset.ts itself; see universes/equity.ts for why that's deliberate.)
 *
 * Providers supply a `build()` and a TTL; everything else — status reporting,
 * de-duplicating concurrent builds, serving stale data during a refresh — is
 * handled here.
 */

import type { AssetClassId } from "../assets/types";
import type { ScreenerCandidate, UniverseStatus } from "./types";

export interface UniverseProvider {
  assetClass: AssetClassId;
  load(): Promise<{ status: UniverseStatus; candidates: ScreenerCandidate[] }>;
  refresh(): UniverseStatus;
  /**
   * Non-blocking status snapshot — unlike `load()`, never awaits an in-flight
   * build. `run()` already streams live progress into `status` via its
   * `report(ready, total)` callback; this just exposes that snapshot for a
   * polling UI to read without stalling behind the same build a concurrent
   * `load()` call may be blocked on.
   */
  peekStatus(): UniverseStatus;
}

interface CacheOptions {
  assetClass: AssetClassId;
  ttlMs: number;
  /**
   * Build the universe. `report(ready, total)` lets a slow provider stream its
   * progress out to the polling UI instead of looking hung.
   */
  build: (report: (ready: number, total: number) => void) => Promise<ScreenerCandidate[]>;
}

export function createUniverseCache({ assetClass, ttlMs, build }: CacheOptions): UniverseProvider {
  let candidates: ScreenerCandidate[] = [];
  let status: UniverseStatus = { stage: "empty", total: 0, ready: 0, builtAt: null };
  let inFlight: Promise<void> | null = null;

  const isStale = () =>
    status.builtAt == null || Date.now() - Date.parse(status.builtAt) > ttlMs;

  async function run(): Promise<void> {
    // Keep serving the old rows while rebuilding; only `stage` changes.
    status = { ...status, stage: "building" };
    try {
      const next = await build((ready, total) => {
        status = { ...status, ready, total };
      });

      // An empty universe is always a failure, never a legitimate result: every
      // asset class here has a non-empty universe by construction (even forex,
      // the smallest, has 36 curated pairs). Caching an empty build as "ready"
      // would strand the class for a full TTL — which is exactly what happened
      // in live verification, when Yahoo rate-limited us mid-run after a few
      // thousand enrichment calls and forex came back with zero pairs and
      // cached itself as healthy. Treating it as an error means the next
      // request retries instead.
      if (next.length === 0) {
        throw new Error(
          `The ${assetClass} universe came back empty — the data provider is likely rate-limiting. Retrying on the next request.`,
        );
      }

      candidates = next;
      status = {
        stage: "ready",
        total: next.length,
        ready: next.length,
        builtAt: new Date().toISOString(),
      };
    } catch (err) {
      status = {
        ...status,
        stage: "error",
        error: err instanceof Error ? err.message : `Failed to build the ${assetClass} universe`,
      };
    } finally {
      inFlight = null;
    }
  }

  function ensureBuild(): void {
    if (inFlight) return;
    // An errored universe must be retryable — otherwise one rate-limited build
    // at startup would wedge the asset class until the process restarts.
    if (candidates.length === 0 || isStale() || status.stage === "error") {
      inFlight = run();
    }
  }

  return {
    assetClass,

    async load() {
      ensureBuild();
      // Nothing cached at all: wait for the first build rather than returning
      // an empty table that looks like "no matches".
      if (candidates.length === 0 && inFlight) await inFlight;
      return { status, candidates };
    },

    refresh() {
      candidates = [];
      status = { stage: "empty", total: 0, ready: 0, builtAt: null };
      inFlight = run();
      return status;
    },

    peekStatus() {
      ensureBuild();
      return status;
    },
  };
}
