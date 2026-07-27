/**
 * Peer-group benchmark context for the Compare engine.
 *
 * Every metric the Compare page shows is meaningful on its own, but "22.1x
 * forward P/E" only becomes a judgment once it's placed against the right
 * peer set — the Technology sector, the fund's Morningstar-style category,
 * the property type a REIT actually competes in. This module answers "what's
 * the peer average, and where does this asset rank against them" for one
 * metric at a time, using whichever universe the caller already has loaded
 * (the Screener's per-class universes, all of which already carry the
 * categorical attribute a peer group needs — sector, property type, issuer
 * type, pair type, fund focus).
 *
 * Deliberately conservative: below MIN_PEERS with real data, there is no
 * reliable peer read, so callers get `null` back and are expected to omit the
 * row rather than show a benchmark built on two or three names.
 */

import type { AssetClassId } from "../assets/types";
import { getMetric } from "../assets/registry";
import { getUniverseProvider } from "../screener/universes";

export interface PeerBenchmark {
  /** e.g. "Technology sector", "Large Growth ETFs", "Office REITs". */
  peerLabel: string;
  peerAverage: number;
  /** 0-100, direction-aware — 100 always means "best in the peer group". */
  percentile: number;
  /** Peers with real data for this metric, excluding the subject itself. */
  peerCount: number;
}

/** Minimal shape benchmarking needs — satisfied by ScreenerCandidate as-is. */
export interface BenchmarkUniverseEntry {
  symbol: string;
  attributes: Record<string, string | null | undefined>;
  metrics: Record<string, number | null | undefined>;
}

const MIN_PEERS = 5;

/** Which categorical attribute defines a peer group for each asset class. Forex intentionally omitted — a currency pair's "type" (major/minor) groups too coarsely to read as a peer benchmark. */
const PEER_ATTRIBUTE: Partial<Record<AssetClassId, string>> = {
  equity: "sector",
  etf: "focus",
  reit: "propertyType",
  crypto: "sector",
  commodity: "sector",
  bond: "issuerType",
};

const PEER_LABEL: Partial<Record<AssetClassId, (group: string) => string>> = {
  equity: (g) => `${g} sector`,
  etf: (g) => `${g} ETFs`,
  reit: (g) => `${g} REITs`,
  crypto: (g) => `${g} crypto`,
  commodity: (g) => `${g} commodities`,
  bond: (g) => `${g} bonds`,
};

/** The peer-group value (e.g. "Technology") for a candidate, or null if this asset class has no defined peer grouping or the candidate lacks the attribute. */
export function peerGroupOf(
  assetClass: AssetClassId,
  attributes: Record<string, string | null | undefined>,
): string | null {
  const attr = PEER_ATTRIBUTE[assetClass];
  if (!attr) return null;
  const v = attributes[attr];
  return v && v.trim() ? v : null;
}

/**
 * Direction-aware percentile of `value` against `peers`, ties sharing the
 * midpoint of the ranks they span — same rule lib/screener/ranking.ts uses
 * for the Screener, applied here to an arbitrary peer subset rather than the
 * whole universe.
 */
function percentileOf(value: number, peers: number[], direction: "higher" | "lower"): number {
  const all = [...peers, value].sort((a, b) => a - b);
  const n = all.length;
  if (n <= 1) return 50;
  let lo = all.indexOf(value);
  let hi = lo;
  while (lo > 0 && all[lo - 1] === value) lo--;
  while (hi + 1 < n && all[hi + 1] === value) hi++;
  const midRank = (lo + hi) / 2;
  const pct = (midRank / (n - 1)) * 100;
  return direction === "lower" ? 100 - pct : pct;
}

/**
 * Benchmark one metric for one symbol against its peer group within
 * `universe`. Returns null (never a fabricated number) when: the asset class
 * has no peer grouping, the candidate has no peer-group value, the subject
 * has no value for this metric, or fewer than MIN_PEERS peers have real data.
 */
export function computeMetricBenchmark(
  assetClass: AssetClassId,
  metricKey: string,
  subjectSymbol: string,
  subjectValue: number | null | undefined,
  peerGroup: string | null,
  universe: BenchmarkUniverseEntry[],
): PeerBenchmark | null {
  const attr = PEER_ATTRIBUTE[assetClass];
  const labelFor = PEER_LABEL[assetClass];
  if (!attr || !labelFor || !peerGroup) return null;
  if (subjectValue == null || !Number.isFinite(subjectValue)) return null;

  const peerValues = universe
    .filter(
      (c) =>
        c.symbol.toUpperCase() !== subjectSymbol.toUpperCase() &&
        c.attributes[attr] === peerGroup,
    )
    .map((c) => c.metrics[metricKey])
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (peerValues.length < MIN_PEERS) return null;

  const direction = getMetric(assetClass, metricKey)?.better ?? "higher";
  const peerAverage = peerValues.reduce((a, b) => a + b, 0) / peerValues.length;
  const percentile = Math.round(percentileOf(subjectValue, peerValues, direction === "lower" ? "lower" : "higher"));

  return {
    peerLabel: labelFor(peerGroup),
    peerAverage,
    percentile: Math.max(0, Math.min(100, percentile)),
    peerCount: peerValues.length,
  };
}

/**
 * Best-effort universe load for benchmark context. `UniverseProvider.load()`
 * blocks until the FIRST build completes when nothing is cached yet — the
 * right call for the Screener, where an empty universe would look like "no
 * matches", but wrong for Compare: comparing 2-5 named symbols is a
 * lightweight, latency-sensitive request that must not hang for however long
 * a cold ~1000-name universe build takes (observed: 100+s on equity's first
 * build). Benchmarks are supplementary context, so a universe that isn't
 * warm yet is treated exactly like any other unavailable peer group — races
 * the load against a short timeout and omits benchmarks rather than block.
 * The load isn't cancelled on timeout; it keeps warming the cache for the
 * next request.
 */
export async function loadBenchmarkUniverse(
  assetClass: AssetClassId,
  timeoutMs = 1500,
): Promise<BenchmarkUniverseEntry[]> {
  const timeout = new Promise<BenchmarkUniverseEntry[]>((resolve) => {
    setTimeout(() => resolve([]), timeoutMs);
  });
  const load = getUniverseProvider(assetClass)
    .load()
    .then((r) => r.candidates)
    .catch(() => [] as BenchmarkUniverseEntry[]);
  return Promise.race([load, timeout]);
}

/** Benchmark every listed metric key for one symbol in one pass. Keys with no reliable benchmark are simply absent from the result. */
export function computeEntryBenchmarks(
  assetClass: AssetClassId,
  metricKeys: string[],
  subjectSymbol: string,
  subjectMetrics: Record<string, number | null | undefined>,
  peerGroup: string | null,
  universe: BenchmarkUniverseEntry[],
): Record<string, PeerBenchmark> {
  const out: Record<string, PeerBenchmark> = {};
  for (const key of metricKeys) {
    const b = computeMetricBenchmark(assetClass, key, subjectSymbol, subjectMetrics[key], peerGroup, universe);
    if (b) out[key] = b;
  }
  return out;
}
