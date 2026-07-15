/**
 * The Platform Data Layer — the single front door for every piece of data in UAA.
 *
 * The whole point of this file is that there is exactly ONE path from a caller
 * to a provider, and it always looks like this:
 *
 *     getDataset()
 *        → cache read (fresh?  serve, done — provider never contacted)
 *        → cache read (stale within SWR?  serve immediately, refresh in background)
 *        → deduplicate (identical work already running?  attach to it)
 *        → provider fetch
 *        → normalize
 *        → cache write
 *        → return
 *
 * Nothing bypasses it. Not the Screener, not the Scanner, not the AI context
 * builder, not AI generation itself. The moment one module is allowed its own
 * fetch-and-cache, the guarantees below stop holding for everybody:
 *
 *   - Every module sees the *same* normalized value for a given asset. Research,
 *     Portfolio, Compare, and Watchlist cannot disagree about Apple's price,
 *     because they are all reading the same cache entry, not four independent
 *     copies fetched at four different moments.
 *   - The same request is never executed twice concurrently.
 *   - Freshness is a property of the dataset, decided once, in the registry.
 *
 * Server-only: reaches lib/db.ts through cache.ts.
 */

import { invalidate as invalidateCache, readCache, writeCache } from "./cache";
import { dedupe } from "./dedup";
import { cacheKey, policyFor } from "./registry";
import type { DatasetId, DatasetResult } from "./types";

export interface GetDatasetOptions {
  /** Skip the cache read and force a live fetch. Still deduplicated. */
  fresh?: boolean;
  /** Cancels this consumer's interest (see dedup.ts — refcounted, not destructive). */
  signal?: AbortSignal;
  /**
   * The asset this belongs to. Enables per-symbol invalidation. Derived from
   * `params.symbol` when not given explicitly.
   */
  symbol?: string;
}

/** Keys with a background refresh already scheduled — prevents SWR refresh storms. */
const revalidating = new Set<string>();

/**
 * Fetch a dataset through cache + dedup.
 *
 * `fetcher` is only ever invoked on a genuine miss, and only ever once per key
 * per moment in time no matter how many callers are asking.
 */
export async function getDataset<T>(
  dataset: DatasetId,
  params: Record<string, string | number | boolean | null | undefined>,
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: GetDatasetOptions = {},
): Promise<DatasetResult<T>> {
  const key = cacheKey(dataset, params);
  const symbol =
    opts.symbol?.trim().toUpperCase() ??
    (typeof params.symbol === "string" ? params.symbol.trim().toUpperCase() : null);

  if (!opts.fresh) {
    const hit = readCache<T>(key);
    if (hit) {
      // Inside the SWR window: serve the cached value *now* and refresh behind
      // the user's back. The refresh goes through dedup as a background request,
      // so a foreground caller arriving a moment later subscribes to the
      // in-flight refresh rather than starting a second one.
      if (hit.meta.freshness === "revalidating") {
        scheduleRevalidation(dataset, key, params, fetcher, symbol);
      }
      return {
        data: hit.value,
        meta: hit.meta,
        cached: true,
        revalidating: hit.meta.freshness === "revalidating",
      };
    }
  }

  const value = await dedupe(key, fetcher, { signal: opts.signal });
  const entry = writeCache(dataset, key, value, symbol);

  return { data: entry.value, meta: entry.meta, cached: false, revalidating: false };
}

/**
 * Kick a background refresh for a stale-but-servable key.
 *
 * Deliberately fire-and-forget: the caller has already been handed the cached
 * value and must not wait on this. Failures are swallowed — a failed background
 * refresh simply means the cached value stays until the SWR window closes, at
 * which point the next read becomes a blocking miss. That is the correct
 * degradation: never surface a background error as a foreground failure.
 */
function scheduleRevalidation<T>(
  dataset: DatasetId,
  key: string,
  params: Record<string, string | number | boolean | null | undefined>,
  fetcher: (signal: AbortSignal) => Promise<T>,
  symbol: string | null,
): void {
  if (revalidating.has(key)) return;
  revalidating.add(key);

  void dedupe(key, fetcher, { background: true })
    .then((value) => {
      writeCache(dataset, key, value, symbol);
    })
    .catch(() => {
      /* see doc comment: a failed background refresh must not surface */
    })
    .finally(() => {
      revalidating.delete(key);
    });
}

/**
 * Read a dataset from cache only — never contacts a provider.
 *
 * For callers that must not block (a render pass, a "what do we already know"
 * probe) and are happy with null.
 */
export function peekDataset<T>(
  dataset: DatasetId,
  params: Record<string, string | number | boolean | null | undefined> = {},
): DatasetResult<T> | null {
  const key = cacheKey(dataset, params);
  const hit = readCache<T>(key);
  if (!hit) return null;
  return {
    data: hit.value,
    meta: hit.meta,
    cached: true,
    revalidating: hit.meta.freshness === "revalidating",
  };
}

/**
 * Dependency-aware invalidation, re-exported as the platform's public verb.
 *
 * Callers name the *event* that happened, not the caches to clear:
 *
 *     invalidateAsset("AAPL", "filings")   // a new 10-Q landed
 *
 * and the registry's dependency graph works out that this must cascade to
 * statements → fundamentals → peers → companyContext → aiVerdict, while leaving
 * AAPL's price history, AAPL's profile, and every other symbol untouched.
 */
export function invalidateAsset(symbol: string, dataset?: DatasetId): DatasetId[] {
  return invalidateCache({ symbol, ...(dataset ? { dataset } : {}) });
}

/** Invalidate one dataset across every asset (e.g. a provider issued a correction). */
export function invalidateDataset(dataset: DatasetId): DatasetId[] {
  return invalidateCache({ dataset });
}

/** The TTL a dataset is cached for — surfaced to provenance/freshness badges. */
export function datasetTtlMs(dataset: DatasetId): number {
  return policyFor(dataset).ttlMs;
}
