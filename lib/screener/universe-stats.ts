/**
 * Precomputed distribution statistics for a built universe.
 *
 * This module exists to keep one promise: **nothing expensive happens while the
 * user is filtering.** Everything a relative filter, the ranking layer, a
 * histogram or the infeasibility solver needs to know about the *shape* of the
 * universe is computed once per universe build, cached, and then read as an O(1)
 * map lookup per row.
 *
 * That inverts the previous cost model rather than adding to it. `rankAll` used
 * to sort the whole universe once per rank factor on **every request** — three
 * to five sorts of up to 1,540 rows per screen, repeated for every keystroke's
 * worth of re-running. Those sorts now happen here, once per 12-hour build, and
 * ranking reads the result. Adding relative frames and soft preferences
 * therefore makes the hot path *cheaper*, not more expensive: a screen with ten
 * soft preferences costs the same as a screen with none.
 *
 * What's cached, per (class, buildAt):
 *   - percentile of every candidate for every numeric metric, class-wide
 *   - the same within the candidate's peer group (sector, issuer type, …)
 *   - a coarse histogram + min/max/median per metric, for the filter UI
 *   - coverage: how many candidates actually have a value, per metric
 *
 * Memory is bounded and small: two floats per (candidate × metric). The largest
 * universe (1,540 equities × ~45 metrics) is ~140k numbers, i.e. low single-digit
 * megabytes, held once.
 *
 * Staleness, stated plainly: the cache is keyed on the universe's `builtAt`, and
 * the equity dataset refreshes its *price* layer every five minutes without
 * rebuilding. So percentiles for price-derived metrics can be up to a build
 * stale. That is the right trade — and arguably the desirable one, since it also
 * means a name's percentile doesn't drift under the user mid-session for reasons
 * unrelated to their screen.
 */

import { getAssetClass } from "../assets/registry";
import type { AssetClassId } from "../assets/types";
import type { ScreenerCandidate } from "./types";

/** Number of buckets in a metric's histogram. Enough shape to aim a filter with. */
const HISTOGRAM_BUCKETS = 24;

export interface MetricDistribution {
  key: string;
  /** How many candidates have a real value — the honest denominator for a filter. */
  covered: number;
  total: number;
  min: number;
  max: number;
  median: number;
  p10: number;
  p90: number;
  /** Equal-width bucket counts between min and max. */
  histogram: number[];
}

export interface UniverseStats {
  assetClass: AssetClassId;
  builtAt: string | null;
  count: number;
  /** metric key → symbol → percentile (0-100, 100 = best), class-wide. */
  classPercentiles: Map<string, Map<string, number>>;
  /** metric key → symbol → percentile within the candidate's peer group. */
  peerPercentiles: Map<string, Map<string, number>>;
  /** symbol → peer group label, for explanation copy ("top decile of Financials"). */
  peerGroupOf: Map<string, string>;
  /** Size of each peer group, so the UI can refuse to claim a percentile off 3 names. */
  peerGroupSize: Map<string, number>;
  distributions: Map<string, MetricDistribution>;
}

/**
 * Percentiles for one metric over one set of candidates, ties sharing the
 * midpoint of the range they span, `better` folded in so 100 is always best.
 *
 * Deliberately duplicated in spirit from ranking.ts#percentileRank rather than
 * imported: that one is the public, per-request API taking a direction
 * override; this one is the bulk builder. Keeping them separate means the
 * cached path can't be accidentally changed by a tweak to the request path.
 */
function percentilesFor(
  rows: { symbol: string; value: number }[],
  better: "higher" | "lower" | null,
): Map<string, number> {
  const out = new Map<string, number>();
  const n = rows.length;
  if (n === 0) return out;
  if (n === 1) {
    out.set(rows[0].symbol, 50);
    return out;
  }

  const sorted = [...rows].sort((a, b) => a.value - b.value);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    const pct = (((i + j) / 2) / (n - 1)) * 100;
    for (let k = i; k <= j; k++) {
      out.set(sorted[k].symbol, better === "lower" ? 100 - pct : pct);
    }
    i = j + 1;
  }
  return out;
}

function distributionFor(key: string, values: number[], total: number): MetricDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  const histogram = new Array<number>(HISTOGRAM_BUCKETS).fill(0);
  const span = max - min;
  for (const v of sorted) {
    // A degenerate span (every value identical) puts everything in bucket 0
    // rather than dividing by zero.
    const b = span === 0 ? 0 : Math.min(HISTOGRAM_BUCKETS - 1, Math.floor(((v - min) / span) * HISTOGRAM_BUCKETS));
    histogram[b]++;
  }

  return { key, covered: values.length, total, min, max, median: at(0.5), p10: at(0.1), p90: at(0.9), histogram };
}

function build(assetClass: AssetClassId, candidates: ScreenerCandidate[], builtAt: string | null): UniverseStats {
  const def = getAssetClass(assetClass);
  const groupKey = def.peerGroupBy;

  const peerGroupOf = new Map<string, string>();
  const peerGroupSize = new Map<string, number>();
  for (const c of candidates) {
    const group = (groupKey ? c.attributes[groupKey] : null) ?? "—";
    peerGroupOf.set(c.symbol, group);
    peerGroupSize.set(group, (peerGroupSize.get(group) ?? 0) + 1);
  }

  const classPercentiles = new Map<string, Map<string, number>>();
  const peerPercentiles = new Map<string, Map<string, number>>();
  const distributions = new Map<string, MetricDistribution>();

  for (const metric of def.metrics) {
    // Categorical and unavailable metrics have no distribution to describe.
    if (metric.options || metric.availability === "unavailable") continue;

    const rows: { symbol: string; value: number }[] = [];
    for (const c of candidates) {
      const v = c.metrics[metric.key];
      if (v != null && Number.isFinite(v)) rows.push({ symbol: c.symbol, value: v });
    }
    if (rows.length === 0) continue;

    classPercentiles.set(metric.key, percentilesFor(rows, metric.better));

    const dist = distributionFor(metric.key, rows.map((r) => r.value), candidates.length);
    if (dist) distributions.set(metric.key, dist);

    // Peer percentiles: the same computation, once per group. A percentile off a
    // group of one is meaningless, so single-member groups are left absent
    // rather than reported as 50 — the filter engine treats absent as unknown
    // and the missing-data policy then applies, which is the honest outcome.
    if (!groupKey) continue;
    const byGroup = new Map<string, { symbol: string; value: number }[]>();
    for (const r of rows) {
      const g = peerGroupOf.get(r.symbol) ?? "—";
      const list = byGroup.get(g);
      if (list) list.push(r);
      else byGroup.set(g, [r]);
    }
    const merged = new Map<string, number>();
    for (const [, groupRows] of byGroup) {
      if (groupRows.length < 2) continue;
      for (const [sym, pct] of percentilesFor(groupRows, metric.better)) merged.set(sym, pct);
    }
    peerPercentiles.set(metric.key, merged);
  }

  return {
    assetClass,
    builtAt,
    count: candidates.length,
    classPercentiles,
    peerPercentiles,
    peerGroupOf,
    peerGroupSize,
    distributions,
  };
}

/**
 * One entry per asset class. Keyed by `builtAt` + row count so a rebuild
 * invalidates it automatically and nothing has to remember to clear it.
 *
 * Not a WeakMap keyed on the candidates array, which would have been the
 * tidier-looking option: the equity provider maps a fresh array out of
 * lib/dataset.ts on every single call, so a reference-keyed cache would miss
 * every time for the largest universe in the app — exactly the case that needs
 * it most.
 */
const cache = new Map<AssetClassId, { key: string; stats: UniverseStats }>();

export function getUniverseStats(
  assetClass: AssetClassId,
  candidates: ScreenerCandidate[],
  builtAt: string | null,
): UniverseStats {
  const key = `${builtAt ?? "none"}:${candidates.length}`;
  const hit = cache.get(assetClass);
  if (hit && hit.key === key) return hit.stats;

  const stats = build(assetClass, candidates, builtAt);
  cache.set(assetClass, { key, stats });
  return stats;
}

/** Percentile of one candidate for one metric in the requested frame, or null if unknown. */
export function framedPercentile(
  stats: UniverseStats,
  frame: "class" | "peer",
  metricKey: string,
  symbol: string,
): number | null {
  const table = frame === "peer" ? stats.peerPercentiles : stats.classPercentiles;
  return table.get(metricKey)?.get(symbol) ?? null;
}
