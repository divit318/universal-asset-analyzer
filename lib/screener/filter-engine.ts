/**
 * The generic filter engine. One implementation, seven asset classes: it
 * knows nothing about P/E ratios or bond duration, only about ranges over
 * `metrics` and equality over `attributes`, with the meaning of every key
 * looked up in the Asset Registry.
 *
 * This replaces both of the old hand-maintained filter functions
 * (lib/screener.ts#applyFilters and lib/fundamental-screener.ts#applyScreen),
 * which each hardcoded their field list and had to be edited in lockstep with
 * the criteria type.
 */

import { getAssetClass, getMetric } from "../assets/registry";
import type { AssetClassId, FilterValue, FilterValues } from "../assets/types";
import type { ScreenerCandidate } from "./types";

/**
 * The rule inherited from the original screener, and worth restating because
 * it is load-bearing: **an active filter excludes a candidate whose value is
 * unknown.** You cannot confirm that an unknown ROIC clears a 12% floor, so a
 * name with no ROIC does not pass an ROIC filter.
 *
 * The corollary is the reason MetricAvailability exists in the registry: if a
 * metric is null for *every* candidate because no provider supplies it, then
 * filtering on it returns an empty table. That is a data gap wearing the
 * costume of a screening result. Registry-level `unavailable` metrics never
 * become filters, so that can't happen — but `isFilterable` re-checks it here
 * too, because this engine is also fed by saved screens and API callers that
 * predate a metric being retired.
 */
function inRange(value: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true; // not actually an active filter
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** True when a filter value actually constrains anything. */
export function isActive(v: FilterValue | undefined): boolean {
  if (!v) return false;
  switch (v.kind) {
    case "range":
      return v.min != null || v.max != null;
    case "select":
      return v.value != null && v.value !== "";
    case "multiselect":
      return v.values.length > 0;
    case "boolean":
      return v.value != null;
  }
}

/** A filter is only honoured if its metric exists on this class and has a real data source. */
function isFilterable(assetClass: AssetClassId, key: string): boolean {
  const metric = getMetric(assetClass, key);
  return metric != null && metric.availability !== "unavailable";
}

/** The subset of `filters` that are both active and backed by real data. */
export function activeFilters(assetClass: AssetClassId, filters: FilterValues): FilterValues {
  const out: FilterValues = {};
  for (const [key, value] of Object.entries(filters)) {
    if (isActive(value) && isFilterable(assetClass, key)) out[key] = value;
  }
  return out;
}

function matchesOne(candidate: ScreenerCandidate, key: string, filter: FilterValue): boolean {
  switch (filter.kind) {
    case "range":
      return inRange(candidate.metrics[key] ?? null, filter.min, filter.max);

    case "select": {
      if (filter.value == null) return true;
      const actual = candidate.attributes[key];
      return actual != null && actual.toLowerCase() === filter.value.toLowerCase();
    }

    case "multiselect": {
      if (filter.values.length === 0) return true;
      const actual = candidate.attributes[key];
      if (actual == null) return false;
      return filter.values.some((v) => v.toLowerCase() === actual.toLowerCase());
    }

    case "boolean": {
      if (filter.value == null) return true;
      const actual = candidate.metrics[key];
      if (actual == null) return false;
      return (actual !== 0) === filter.value;
    }
  }
}

/** Does this candidate clear every active filter? */
export function matches(
  candidate: ScreenerCandidate,
  assetClass: AssetClassId,
  filters: FilterValues,
): boolean {
  for (const [key, filter] of Object.entries(activeFilters(assetClass, filters))) {
    if (!matchesOne(candidate, key, filter)) return false;
  }
  return true;
}

export function applyFilters(
  candidates: ScreenerCandidate[],
  assetClass: AssetClassId,
  filters: FilterValues,
): ScreenerCandidate[] {
  const active = activeFilters(assetClass, filters);
  if (Object.keys(active).length === 0) return candidates;
  return candidates.filter((c) => matches(c, assetClass, active));
}

/* -------------------------------------------------------------------------- */
/* Parsing untrusted input                                                     */
/* -------------------------------------------------------------------------- */

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize a raw request body / saved-screen row into typed FilterValues,
 * discarding anything that isn't a real, available metric on this class. The
 * single validation gate between the outside world and the engine.
 */
export function parseFilters(assetClass: AssetClassId, raw: unknown): FilterValues {
  if (raw == null || typeof raw !== "object") return {};
  const def = getAssetClass(assetClass);
  const byKey = new Map(def.metrics.map((m) => [m.key, m]));
  const out: FilterValues = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const metric = byKey.get(key);
    if (!metric || metric.availability === "unavailable") continue;
    if (value == null || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;

    // Categorical metrics accept select/multiselect; everything else is a range.
    if (metric.options) {
      const allowed = new Set(metric.options.map((o) => o.toLowerCase()));
      if (Array.isArray(v.values)) {
        const values = v.values
          .filter((x): x is string => typeof x === "string" && allowed.has(x.toLowerCase()));
        if (values.length) out[key] = { kind: "multiselect", values };
      } else if (typeof v.value === "string" && allowed.has(v.value.toLowerCase())) {
        out[key] = { kind: "select", value: v.value };
      }
      continue;
    }

    const min = num(v.min);
    const max = num(v.max);
    if (min != null || max != null) out[key] = { kind: "range", min, max };
  }

  return out;
}
