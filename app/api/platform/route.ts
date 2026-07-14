import { NextResponse } from "next/server";
import { cacheStats, clearCache, pruneExpired } from "@/lib/platform/cache";
import { dedupStats, inflightKeys } from "@/lib/platform/dedup";
import { invalidateAsset } from "@/lib/platform/data-layer";
import { DATASETS } from "@/lib/platform/registry";
import type { DatasetId } from "@/lib/platform/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/platform — observability for the Platform Data Layer.
 *
 * Cache hit/miss/eviction counters, deduplication counters (how much duplicate
 * provider work was actually eliminated), what is in flight right now, and the
 * registered dataset policies. This is the "memory monitoring" and "expose cache
 * metadata" half of the platform contract — without it, the cache is a black box
 * and nobody can tell whether it is helping or quietly serving stale data.
 */
export async function GET() {
  const cache = cacheStats();
  const dedup = dedupStats();

  const totalReads = cache.hits + cache.staleHits + cache.misses;
  const hitRate = totalReads > 0 ? (cache.hits + cache.staleHits) / totalReads : 0;
  const totalRequests = dedup.executed + dedup.coalesced;
  const coalesceRate = totalRequests > 0 ? dedup.coalesced / totalRequests : 0;

  return NextResponse.json({
    cache: {
      ...cache,
      totalReads,
      hitRate: Number(hitRate.toFixed(4)),
    },
    dedup: {
      ...dedup,
      totalRequests,
      /** Share of requests that never touched a provider because an identical one was already running. */
      coalesceRate: Number(coalesceRate.toFixed(4)),
    },
    inflight: inflightKeys(),
    datasets: Object.fromEntries(
      Object.entries(DATASETS).map(([id, p]) => [
        id,
        {
          ttlMs: p.ttlMs,
          swrMs: p.swrMs,
          persist: p.persist,
          source: p.source,
          dependents: p.dependents ?? [],
        },
      ]),
    ),
  });
}

/**
 * DELETE /api/platform — invalidation.
 *
 *   ?symbol=AAPL&dataset=filings  → dependency-aware: filings and everything
 *                                   derived from them, for AAPL only
 *   ?symbol=AAPL                  → every dataset for AAPL
 *   ?prune=1                      → drop entries past their SWR window
 *   (no params)                   → clear everything (hard refresh)
 */
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.trim().toUpperCase();
  const dataset = params.get("dataset") as DatasetId | null;

  if (dataset && !(dataset in DATASETS)) {
    return NextResponse.json({ error: `Unknown dataset "${dataset}"` }, { status: 400 });
  }

  if (params.get("prune")) {
    return NextResponse.json({ pruned: pruneExpired() });
  }

  if (symbol) {
    const cleared = invalidateAsset(symbol, dataset ?? undefined);
    return NextResponse.json({ symbol, cleared });
  }

  clearCache();
  return NextResponse.json({ cleared: "all" });
}
