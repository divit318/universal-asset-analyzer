/**
 * Portfolio trajectory — is this book getting better or worse, and did my last
 * change help?
 *
 * ── The gap this closes ───────────────────────────────────────────────────────
 *
 * Every number on the Portfolio page was a point-in-time snapshot. The page could
 * say "Alignment 75" but not whether that was 68 last week or 82. It could
 * say "Equities 50.7%" but not that the figure had been 39% ten days earlier. An
 * investor cannot tell drift from a stable target, or a deteriorating book from a
 * good one, without the second reading — and drift is how a portfolio ends up
 * somewhere nobody chose.
 *
 * Worse, the page could not answer the one question that makes a recommendation
 * engine accountable: DID THE CHANGES I MADE ACTUALLY HELP? Without that, the
 * Decision Center is a machine that issues advice and never grades itself.
 *
 * ── Where the data comes from ─────────────────────────────────────────────────
 *
 * Nowhere new. `portfolio_snapshot` has been capturing a full
 * `PortfolioSnapshotSummary` (value, cost, score, volatility, top-class
 * weight, allocation) on both sides of every trade execution since the Transaction
 * Engine shipped — purely so that Undo would work. This module reads them.
 *
 * ── The score series is not homogeneous, and says so ──────────────────────────
 *
 * Snapshots written before the alignment engine carry the old universal-weights
 * health score; newer ones carry the policy-relative alignment score. Both are
 * 0-100 and both are contribution-invariant, so the trend is still worth
 * showing — but a step between the two regimes is a definition change, not a
 * portfolio change, which is why `scoreDefinitionChanged` exists and the UI
 * must not grade a cross-regime pair as a regression. Within one regime the
 * comparison is exact.
 *
 * ── The one thing this must NOT do ────────────────────────────────────────────
 *
 * Present the VALUE series as performance. Value rises when you deposit money, and
 * in the real ledger it went from $510k to $9.26M in a single step — a
 * contribution, not a return. A "portfolio value over time" line chart that
 * silently blends deposits with returns is the most common lie in retail portfolio
 * software, and the reason `valueIncludesContributions` is on the returned type and
 * surfaced by the UI. Alignment and concentration ARE contribution-invariant,
 * so those are the trends this module leads with.
 *
 * Server-only: reads lib/db.ts through the transaction engine's re-export.
 */

import { listPortfolioSnapshots, type PortfolioSnapshot } from "./engines/transaction";

export interface TrajectoryPoint {
  at: string;
  label: string;
  /** Alignment score (or the legacy health score on pre-alignment snapshots). */
  score: number;
  /** True when `score` is the legacy universal-weights health figure. */
  legacyScore: boolean;
  totalValue: number;
  volatility: number | null;
  topAssetClassWeight: number;
}

/** A change the user actually made, graded by what it did to the book. */
export interface ChangeOutcome {
  at: string;
  objective: string | null;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  concentrationBefore: number;
  concentrationAfter: number;
  concentrationDelta: number;
  /**
   * True when the change measurably worsened the portfolio on its own headline
   * metric.
   *
   * Surfacing this is the point of the whole module. A recommendation engine that
   * never reports its own misses is not a decision aid, it is a suggestion box.
   * Only graded within one scoring regime — a pre/post pair that straddles the
   * health→alignment definition change is never marked regressed on the step.
   */
  regressed: boolean;
}

export interface PortfolioTrajectory {
  /** Ascending by time. Only snapshots that carry a score appear. */
  points: TrajectoryPoint[];
  /** Change in score over the window, or null if the endpoints span the definition change. */
  scoreDelta: number | null;
  /** Change in the largest asset class's weight — drift, in percentage points. */
  concentrationDelta: number | null;
  /**
   * True when the window mixes legacy health-scored and alignment-scored
   * snapshots — the trend line crosses a definition change and the UI must say so.
   */
  scoreDefinitionChanged: boolean;
  windowDays: number;
  /** Outcomes of executed changes, most recent first. */
  changes: ChangeOutcome[];
  /**
   * Always true for this data source, and stated so the UI can never plot the
   * value series as if it were a return. See the module docblock.
   */
  valueIncludesContributions: true;
}

/** Snapshots taken either side of one execution, in the order they were written. */
const PRE = "pre-execution";
const POST = "post-execution";

/** Score + provenance from a summary that may predate the alignment engine. */
function scoreOf(s: PortfolioSnapshot): { score: number; legacy: boolean } | null {
  const summary = s.summary;
  if (typeof summary.alignment === "number" && Number.isFinite(summary.alignment)) {
    return { score: summary.alignment, legacy: false };
  }
  if (typeof summary.health === "number" && Number.isFinite(summary.health)) {
    return { score: summary.health, legacy: true };
  }
  return null;
}

function toPoint(s: PortfolioSnapshot): TrajectoryPoint | null {
  const scored = scoreOf(s);
  if (!scored) return null;
  return {
    at: s.createdAt,
    label: s.label,
    score: scored.score,
    legacyScore: scored.legacy,
    totalValue: s.summary.totalValue,
    volatility: s.summary.volatility,
    topAssetClassWeight: s.summary.topAssetClassWeight,
  };
}

/**
 * Pair each `pre-execution` snapshot with the `post-execution` one that follows
 * it, and grade the difference.
 *
 * Matching is positional rather than by id because the two rows carry no shared
 * key — the execute routes call `captureSnapshot` twice with different labels. A
 * `pre` with no following `post` (an execution that failed, or a preview that was
 * never executed) is DROPPED rather than paired with an unrelated later snapshot,
 * which would attribute someone else's change to it.
 */
function pairChanges(ascending: PortfolioSnapshot[]): ChangeOutcome[] {
  const out: ChangeOutcome[] = [];

  for (let i = 0; i < ascending.length - 1; i++) {
    const pre = ascending[i];
    const post = ascending[i + 1];
    if (pre.label !== PRE || post.label !== POST) continue;

    const preScore = scoreOf(pre);
    const postScore = scoreOf(post);
    if (!preScore || !postScore) continue;

    const scoreDelta = postScore.score - preScore.score;
    const concentrationDelta = post.summary.topAssetClassWeight - pre.summary.topAssetClassWeight;
    // A pair that straddles the health→alignment definition change measures the
    // scorer, not the trade — never graded as a regression.
    const sameRegime = preScore.legacy === postScore.legacy;

    out.push({
      at: post.createdAt,
      objective: post.objective ?? pre.objective,
      scoreBefore: preScore.score,
      scoreAfter: postScore.score,
      scoreDelta,
      concentrationBefore: pre.summary.topAssetClassWeight,
      concentrationAfter: post.summary.topAssetClassWeight,
      concentrationDelta,
      // A one-point rounding wobble is not a regression; a real move down is.
      regressed: sameRegime && scoreDelta <= -1,
    });
  }

  return out.reverse();
}

/**
 * Read the portfolio's trajectory.
 *
 * `limit` bounds the snapshot read, not the time window — snapshots are written
 * per execution, so their density reflects how actively the book is traded rather
 * than the calendar.
 */
export function getPortfolioTrajectory(limit = 60): PortfolioTrajectory | null {
  const snapshots = listPortfolioSnapshots(limit);
  if (snapshots.length < 2) return null;

  // listPortfolioSnapshots returns newest-first; every consumer here wants the
  // opposite, and reversing once at the boundary keeps the rest of the module from
  // having to remember which way round it is.
  const ascending = [...snapshots].reverse();
  const points = ascending.map(toPoint).filter((p): p is TrajectoryPoint => p != null);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const windowDays = Math.max(
    0,
    Math.round((Date.parse(last.at) - Date.parse(first.at)) / 86_400_000),
  );
  const crossesRegimes = first.legacyScore !== last.legacyScore;

  return {
    points,
    // A delta across the definition change compares two different rulers; null
    // is the honest answer there.
    scoreDelta: crossesRegimes ? null : last.score - first.score,
    concentrationDelta:
      Math.round((last.topAssetClassWeight - first.topAssetClassWeight) * 10) / 10,
    scoreDefinitionChanged: points.some((p) => p.legacyScore) && points.some((p) => !p.legacyScore),
    windowDays,
    changes: pairChanges(ascending),
    valueIncludesContributions: true,
  };
}
