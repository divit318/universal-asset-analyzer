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
import { applyFilters } from "./filter-engine";
import { explain } from "./explain";
import { rankAll, sortCandidates } from "./ranking";
import { getUniverseProvider } from "./universes";
import type { RankedCandidate, ScreenerRequest, ScreenerResponse } from "./types";

export async function runScreen(req: ScreenerRequest): Promise<ScreenerResponse> {
  const provider = getUniverseProvider(req.assetClass);
  const { status, candidates } = await provider.load();

  // 1. Rank the full universe (stable percentiles, independent of the filters).
  const factors = getRanking(req.assetClass, req.templateId);
  const scores = rankAll(candidates, req.assetClass, factors);

  // 2. Filter.
  const matched = applyFilters(candidates, req.assetClass, req.filters);

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

  return {
    assetClass: req.assetClass,
    status,
    total: sorted.length,
    universeReady: candidates.length,
    offset: req.offset,
    rows: sorted.slice(req.offset, req.offset + req.size),
  };
}

/** Force a rebuild of one asset class's universe. */
export function refreshUniverse(req: Pick<ScreenerRequest, "assetClass">) {
  return getUniverseProvider(req.assetClass).refresh();
}
