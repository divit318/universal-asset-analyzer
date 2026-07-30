/**
 * Platform Data Layer — shared types.
 *
 * Client-safe: this module must stay free of `node:sqlite`, provider SDKs, and
 * anything else that would drag server-only code into a client bundle. The
 * client store (lib/platform/client/) imports these same types so both halves
 * of the platform speak one vocabulary.
 */

import type { DataSourceId } from "../provenance";

/**
 * Every distinct kind of data the platform owns. A dataset is the unit of
 * caching, invalidation, and freshness — never a whole page, and never a whole
 * provider response that mixes lifecycles (a quote goes stale in seconds, the
 * company profile that arrives on the same Yahoo call does not).
 */
export type DatasetId =
  // Market data
  | "quote"
  | "quotes.batch"
  | "history"
  | "profile"
  | "quoteSummary"
  | "fundamentalsTimeSeries"
  // Fundamentals / analysis
  | "fundamentals"
  | "statements"
  | "peers"
  | "options"
  | "fundProfile"
  // Filings & news
  | "filings"
  | "cikMap"
  | "news"
  // India (screener.in)
  | "screenerIn"
  // Cross-asset / market-wide
  | "macro"
  | "sectorRotation"
  | "search"
  // Derived context + AI
  | "companyContext"
  | "aiVerdict"
  | "aiSection"
  | "thematicReport";

/** How a dataset is allowed to age, and what it depends on. */
export interface CachePolicy {
  /**
   * How long a cached value is considered *valid* — served immediately with no
   * refetch.
   */
  ttlMs: number;
  /**
   * How long past the TTL a value may still be served *while a refresh runs in
   * the background* (stale-while-revalidate). The consumer gets the cached
   * value instantly and a `revalidating` flag; the fresh value lands via the
   * normal notify path. 0 disables SWR — the consumer waits for fresh data.
   *
   * Datasets whose staleness could change an investment conclusion (a live
   * quote used for a buy/sell decision) deliberately get a short or zero SWR
   * window rather than a long one.
   */
  swrMs: number;
  /**
   * Survive a process restart by persisting to SQLite. Reserved for datasets
   * that are expensive to rebuild and change slowly (statements, filings,
   * profiles, AI reports) — never for live quotes.
   */
  persist: boolean;
  /**
   * Datasets that are *derived from* this one. Invalidating this dataset
   * cascades to them. This is what makes invalidation dependency-aware: new
   * financial statements must invalidate ratios → valuation → the AI report,
   * but must NOT touch the company profile or price history.
   */
  dependents?: DatasetId[];
  /** Which upstream feed produces it — surfaced to the provenance badge. */
  source: DataSourceId;
  /** Human label used in logs and the platform's debug endpoint. */
  label: string;
}

export type FreshnessState = "fresh" | "revalidating" | "stale";

/** Metadata carried alongside every cached value. */
export interface CacheMeta {
  /** The fully-qualified cache key (`dataset:param:param`). */
  key: string;
  dataset: DatasetId;
  /** The asset this belongs to, when it is asset-scoped — enables per-asset invalidation. */
  symbol: string | null;
  /** ms epoch when this value was produced by the provider. */
  fetchedAt: number;
  /** ms epoch when the value stops being valid (fetchedAt + ttlMs). */
  expiresAt: number;
  source: DataSourceId;
  freshness: FreshnessState;
  /** Bumped on every write; lets consumers cheaply detect "did this actually change". */
  version: number;
}

export interface CacheEntry<T = unknown> {
  value: T;
  meta: CacheMeta;
}

/** What `getDataset` hands back: the value plus everything needed to render honestly. */
export interface DatasetResult<T> {
  data: T;
  meta: CacheMeta;
  /** True when this value came from cache rather than a live provider call. */
  cached: boolean;
  /** True when a background refresh is in flight for this key (SWR). */
  revalidating: boolean;
}

/** A single step in an orchestrated request plan. */
export interface PlanStep<T = unknown> {
  /** Unique within the plan; other steps reference it in `dependsOn`. */
  id: string;
  /**
   * Steps that must complete successfully before this one starts. Only declare
   * a real data dependency (statements → ratios → AI). Anything else runs
   * concurrently.
   */
  dependsOn?: string[];
  /**
   * The work. Receives the resolved results of `dependsOn` (keyed by step id)
   * and an AbortSignal that fires on cancellation.
   */
  run: (deps: Record<string, unknown>, signal: AbortSignal) => Promise<T>;
  /**
   * When true, a failure fails the whole plan. Default false: a failed step
   * records an error, its dependents are skipped, and every unrelated step
   * still completes. Partial results beat total failure.
   */
  required?: boolean;
  /** Retry attempts for transient provider failures. Default 0. */
  retries?: number;
  /** Per-step timeout. Default: the plan's timeout. */
  timeoutMs?: number;
}

export type StepStatus = "ok" | "failed" | "skipped" | "cancelled";

export interface StepResult<T = unknown> {
  id: string;
  status: StepStatus;
  value: T | null;
  error: string | null;
  /** Wall-clock ms the step took (0 for skipped). */
  durationMs: number;
}

export interface PlanResult {
  steps: Record<string, StepResult>;
  /** Total wall-clock ms for the plan. */
  durationMs: number;
  /** True when at least one non-required step failed but the plan still produced data. */
  partial: boolean;
}
