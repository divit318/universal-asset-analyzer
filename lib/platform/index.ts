/**
 * Platform Performance & Data Infrastructure Layer — public API.
 *
 * Server-side entry point. Client components import from
 * `lib/platform/client` instead (this module reaches SQLite through cache.ts
 * and would drag `node:sqlite` into a client bundle).
 *
 * See lib/platform/data-layer.ts for the one path every fetch takes.
 */

export { getDataset, peekDataset, invalidateAsset, invalidateDataset, datasetTtlMs } from "./data-layer";
export type { GetDatasetOptions } from "./data-layer";

export { runPlan, mapLimit, stepValue, stepError } from "./orchestrator";
export type { PlanOptions } from "./orchestrator";

export { dedupe, dedupStats, inflightKeys, resetDedup } from "./dedup";
export { cacheStats, clearCache, pruneExpired, invalidate } from "./cache";
export { DATASETS, cacheKey, dependencyClosure, policyFor } from "./registry";

export type {
  CacheEntry,
  CacheMeta,
  CachePolicy,
  DatasetId,
  DatasetResult,
  FreshnessState,
  PlanResult,
  PlanStep,
  StepResult,
  StepStatus,
} from "./types";
