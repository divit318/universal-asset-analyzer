/**
 * The ranking layer. Percentile-based, and deliberately so.
 *
 * The alternative — the lerp-range approach used by lib/scoring.ts and
 * lib/crypto-scoring.ts, where each metric is mapped onto 0-100 between two
 * hand-chosen bounds — needs those bounds calibrated per asset class. That's
 * exactly the tax lib/crypto-scoring.ts pays in its header comment: equity's
 * ±25% three-month band pins a crypto score at 0 or 100 permanently, so crypto
 * needed its own ±40%. Multiply that by seven asset classes and forty-odd
 * metrics and the calibration becomes the product.
 *
 * A percentile needs no calibration. "This fund's expense ratio is in the
 * cheapest 8% of the universe" is meaningful without anyone deciding what
 * counts as cheap, and it means the same thing for a P/E, a bond duration and
 * a token's volume/market-cap ratio.
 *
 * Two properties this buys, both of which the brief asks for:
 *
 *  - **Stability.** Percentiles are computed against the *whole evaluated
 *    universe*, not the filtered subset. Tightening an unrelated filter
 *    therefore does not move anyone's score. Rank position changes; the score
 *    behind it doesn't.
 *
 *  - **Honesty about missing data.** A factor with no value for a candidate
 *    contributes nothing rather than contributing zero — the weight is
 *    redistributed across the factors that *do* have data, and the shortfall
 *    is reported as `confidence`. A name scored on two of five factors reads
 *    as low-confidence instead of silently scoring like a bad one. (This is
 *    the same confidence-weighting the portfolio fit-scorer adopted after
 *    everything-scores-73 turned out to be a missing-data artefact.)
 */

import { getMetric } from "../assets/registry";
import type { AssetClassId, RankFactor } from "../assets/types";
import type { ScreenerCandidate } from "./types";

/**
 * Percentile of every candidate for one metric, 0-100, where 100 is always
 * "best" — the metric's own `better` direction is folded in here, so callers
 * never have to think about whether low or high is good.
 *
 * Ties share the midpoint of the range they span, so a universe where 40% of
 * names have the same value doesn't hand one of them an arbitrary edge.
 * Candidates with no value get no entry (not a zero).
 */
export function percentileRank(
  candidates: ScreenerCandidate[],
  assetClass: AssetClassId,
  metricKey: string,
  direction?: "higher" | "lower",
): Map<string, number> {
  const metric = getMetric(assetClass, metricKey);
  const better = direction ?? metric?.better ?? "higher";

  const withValue = candidates
    .map((c) => ({ symbol: c.symbol, value: c.metrics[metricKey] }))
    .filter((x): x is { symbol: string; value: number } => x.value != null && Number.isFinite(x.value));

  const out = new Map<string, number>();
  const n = withValue.length;
  if (n === 0) return out;
  if (n === 1) {
    out.set(withValue[0].symbol, 50);
    return out;
  }

  const sorted = [...withValue].sort((a, b) => a.value - b.value);

  // Walk runs of equal values so ties get identical percentiles.
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1].value === sorted[i].value) j++;
    // Midpoint of the ranks this run occupies, mapped onto 0-100.
    const midRank = (i + j) / 2;
    const pct = (midRank / (n - 1)) * 100;
    for (let k = i; k <= j; k++) {
      out.set(sorted[k].symbol, better === "lower" ? 100 - pct : pct);
    }
    i = j + 1;
  }

  return out;
}

export interface RankResult {
  rankScore: number;
  confidence: number;
  percentiles: Record<string, number>;
}

/**
 * Score every candidate against the given factors. Percentiles are computed
 * over `universe` (all evaluated candidates) but results are returned for
 * every member of it; the caller filters afterwards.
 */
export function rankAll(
  universe: ScreenerCandidate[],
  assetClass: AssetClassId,
  factors: RankFactor[],
  /**
   * Precomputed class-wide percentiles (lib/screener/universe-stats.ts).
   *
   * When supplied, ranking becomes pure lookups: this function used to sort the
   * entire universe once per factor on *every request* — three to five sorts of
   * up to 1,540 rows, on every keystroke-triggered re-run — and now reuses the
   * sort done once per 12-hour universe build. That is what makes soft
   * preferences free: ten extra ranking factors add ten map lookups per row
   * instead of ten universe sorts per request.
   *
   * A factor with a `direction` override still computes its own table, because
   * the cached percentiles have the metric's default direction folded in and
   * flipping a percentile is not the same as ranking by the opposite key when
   * ties are involved.
   */
  cachedClassPercentiles?: Map<string, Map<string, number>>,
): Map<string, RankResult> {
  const tables = factors.map((f) => {
    const cached = f.direction == null ? cachedClassPercentiles?.get(f.metric) : undefined;
    return {
      factor: f,
      percentiles: cached ?? percentileRank(universe, assetClass, f.metric, f.direction),
    };
  });

  const totalWeight = factors.reduce((s, f) => s + f.weight, 0);
  const out = new Map<string, RankResult>();

  for (const c of universe) {
    let weighted = 0;
    let covered = 0;
    const percentiles: Record<string, number> = {};

    for (const { factor, percentiles: table } of tables) {
      const pct = table.get(c.symbol);
      if (pct == null) continue; // no data — contributes nothing, not zero
      percentiles[factor.metric] = pct;
      weighted += pct * factor.weight;
      covered += factor.weight;
    }

    const confidence = totalWeight > 0 ? covered / totalWeight : 0;
    const raw = covered > 0 ? weighted / covered : 0;

    out.set(c.symbol, {
      // Shrink the score toward neutral (50) in proportion to how much of the
      // ranking weight actually had data behind it.
      //
      // Without this, a candidate scored on one of five factors — and happening
      // to top that one factor — scores 100 and outranks a name that is
      // genuinely strong on all five. Live verification caught exactly that: a
      // bond fund with no yield and no duration data ranked #1 at 20%
      // confidence purely because its lone populated metric led the universe.
      //
      // Shrinkage says: an unmeasured factor is evidence of nothing, so a
      // sparsely-covered candidate should sit near the middle rather than at
      // either extreme. A fully-covered candidate (confidence 1) is unaffected,
      // which is why equity ranking — where coverage is near-total — is
      // unchanged by this.
      rankScore: covered > 0 ? Math.round(50 + (raw - 50) * confidence) : 0,
      confidence: Math.round(confidence * 100),
      percentiles,
    });
  }

  return out;
}

/**
 * Sort by any column: a metric key, or one of the built-ins. Nulls always sink
 * to the bottom regardless of direction — the same rule the original
 * fundamental screener used, and the right one: a missing value is not a small
 * value.
 */
export function sortCandidates<T extends ScreenerCandidate & { rankScore: number }>(
  rows: T[],
  sortKey: string,
  sortDir: "asc" | "desc",
): T[] {
  const dir = sortDir === "asc" ? 1 : -1;

  const valueOf = (row: T): number | string | null => {
    if (sortKey === "rankScore") return row.rankScore;
    if (sortKey === "price") return row.price;
    if (sortKey === "changePercent") return row.changePercent;
    if (sortKey === "symbol") return row.symbol;
    if (sortKey === "name") return row.name;
    if (sortKey in row.metrics) return row.metrics[sortKey];
    if (sortKey in row.attributes) return row.attributes[sortKey];
    return null;
  };

  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return (av - bv) * dir;
  });
}
