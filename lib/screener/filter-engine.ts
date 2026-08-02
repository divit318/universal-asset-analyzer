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
import { framedPercentile, type UniverseStats } from "./universe-stats";

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

/**
 * The value a range filter is actually compared against: the raw metric for an
 * absolute filter, or the candidate's precomputed percentile for a framed one.
 *
 * Framed filters need `stats`; without it (a caller that hasn't built them, or a
 * universe too small to have them) the filter degrades to "unknown" and the
 * missing-data policy decides. It never silently falls back to comparing a
 * percentile threshold against a raw P/E, which would pass nonsense.
 */
function comparableValue(
  candidate: ScreenerCandidate,
  key: string,
  filter: Extract<FilterValue, { kind: "range" }>,
  stats: UniverseStats | null,
): number | null {
  const frame = filter.frame ?? "absolute";
  if (frame === "absolute") return candidate.metrics[key] ?? null;
  if (!stats) return null;
  return framedPercentile(stats, frame, key, candidate.symbol);
}

function matchesOne(
  candidate: ScreenerCandidate,
  key: string,
  filter: FilterValue,
  stats: UniverseStats | null = null,
): boolean {
  switch (filter.kind) {
    case "range": {
      const value = comparableValue(candidate, key, filter, stats);
      // The unknown-value rule, now per filter instead of global. `include`
      // means "don't hold a data gap against this name"; the default `exclude`
      // is unchanged from every previous version of this engine.
      if (value == null) return (filter.missing ?? "exclude") === "include";
      return inRange(value, filter.min, filter.max);
    }

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
  stats: UniverseStats | null = null,
): boolean {
  for (const [key, filter] of Object.entries(activeFilters(assetClass, filters))) {
    if (!matchesOne(candidate, key, filter, stats)) return false;
  }
  return true;
}

export function applyFilters(
  candidates: ScreenerCandidate[],
  assetClass: AssetClassId,
  filters: FilterValues,
  stats: UniverseStats | null = null,
): ScreenerCandidate[] {
  const active = activeFilters(assetClass, filters);
  if (Object.keys(active).length === 0) return candidates;
  return candidates.filter((c) => matches(c, assetClass, active, stats));
}

/* -------------------------------------------------------------------------- */
/* Diagnostics: why is this screen empty, and which filter is binding?         */
/* -------------------------------------------------------------------------- */

export interface FilterDiagnostic {
  key: string;
  label: string;
  /** How many candidates clear *every other* active filter but fail this one. */
  blocks: number;
  /** How many would survive if this filter alone were dropped. */
  survivorsWithoutIt: number;
  /**
   * How many candidates this filter admits **on its own**, ignoring every other
   * filter.
   *
   * This is the field that makes the diagnosis work when filters are *jointly*
   * infeasible. Dropping any single filter from "expense ≤ 0.02% AND AUM ≥ $50B
   * AND yield ≥ 6%" still returns nothing, so a leave-one-out analysis reports
   * every filter as blocking zero — technically true, completely useless. The
   * solo count immediately fingers the culprit: AUM ≥ $50B admits 12 funds by
   * itself, yield ≥ 6% admits 3, and expense ≤ 0.02% admits 1.
   */
  soloSurvivors: number;
  /**
   * The loosest threshold that would admit at least one name, in the filter's
   * own units — i.e. the answer to "what would I have to accept?".
   */
  relaxTo: number | null;
  /** Which bound is doing the blocking. */
  bound: "min" | "max" | null;
  /**
   * True when `relaxTo` was computed against the whole universe rather than
   * against the rows clearing the other filters — which happens exactly when
   * nothing clears the other filters either. The UI must not promise "relax this
   * and you get results" in that case, because the screen is over-constrained in
   * more than one place.
   */
  relaxToIsUniverseWide: boolean;
}

/**
 * Explain an empty (or near-empty) screen instead of shrugging at it.
 *
 * "Nothing matched" is the least useful sentence a screener can say. The user
 * set eight filters; exactly one or two of them are responsible, and the fix is
 * usually a couple of percent of slack on a single number. This finds that
 * number: for each active filter, how many candidates clear everything *else*,
 * and what the threshold would have to become to admit one.
 *
 * **Only ever called when a screen returns nothing** (see pipeline.ts), so it
 * costs nothing on the normal path. Even when it does run it is O(filters ×
 * candidates) over an in-memory array — single-digit milliseconds on the largest
 * universe, and only in the case where the user is already stuck.
 */
export function diagnose(
  candidates: ScreenerCandidate[],
  assetClass: AssetClassId,
  filters: FilterValues,
  stats: UniverseStats | null = null,
): FilterDiagnostic[] {
  const active = activeFilters(assetClass, filters);
  const keys = Object.keys(active);
  if (keys.length === 0) return [];

  return keys
    .map((key): FilterDiagnostic => {
      const filter = active[key];
      const others = Object.fromEntries(keys.filter((k) => k !== key).map((k) => [k, active[k]]));
      const passOthers = candidates.filter((c) => matches(c, assetClass, others, stats));
      const survivors = passOthers.filter((c) => matchesOne(c, key, filter, stats)).length;
      const soloSurvivors = candidates.filter((c) => matchesOne(c, key, filter, stats)).length;

      /*
       * `relaxTo` is a promise — "move this number here and you get results" —
       * so it is only computed when that promise can actually be kept: when
       * some rows clear every *other* filter, and this filter is the single
       * thing standing between them and the user.
       *
       * The tempting generalisation was to fall back to the whole universe when
       * nothing clears the others, and report the reachable extreme. That number
       * is worse than nothing: in a jointly over-constrained screen it says
       * "relax expense to 0.03%" while three other filters still exclude
       * everything, and the user relaxes it and gets nothing again. In that case
       * the honest answer is the solo counts, which say *no single change is
       * enough* and name the filter that admits fewest.
       */
      let relaxTo: number | null = null;
      let bound: "min" | "max" | null = null;
      if (filter.kind === "range" && passOthers.length > 0) {
        const values = passOthers
          .map((c) => comparableValue(c, key, filter, stats))
          .filter((v): v is number => v != null);
        if (values.length > 0) {
          // Whichever bound nothing in the pool can satisfy is the binding one;
          // the loosest useful threshold is then the closest anything gets to it.
          if (filter.min != null && !values.some((v) => v >= filter.min!)) {
            relaxTo = Math.max(...values);
            bound = "min";
          } else if (filter.max != null && !values.some((v) => v <= filter.max!)) {
            relaxTo = Math.min(...values);
            bound = "max";
          }
        }
      }

      return {
        key,
        label: getMetric(assetClass, key)?.label ?? key,
        blocks: passOthers.length - survivors,
        survivorsWithoutIt: passOthers.length,
        soloSurvivors,
        relaxTo,
        bound,
        relaxToIsUniverseWide: passOthers.length === 0,
      };
    })
    /*
     * Order by how much each filter is costing, most-costly first.
     *
     * `blocks` is the right signal when one filter is the problem. When the
     * screen is jointly over-constrained every filter blocks zero, so the
     * tie-break is the solo count ascending: the filter that admits the fewest
     * names by itself is the one to loosen, and it leads.
     */
    .sort((a, b) => b.blocks - a.blocks || a.soloSurvivors - b.soloSurvivors);
}

export interface BindingConstraint {
  key: string;
  label: string;
  /**
   * How close to failing, measured in units of the metric's own universe spread
   * (its 10th-to-90th-percentile range). 0 = sitting exactly on the threshold;
   * 1 = a whole population spread clear of it.
   *
   * Normalising by the *threshold* was the obvious choice and the wrong one: it
   * made slack scale-dependent in a way that inverted the answer. A stock at a
   * 7.9x P/E against a 25x cap scored 0.68 "slack" while its 40% ROIC against a
   * 12% floor scored 2.3, so the row was reported as "closest to failing on P/E"
   * when the P/E was the single most comfortable thing about it. Dividing by how
   * much the metric actually varies across the universe makes the comparison
   * between a 0.03% expense ratio and a $10B market cap statistically
   * meaningful, and it comes free from the precomputed distributions.
   */
  slack: number;
  detail: string;
}

/** Slack below this reads as "only just cleared it" — worth flagging to a user. */
export const MARGINAL_SLACK = 0.15;

/**
 * The active filter a row came closest to failing.
 *
 * A screener tells you a name matched; it never tells you whether it matched
 * comfortably or scraped through by 0.4%. That distinction is most of what you
 * want to know, because a name sitting exactly on your ROIC floor is one bad
 * quarter from leaving the screen, and a name clearing every bound by miles is
 * a different proposition entirely.
 *
 * Computed for the returned page only — never the whole universe — so it costs
 * at most 50 rows × a handful of filters per request.
 */
export function bindingConstraint(
  candidate: ScreenerCandidate,
  assetClass: AssetClassId,
  filters: FilterValues,
  stats: UniverseStats | null = null,
): BindingConstraint | null {
  let tightest: BindingConstraint | null = null;

  for (const [key, filter] of Object.entries(activeFilters(assetClass, filters))) {
    if (filter.kind !== "range") continue;
    const value = comparableValue(candidate, key, filter, stats);
    if (value == null) continue;

    // The metric's own p10-p90 spread is the yardstick. A framed (percentile)
    // filter is already on a 0-100 scale, so its spread is 80 points by
    // definition. Absent distributions fall back to the threshold's magnitude.
    const frame = filter.frame ?? "absolute";
    const dist = frame === "absolute" ? stats?.distributions.get(key) : null;
    const spread = frame !== "absolute" ? 80 : dist ? Math.abs(dist.p90 - dist.p10) : 0;

    for (const [bound, limit] of [["min", filter.min], ["max", filter.max]] as const) {
      if (limit == null) continue;
      const denominator = spread || Math.abs(limit) || 1;
      const slack = Math.abs(value - limit) / denominator;
      if (tightest == null || slack < tightest.slack) {
        const metric = getMetric(assetClass, key);
        tightest = {
          key,
          label: metric?.label ?? key,
          slack,
          detail: `${value.toFixed(2)} vs ${bound === "min" ? "floor" : "cap"} ${limit}`,
        };
      }
    }
  }

  return tightest;
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
    if (min == null && max == null) continue;

    // Frame and missing-policy are narrowed against their literal unions rather
    // than cast: they arrive from request bodies and saved-screen rows, and an
    // unrecognised frame must degrade to "absolute" (the old behaviour) instead
    // of reaching the engine as a string it will silently mishandle.
    const frame =
      v.frame === "class" || v.frame === "peer" ? v.frame : ("absolute" as const);
    const missing = v.missing === "include" ? ("include" as const) : ("exclude" as const);

    // A framed filter is a percentile, so its bounds are only meaningful in
    // 0-100. Clamping here means a stale saved screen asking for "top 150%"
    // can't quietly match nothing.
    const clamp = (n: number | null) => (n == null ? null : Math.min(100, Math.max(0, n)));

    // Defaults are omitted rather than spelled out, so the serialized shape of an
    // ordinary absolute filter is byte-identical to what every previous version
    // produced. That keeps stored saved-screen JSON, request bodies and diffs
    // free of noise, and means none of the existing filter contracts had to
    // change to accommodate two new optional fields.
    out[key] = {
      kind: "range",
      min: frame === "absolute" ? min : clamp(min),
      max: frame === "absolute" ? max : clamp(max),
      ...(frame !== "absolute" ? { frame } : {}),
      ...(missing !== "exclude" ? { missing } : {}),
    };
  }

  return out;
}

/**
 * Normalize untrusted soft preferences: metric key → weight.
 *
 * Same validation gate as `parseFilters` — unknown or unavailable metrics are
 * dropped, and weights are clamped to a sane band so a saved screen can't hand
 * the ranker a weight of 10^9 and flatten every other factor to noise.
 */
export function parsePreferences(assetClass: AssetClassId, raw: unknown): Record<string, number> {
  if (raw == null || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const metric = getMetric(assetClass, key);
    // A preference on a directionless metric (market cap, maturity) has no
    // "better" to rank toward, so it is meaningless rather than merely useless.
    if (!metric || metric.availability === "unavailable" || metric.better == null) continue;
    if (metric.options) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(5, n);
  }
  return out;
}
