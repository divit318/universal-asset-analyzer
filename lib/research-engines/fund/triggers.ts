/**
 * "What would change the verdict?" — the conditions that would move this fund
 * across a recommendation band.
 *
 * The point is to turn a static report into something monitorable: a HOLD is
 * only useful if you know what a BUY would take. The obvious way to build this
 * is a hand-written list of plausible-sounding conditions, which is exactly what
 * makes most research feel like filler — the thresholds are invented and bear no
 * relationship to how the score was actually produced.
 *
 * So this module doesn't invent anything. It INVERTS the real scorer: it
 * perturbs one scoring input at a time and re-runs `computeFundScore` — the same
 * pure function that produced the number on screen — bisecting for the value at
 * which the composite crosses the next band edge in lib/recommendation.ts. Every
 * threshold reported here is therefore, by construction, the true one: if that
 * input reached that value and nothing else moved, the call really would change.
 *
 * Factors the provider didn't report are excluded rather than assumed. `mk()`
 * gives a missing input half credit, so "improve the Sharpe ratio to 1.2" for a
 * fund with no reported Sharpe would be a condition on a number that does not
 * exist.
 *
 * Cost: a few hundred evaluations of a pure arithmetic scorer, sub-millisecond
 * in practice. Callers should still memoize on the symbol — it runs in render.
 */

import type { FundProfileData, HistoryPoint, Recommendation } from "../../types";
import { computeFundScore } from "../../fund-scoring";
import { computeMomentum } from "../../scoring";
import { TIER_EDGES, RECOMMENDATION_LABEL, scoreToRecommendation } from "../../recommendation";

export interface VerdictTrigger {
  /** The scoring input this condition is on, in the scorer's own words. */
  lever: string;
  /** Where it stands today, formatted. */
  from: string;
  /** Where it would have to get to, formatted. */
  to: string;
  /** Full sentence for display. */
  detail: string;
}

export interface VerdictTriggers {
  composite: number;
  recommendation: Recommendation;
  /** Composite needed for the next tier up, and what that tier is. */
  upgradeAt: number | null;
  upgradeTo: Recommendation | null;
  /** Composite at or below which the call drops, and to what. */
  downgradeAt: number | null;
  downgradeTo: Recommendation | null;
  upgrades: VerdictTrigger[];
  downgrades: VerdictTrigger[];
  /** True when no single input can move the call on its own — worth saying. */
  noSingleLever: boolean;
}

/* -------------------------------------------------------------------------- */
/* Levers — one per scoring input that is a scalar the user can watch          */
/* -------------------------------------------------------------------------- */

interface Lever {
  label: string;
  /** Current value in the lever's own units. */
  current: number;
  /** Extremes to bisect toward. Beyond these the scorer's lerp saturates. */
  bestBound: number;
  worstBound: number;
  format: (v: number) => string;
  apply: (fund: FundProfileData, v: number) => FundProfileData;
}

const clone = (f: FundProfileData): FundProfileData => ({
  ...f,
  holdings: f.holdings.slice(),
  sectorWeights: f.sectorWeights.map((s) => ({ ...s })),
  assetAllocation: { ...f.assetAllocation },
  trailingReturns: { ...f.trailingReturns },
  categoryRelativeReturns: { ...f.categoryRelativeReturns },
  risk: f.risk ? { ...f.risk } : null,
});

const pp = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}pp`;
const pctPoints = (v: number) => `${v.toFixed(0)}%`;

function buildLevers(fund: FundProfileData): Lever[] {
  const levers: Lever[] = [];

  if (fund.expenseRatio != null) {
    levers.push({
      label: "Expense ratio",
      current: fund.expenseRatio * 100,
      bestBound: 0.03,
      worstBound: 1.5,
      format: (v) => `${v.toFixed(2)}%`,
      apply: (f, v) => ({ ...clone(f), expenseRatio: v / 100 }),
    });
  }

  if (fund.turnoverPercent != null) {
    levers.push({
      label: "Portfolio turnover",
      current: fund.turnoverPercent * 100,
      bestBound: 5,
      worstBound: 150,
      format: pctPoints,
      apply: (f, v) => ({ ...clone(f), turnoverPercent: v / 100 }),
    });
  }

  // Concentration: the scorer reads only the summed top-10 weight, so the
  // perturbation rescales those ten proportionally. Preserving their relative
  // shape keeps the largest position the largest, which is what makes the
  // resulting threshold readable as "top 10 falls to X%".
  const sorted = fund.holdings.slice().sort((a, b) => b.weightPercent - a.weightPercent);
  if (sorted.length >= 10) {
    const top10 = sorted.slice(0, 10).reduce((s, h) => s + h.weightPercent, 0);
    if (top10 > 0) {
      levers.push({
        label: "Top-10 concentration",
        current: top10,
        bestBound: 15,
        worstBound: 100,
        format: pctPoints,
        apply: (f, v) => {
          const k = v / top10;
          const scaled = sorted.map((h, i) => (i < 10 ? { ...h, weightPercent: h.weightPercent * k } : h));
          return { ...clone(f), holdings: scaled };
        },
      });
    }
  }

  if (fund.sectorWeights.length > 0) {
    const top = fund.sectorWeights.slice().sort((a, b) => b.weightPercent - a.weightPercent)[0];
    levers.push({
      label: `${top.sector} weight`,
      current: top.weightPercent,
      bestBound: 15,
      worstBound: 100,
      format: pctPoints,
      apply: (f, v) => {
        const weights = f.sectorWeights.map((s) => (s.sector === top.sector ? { ...s, weightPercent: v } : { ...s }));
        return { ...clone(f), sectorWeights: weights.sort((a, b) => b.weightPercent - a.weightPercent) };
      },
    });
  }

  if (fund.categoryRelativeReturns.oneYear != null) {
    levers.push({
      label: "1-year return vs category",
      current: fund.categoryRelativeReturns.oneYear,
      bestBound: 8,
      worstBound: -8,
      format: pp,
      apply: (f, v) => {
        const c = clone(f);
        c.categoryRelativeReturns = { ...c.categoryRelativeReturns, oneYear: v };
        return c;
      },
    });
  }

  if (fund.categoryRelativeReturns.threeYear != null) {
    levers.push({
      label: "3-year return vs category",
      current: fund.categoryRelativeReturns.threeYear,
      bestBound: 6,
      worstBound: -6,
      format: pp,
      apply: (f, v) => {
        const c = clone(f);
        c.categoryRelativeReturns = { ...c.categoryRelativeReturns, threeYear: v };
        return c;
      },
    });
  }

  if (fund.risk?.sharpeRatio != null) {
    levers.push({
      label: "Sharpe ratio",
      current: fund.risk.sharpeRatio,
      bestBound: 2,
      worstBound: -0.5,
      format: (v) => v.toFixed(2),
      apply: (f, v) => {
        const c = clone(f);
        c.risk = { ...(c.risk ?? { beta: null, alpha: null, stdDev: null, sharpeRatio: null }), sharpeRatio: v };
        return c;
      },
    });
  }

  if (fund.risk?.alpha != null) {
    levers.push({
      label: "Alpha vs category",
      current: fund.risk.alpha,
      bestBound: 5,
      worstBound: -5,
      format: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`,
      apply: (f, v) => {
        const c = clone(f);
        c.risk = { ...(c.risk ?? { beta: null, alpha: null, stdDev: null, sharpeRatio: null }), alpha: v };
        return c;
      },
    });
  }

  return levers;
}

/* -------------------------------------------------------------------------- */
/* Bisection                                                                   */
/* -------------------------------------------------------------------------- */

const BISECTION_STEPS = 22;

/**
 * The value nearest `current`, on the way to `bound`, at which `crosses` first
 * holds. The composite is monotone in each lever along that path (every factor
 * is a clamped linear map), which is what makes bisection valid here.
 * Returns null when even the bound doesn't cross — an honest "this factor can't
 * do it alone".
 */
function solve(
  fund: FundProfileData,
  history: HistoryPoint[],
  momentum: number | null,
  lever: Lever,
  bound: number,
  crosses: (composite: number) => boolean,
): number | null {
  const at = (v: number) => computeFundScore(lever.apply(fund, v), history, momentum).composite;
  if (!crosses(at(bound))) return null;

  let lo = lever.current; // known not to cross
  let hi = bound;         // known to cross
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (crosses(at(mid))) hi = mid;
    else lo = mid;
  }
  return hi;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

/** Band edge immediately above `composite`, or null at the top tier. */
function nextEdgeUp(composite: number): number | null {
  return TIER_EDGES.find((e) => e > composite) ?? null;
}
/** Band edge the score currently sits on top of — dropping below it downgrades. */
function edgeBelow(composite: number): number | null {
  return [...TIER_EDGES].reverse().find((e) => e <= composite) ?? null;
}

export function deriveVerdictTriggers(
  fund: FundProfileData,
  history: HistoryPoint[],
  score: { composite: number; recommendation: Recommendation },
): VerdictTriggers {
  const { composite, recommendation } = score;
  const upgradeAt = nextEdgeUp(composite);
  const downgradeEdge = edgeBelow(composite);
  // Composites are integers, so "below the edge" is at most edge - 1.
  const downgradeAt = downgradeEdge != null ? downgradeEdge - 1 : null;

  const levers = buildLevers(fund);
  const upgrades: VerdictTrigger[] = [];
  const downgrades: VerdictTrigger[] = [];

  // Momentum is a function of `history` alone and every perturbation below
  // leaves it untouched — so it is computed once for the entire solve rather
  // than re-walking five years of closes inside each of a few hundred
  // evaluations.
  const momentum = computeMomentum(history)?.score ?? null;

  for (const lever of levers) {
    if (upgradeAt != null) {
      const v = solve(fund, history, momentum, lever, lever.bestBound, (c) => c >= upgradeAt);
      if (v != null) {
        upgrades.push({
          lever: lever.label,
          from: lever.format(lever.current),
          to: lever.format(v),
          detail: `${lever.label} reaches ${lever.format(v)} (now ${lever.format(lever.current)})`,
        });
      }
    }
    if (downgradeAt != null) {
      const v = solve(fund, history, momentum, lever, lever.worstBound, (c) => c <= downgradeAt);
      if (v != null) {
        downgrades.push({
          lever: lever.label,
          from: lever.format(lever.current),
          to: lever.format(v),
          detail: `${lever.label} slips to ${lever.format(v)} (now ${lever.format(lever.current)})`,
        });
      }
    }
  }

  // Nearest-first: the condition requiring the smallest move is the one worth
  // watching, so rank by how far each lever has to travel as a share of its own
  // scoring range rather than by raw units (a 0.3 move in Sharpe and a 3pp move
  // in relative return are not comparable numbers).
  const travel = (t: VerdictTrigger, list: Lever[]) => {
    const l = list.find((x) => x.label === t.lever)!;
    const span = Math.abs(l.bestBound - l.worstBound) || 1;
    const target = Number.parseFloat(t.to.replace(/[^0-9.+-]/g, ""));
    return Math.abs(target - l.current) / span;
  };
  upgrades.sort((a, b) => travel(a, levers) - travel(b, levers));
  downgrades.sort((a, b) => travel(a, levers) - travel(b, levers));

  return {
    composite,
    recommendation,
    upgradeAt,
    upgradeTo: upgradeAt != null ? scoreToRecommendation(upgradeAt) : null,
    downgradeAt,
    downgradeTo: downgradeAt != null ? scoreToRecommendation(downgradeAt) : null,
    upgrades: upgrades.slice(0, 4),
    downgrades: downgrades.slice(0, 4),
    noSingleLever: upgrades.length === 0 && downgrades.length === 0 && levers.length > 0,
  };
}

/** Tier label, re-exported so the UI doesn't reach past this module for it. */
export const tierLabel = (r: Recommendation) => RECOMMENDATION_LABEL[r];
