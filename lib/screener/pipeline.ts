/**
 * The common evaluation pipeline. Every asset class runs through exactly this
 * path, and no step in it knows which class it's looking at:
 *
 *   asset universe
 *     → asset-class filters   (filter-engine, driven by the registry)
 *     → template filters      (merged into the same filter set)
 *     → ranking logic         (ranking, percentile-based)
 *     → result normalization  (already normalized — that's ScreenerCandidate)
 *     → explanation           (explain, deterministic)
 *     → UI rendering          (registry-driven columns)
 *
 * Note the ordering: ranking happens over the *whole universe*, before
 * filtering, so percentiles describe a candidate's standing among all its
 * peers rather than among the handful that survived the user's filters. That's
 * what makes a score mean the same thing from one screen to the next.
 */

import { getRanking } from "../assets/registry";
import { applyFilters, bindingConstraint, diagnose } from "./filter-engine";
import { explain } from "./explain";
import { rankAll, sortCandidates } from "./ranking";
import { getUniverseProvider } from "./universes";
import { getUniverseStats } from "./universe-stats";
import type { RankFactor } from "../assets/types";
import type { RankedCandidate, ScreenerRequest, ScreenerResponse } from "./types";

/**
 * Soft preferences become extra ranking factors for this run only.
 *
 * Deliberately additive rather than replacing the class's own ranking: a
 * preference expresses "and I also care about this", not "forget everything you
 * know about ranking ETFs". A preference on a metric the class already ranks
 * simply deepens that tilt, which is the intuitive reading.
 */
function withPreferences(factors: RankFactor[], preferences: Record<string, number>): RankFactor[] {
  const extra = Object.entries(preferences).map(([metric, weight]) => ({ metric, weight }));
  return extra.length === 0 ? factors : [...factors, ...extra];
}

export async function runScreen(req: ScreenerRequest): Promise<ScreenerResponse> {
  const provider = getUniverseProvider(req.assetClass);
  const { status, candidates } = await provider.load();

  // 0. Distribution statistics. Computed once per universe build and cached, so
  //    this is a map lookup on every request but the first after a rebuild.
  //    Everything below reads from it instead of re-deriving the universe's shape.
  const stats = getUniverseStats(req.assetClass, candidates, status.builtAt);

  // 1. Rank the full universe (stable percentiles, independent of the filters),
  //    including any soft preferences the caller expressed.
  const factors = withPreferences(getRanking(req.assetClass, req.templateId), req.preferences ?? {});
  const scores = rankAll(candidates, req.assetClass, factors, stats.classPercentiles);

  // 2. Filter.
  const matched = applyFilters(candidates, req.assetClass, req.filters, stats);

  // 3. Attach scores + explanations.
  const ranked: RankedCandidate[] = matched.map((c) => {
    const score = scores.get(c.symbol) ?? { rankScore: 0, confidence: 0, percentiles: {} };
    return {
      ...c,
      rank: 0, // assigned after the sort
      rankScore: score.rankScore,
      confidence: score.confidence,
      percentiles: score.percentiles,
      match: explain(c, req.assetClass, req.filters, score.percentiles),
    };
  });

  // 4. Sort, then number. Rank is a property of the sorted view, so it's
  //    assigned here rather than carried through from the scoring step.
  const sorted = sortCandidates(ranked, req.sortKey, req.sortDir);
  sorted.forEach((row, i) => {
    row.rank = i + 1;
  });

  // 5. The page, and only the page, gets per-row diagnostics: how close it came
  //    to failing. Deliberately not computed for the other 1,490 rows nobody is
  //    looking at.
  const page = sorted.slice(req.offset, req.offset + req.size).map((row) => ({
    ...row,
    binding: bindingConstraint(row, req.assetClass, req.filters, stats) ?? undefined,
  }));

  return {
    assetClass: req.assetClass,
    status,
    total: sorted.length,
    universeReady: candidates.length,
    offset: req.offset,
    rows: page,
    // 6. An empty screen is the one case worth spending CPU to explain, because
    //    the user is stuck and the answer is almost always a single threshold.
    //    Nothing here runs when the screen matched anything at all.
    diagnostics: sorted.length === 0 ? diagnose(candidates, req.assetClass, req.filters, stats) : undefined,
  };
}

/** Force a rebuild of one asset class's universe. */
export function refreshUniverse(req: Pick<ScreenerRequest, "assetClass">) {
  return getUniverseProvider(req.assetClass).refresh();
}
