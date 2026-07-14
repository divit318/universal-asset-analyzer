/**
 * Smart Cache — the platform's single caching tier.
 *
 * Two levels, chosen per dataset by its registry policy:
 *   L1 — an in-process LRU map. Every API route in a Next.js server shares one
 *        module instance, so this is what collapses the burst of identical
 *        provider calls a single page load fires across five different routes.
 *   L2 — the `platform_cache` SQLite table, for `persist: true` datasets only.
 *        Survives restarts, so a `npm run dev` doesn't re-download five years
 *        of price history and every 10-K the user already looked at.
 *
 * Correctness rules this enforces, because "caching exists to eliminate
 * recomputation, not to serve stale data faster":
 *   - Nothing is cached under a universal TTL. Policy comes from the registry.
 *   - A value past `ttlMs` is never returned as `fresh`. Inside the SWR window
 *     it is returned as `revalidating` (with a refresh already in flight) and
 *     the caller can render it while marking it as refreshing; past the SWR
 *     window it is a miss and the caller waits.
 *   - Failures are never cached. A provider outage must not pin an error for
 *     the dataset's whole TTL.
 *   - Invalidation is dependency-aware (see registry.dependencyClosure) and
 *     scoped: invalidating Apple's filings cannot touch Apple's price history
 *     or Microsoft's anything.
 *
 * Server-only: imports lib/db.ts (node:sqlite).
 */

import { deletePlatformCache, getPlatformCache, prunePlatformCache, putPlatformCache } from "../db";
import { cacheKey, dependencyClosure, policyFor } from "./registry";
import type { CacheEntry, CacheMeta, DatasetId, FreshnessState } from "./types";

/** Bounded so a long-lived dev server can't grow the heap without limit. */
const MAX_MEMORY_ENTRIES = 500;

const memory = new Map<string, CacheEntry>();
/** Monotonic per-key write counter, so consumers can detect real changes cheaply. */
const versions = new Map<string, number>();

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  writes: number;
  evictions: number;
  invalidations: number;
}

const stats: CacheStats = {
  hits: 0,
  misses: 0,
  staleHits: 0,
  writes: 0,
  evictions: 0,
  invalidations: 0,
};

export function cacheStats(): Readonly<CacheStats> {
  return { ...stats };
}

/** Map insertion order is its LRU order once we re-insert on read (see `touch`). */
function evictIfNeeded(): void {
  while (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
    stats.evictions += 1;
  }
}

/** Re-insert to move a key to the "most recently used" end of the Map. */
function touch(key: string, entry: CacheEntry): void {
  memory.delete(key);
  memory.set(key, entry);
}

function freshnessOf(meta: CacheMeta, now: number): FreshnessState {
  if (now < meta.expiresAt) return "fresh";
  const policy = policyFor(meta.dataset);
  if (now < meta.expiresAt + policy.swrMs) return "revalidating";
  return "stale";
}

/**
 * Read through both tiers.
 *
 * Returns null for a true miss (nothing cached, or cached past even the SWR
 * window). A hit inside the SWR window comes back with `freshness:
 * "revalidating"` — the caller is expected to serve it AND kick a background
 * refresh; it is not free to just serve it and forget.
 */
export function readCache<T>(key: string, now = Date.now()): CacheEntry<T> | null {
  let entry = memory.get(key) as CacheEntry<T> | undefined;

  // L1 miss — try the disk tier for persisted datasets and promote on hit.
  if (!entry) {
    const row = getPlatformCache(key);
    if (row) {
      try {
        entry = {
          value: JSON.parse(row.value) as T,
          meta: {
            key: row.cacheKey,
            dataset: row.dataset as DatasetId,
            symbol: row.symbol,
            fetchedAt: row.fetchedAt,
            expiresAt: row.expiresAt,
            source: row.source as CacheMeta["source"],
            freshness: "fresh",
            version: row.version,
          },
        };
        evictIfNeeded();
        memory.set(key, entry as CacheEntry);
        versions.set(key, row.version);
      } catch {
        // Corrupted row (truncated write, schema drift). Drop it and treat as a
        // miss rather than letting a bad blob propagate into the UI.
        deletePlatformCache({ cacheKey: key });
        entry = undefined;
      }
    }
  }

  if (!entry) {
    stats.misses += 1;
    return null;
  }

  const freshness = freshnessOf(entry.meta, now);
  if (freshness === "stale") {
    stats.misses += 1;
    return null;
  }

  touch(key, entry as CacheEntry);
  if (freshness === "revalidating") stats.staleHits += 1;
  else stats.hits += 1;

  return { value: entry.value, meta: { ...entry.meta, freshness } };
}

/**
 * Write a freshly-fetched value. Persists to disk when the dataset's policy
 * says so. Never called with a provider failure — errors are not cacheable.
 */
export function writeCache<T>(
  dataset: DatasetId,
  key: string,
  value: T,
  symbol: string | null = null,
  now = Date.now(),
): CacheEntry<T> {
  const policy = policyFor(dataset);
  const version = (versions.get(key) ?? 0) + 1;
  versions.set(key, version);

  const meta: CacheMeta = {
    key,
    dataset,
    symbol,
    fetchedAt: now,
    expiresAt: now + policy.ttlMs,
    source: policy.source,
    freshness: "fresh",
    version,
  };
  const entry: CacheEntry<T> = { value, meta };

  evictIfNeeded();
  memory.set(key, entry as CacheEntry);
  stats.writes += 1;

  if (policy.persist) {
    try {
      putPlatformCache({
        cacheKey: key,
        dataset,
        symbol,
        value: JSON.stringify(value),
        fetchedAt: now,
        expiresAt: meta.expiresAt,
        source: policy.source,
        version,
      });
    } catch {
      // Disk persistence is an optimization, not a correctness requirement.
      // A failed write (disk full, value not serializable) must not fail the
      // request that produced perfectly good in-memory data.
    }
  }

  return entry;
}

/**
 * Dependency-aware invalidation.
 *
 * Given a root dataset, drops it and every dataset derived from it, scoped to
 * one symbol when supplied. This is what lets "AAPL filed a new 10-Q" do the
 * right thing: `invalidate({ symbol: "AAPL", dataset: "filings" })` clears
 * filings → statements → fundamentals → peers → companyContext → aiVerdict for
 * AAPL only, leaving AAPL's price history and profile — and every other
 * symbol — alone.
 *
 * Returns the datasets that were actually cleared.
 */
export function invalidate(opts: {
  symbol?: string;
  dataset?: DatasetId;
  /** Skip the dependents cascade and clear only the named dataset. */
  exact?: boolean;
}): DatasetId[] {
  const { symbol, dataset, exact = false } = opts;
  const targets: DatasetId[] = dataset
    ? exact
      ? [dataset]
      : dependencyClosure(dataset)
    : [];

  const upperSymbol = symbol?.trim().toUpperCase();

  for (const [key, entry] of [...memory.entries()]) {
    const datasetMatches = targets.length === 0 || targets.includes(entry.meta.dataset);
    const symbolMatches = upperSymbol == null || entry.meta.symbol === upperSymbol;
    if (datasetMatches && symbolMatches) {
      memory.delete(key);
      stats.invalidations += 1;
    }
  }

  try {
    deletePlatformCache({
      ...(upperSymbol ? { symbol: upperSymbol } : {}),
      ...(targets.length > 0 ? { datasets: targets } : {}),
    });
  } catch {
    /* the memory tier is already clear; a disk-delete failure is non-fatal */
  }

  return targets;
}

/**
 * Drop everything, in BOTH tiers. Used by tests and the "hard refresh" affordance.
 *
 * The disk purge is not optional: clearing only the memory tier leaves every
 * `persist: true` dataset (history, statements, filings, profiles, AI reports)
 * intact on disk, so the very next read promotes it straight back into memory
 * and "clear the cache" silently does almost nothing.
 */
export function clearCache(): void {
  memory.clear();
  versions.clear();
  try {
    prunePlatformCache(Number.MAX_SAFE_INTEGER);
  } catch {
    /* memory tier is already clear; a disk-delete failure is non-fatal */
  }
}

/** Remove rows whose SWR window has fully elapsed. Cheap; safe to call on a timer. */
export function pruneExpired(now = Date.now()): number {
  let removed = 0;
  for (const [key, entry] of [...memory.entries()]) {
    if (freshnessOf(entry.meta, now) === "stale") {
      memory.delete(key);
      removed += 1;
    }
  }
  try {
    // Disk rows are only prunable once even their SWR window is gone; the
    // registry's longest SWR window is the safe floor.
    prunePlatformCache(now - 7 * 24 * 60 * 60 * 1000);
  } catch {
    /* non-fatal */
  }
  return removed;
}

export { cacheKey };
