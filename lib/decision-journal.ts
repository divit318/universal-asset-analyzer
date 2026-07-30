/**
 * Decision journal & track record — the loop-closer.
 *
 * The platform generates verdicts, conviction, and fit scores constantly but
 * never recorded whether the user (or its own signals) were right. This engine
 * scores logged decisions against what actually happened, and — because each
 * decision captures its conviction and its IOS portfolio-fit at decision time —
 * answers the questions that actually make an investor better:
 *
 *   - Is my hit rate any good?
 *   - Does my "high conviction" actually earn more than my low conviction?
 *     (calibration)
 *   - Do my high-fit decisions outperform my low-fit ones? (does the fit spine
 *     help?)
 *
 * Pure and deterministic — no DB, no network. The route marks open decisions to
 * live prices; closed ones use their recorded close price.
 */

import type { Decision, DecisionAction } from "./types";

/** +1 = the decision expects the price to rise, -1 = to fall, 0 = neutral. */
function direction(action: DecisionAction): -1 | 0 | 1 {
  switch (action) {
    case "buy":
    case "watch":
      return 1;
    case "sell":
    case "avoid":
      return -1;
    case "hold":
      return 0;
  }
}

export interface DecisionOutcome {
  id: number;
  /** Price used: recorded close for closed decisions, else the live mark. */
  markPrice: number | null;
  /** Raw price return since the decision (buy perspective). */
  returnPct: number | null;
  /** Return oriented so positive = the decision was right. */
  directionalReturnPct: number | null;
  /** True when the directional return is positive; null for neutral/no-data. */
  hit: boolean | null;
  /** Whether the price target was reached, when one was set. */
  targetHit: boolean | null;
}

/** Score one decision against a mark price (live or recorded close). */
export function evaluateDecision(d: Decision, livePrice: number | null): DecisionOutcome {
  const markPrice = d.status === "closed" ? d.closePrice : livePrice;
  const dir = direction(d.action);

  if (d.priceAt == null || d.priceAt === 0 || markPrice == null) {
    return { id: d.id, markPrice, returnPct: null, directionalReturnPct: null, hit: null, targetHit: null };
  }

  const returnPct = (markPrice - d.priceAt) / d.priceAt;
  const directionalReturnPct = dir === 0 ? null : returnPct * dir;
  const hit = directionalReturnPct == null ? null : directionalReturnPct >= 0;

  let targetHit: boolean | null = null;
  if (d.targetPrice != null && dir !== 0) {
    targetHit = dir === 1 ? markPrice >= d.targetPrice : markPrice <= d.targetPrice;
  }

  return { id: d.id, markPrice, returnPct, directionalReturnPct, hit, targetHit };
}

export interface GroupStat {
  key: string;
  count: number;
  hitRate: number | null;
  avgReturnPct: number | null;
}

/**
 * Scored decisions required before a track record is shown at all.
 *
 * A hit rate is a claim about a distribution; below a handful of closed calls
 * there is no distribution, only an artifact. With one scored decision the
 * journal displayed "HIT RATE 0%" and named the same position as both BEST CALL
 * and WORST CALL — technically true, and worse than showing nothing, because it
 * reads as a verdict on the user's judgment rather than as an empty sample.
 *
 * Five is not a statistical threshold (nothing is significant at n=5); it is the
 * point at which the numbers stop being self-evidently degenerate.
 */
export const MIN_SCORED_FOR_TRACK_RECORD = 5;

export interface TrackRecord {
  total: number;
  open: number;
  closed: number;
  /** Decisions that produced a directional outcome (excludes holds / no price). */
  scored: number;
  hitRate: number | null;
  avgReturnPct: number | null;
  /** Calibration: hit rate & avg return by conviction (1..5). */
  byConviction: GroupStat[];
  /** Does the fit spine help? Outcomes grouped by fit tier at decision time. */
  byFitTier: GroupStat[];
  byAction: GroupStat[];
  best: { id: number; symbol: string; directionalReturnPct: number } | null;
  worst: { id: number; symbol: string; directionalReturnPct: number } | null;
}

function summarize(returns: number[], hits: boolean[]): { hitRate: number | null; avgReturnPct: number | null } {
  const hitRate = hits.length ? hits.filter(Boolean).length / hits.length : null;
  const avgReturnPct = returns.length ? returns.reduce((s, r) => s + r, 0) / returns.length : null;
  return { hitRate, avgReturnPct };
}

function group(
  rows: { key: string; ret: number | null; hit: boolean | null }[],
): GroupStat[] {
  const map = new Map<string, { rets: number[]; hits: boolean[] }>();
  for (const r of rows) {
    const g = map.get(r.key) ?? { rets: [], hits: [] };
    if (r.ret != null) g.rets.push(r.ret);
    if (r.hit != null) g.hits.push(r.hit);
    map.set(r.key, g);
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, count: Math.max(g.rets.length, g.hits.length), ...summarize(g.rets, g.hits) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Aggregate a set of decisions into a track record. `priceBySymbol` supplies the
 * live mark for open decisions; closed decisions use their recorded close price.
 */
export function computeTrackRecord(
  decisions: Decision[],
  priceBySymbol: Map<string, number>,
): TrackRecord {
  const scoredRows: {
    id: number;
    symbol: string;
    ret: number | null;
    dret: number | null;
    hit: boolean | null;
    conviction: number;
    fitTier: string | null;
    action: string;
  }[] = [];

  let open = 0;
  let closed = 0;
  for (const d of decisions) {
    if (d.status === "closed") closed++;
    else open++;
    const o = evaluateDecision(d, priceBySymbol.get(d.symbol.toUpperCase()) ?? null);
    scoredRows.push({
      id: d.id,
      symbol: d.symbol,
      ret: o.directionalReturnPct,
      dret: o.directionalReturnPct,
      hit: o.hit,
      conviction: d.conviction,
      fitTier: d.fitTier,
      action: d.action,
    });
  }

  const scored = scoredRows.filter((r) => r.dret != null);
  const overall = summarize(
    scored.map((r) => r.dret as number),
    scored.filter((r) => r.hit != null).map((r) => r.hit as boolean),
  );

  const withRet = scored.filter((r) => r.dret != null);
  const best = withRet.length
    ? withRet.reduce((a, b) => ((b.dret as number) > (a.dret as number) ? b : a))
    : null;
  const worst = withRet.length
    ? withRet.reduce((a, b) => ((b.dret as number) < (a.dret as number) ? b : a))
    : null;

  return {
    total: decisions.length,
    open,
    closed,
    scored: scored.length,
    hitRate: overall.hitRate,
    avgReturnPct: overall.avgReturnPct,
    byConviction: group(scoredRows.map((r) => ({ key: String(r.conviction), ret: r.dret, hit: r.hit }))),
    byFitTier: group(scoredRows.filter((r) => r.fitTier).map((r) => ({ key: r.fitTier as string, ret: r.dret, hit: r.hit }))),
    byAction: group(scoredRows.map((r) => ({ key: r.action, ret: r.dret, hit: r.hit }))),
    best: best ? { id: best.id, symbol: best.symbol, directionalReturnPct: best.dret as number } : null,
    worst: worst ? { id: worst.id, symbol: worst.symbol, directionalReturnPct: worst.dret as number } : null,
  };
}
