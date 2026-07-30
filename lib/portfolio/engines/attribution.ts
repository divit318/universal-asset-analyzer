/**
 * Return Attribution — what is actually carrying the portfolio, and what is dragging it.
 *
 * ── The question this exists to answer ────────────────────────────────────────
 *
 * The Portfolio page could state a total return and rank holdings by P&L, and from
 * those two facts an analyst still could not answer the question every portfolio
 * review opens with:
 *
 *     "Where did my return come from, and is that a good thing?"
 *
 * Ranking by P&L does not answer it. A +180% gain on a 0.4% position and a −12%
 * loss on a 30% position look like a triumph and a scratch when sorted by percent,
 * and like nothing much when sorted by dollars against a large book. What matters
 * is each position's CONTRIBUTION to the portfolio's own return — and, more
 * importantly, how CONCENTRATED that contribution is.
 *
 * ── Why contribution, and why it must be additive ─────────────────────────────
 *
 * Contribution here is defined as
 *
 *     contributionPct(i) = unrealizedPL(i) / totalCost
 *
 * against the SAME denominator the portfolio's own total return uses
 * (`(totalValue − totalCost) / totalCost`). That makes the set exactly additive:
 * the contributions sum to the total return, with no residual to explain away.
 *
 * Additivity is not a nicety. A decomposition whose parts do not sum to the whole
 * invites the reader to assume the gap is rounding, when in practice it is a
 * missing position, a different denominator, or a sign error. If the parts sum,
 * the decomposition is checkable — and `attributionResidual` is exported so it can
 * be checked rather than trusted.
 *
 * ── What this deliberately is NOT ─────────────────────────────────────────────
 *
 * This is not Brinson allocation-vs-selection attribution. That decomposition
 * requires benchmark weights and benchmark sector returns over the holding period,
 * which UAA does not have, and inventing them would produce two authoritative-
 * looking numbers ("allocation effect", "selection effect") with no basis. What is
 * computed here is the exact arithmetic of the user's own book. Where a further
 * claim would need data we do not hold, this module says nothing.
 *
 * Pure and deterministic. No I/O.
 */

import { PORTFOLIO_CLASS_LABEL } from "../model/types";
import type { Holding, PortfolioAssetClass } from "../model/types";

export interface Contributor {
  id: string;
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  /** Share of total portfolio value. */
  weight: number;
  /** Unrealized P&L in base currency. */
  pnl: number;
  /** This position's own return on its own cost. */
  ownReturnPct: number | null;
  /**
   * Percentage points of the PORTFOLIO's total return that came from this
   * position. Contributions across all holdings sum to the total return.
   */
  contributionPct: number;
  /** Share of the total absolute movement this position accounts for, 0-100. */
  shareOfMovementPct: number;
}

export interface GroupContribution {
  key: string;
  label: string;
  weight: number;
  pnl: number;
  contributionPct: number;
}

export interface ReturnAttribution {
  /** The portfolio return being decomposed, in percent. */
  totalReturnPct: number;
  totalPnl: number;
  /** Holdings whose cost basis is known, ranked by contribution descending. */
  contributors: Contributor[];
  /** Positive contributors, largest first. */
  carrying: Contributor[];
  /** Negative contributors, most negative first. */
  dragging: Contributor[];
  byAssetClass: GroupContribution[];
  bySector: GroupContribution[];

  /**
   * Share of the total GROSS movement (Σ|pnl|) produced by the three largest
   * absolute movers.
   *
   * This is the number that turns a return into a judgement. A +12% year in which
   * 85% of the movement came from three names is a different portfolio — and a
   * different set of risks going forward — from a +12% year in which no position
   * accounted for more than 8%. Neither total return nor a P&L ranking can express
   * that, and it is the first thing an experienced allocator asks about a good
   * year.
   */
  top3SharePct: number;
  /**
   * Effective number of independent return drivers, 1 / Σ(share²) over gross
   * movement shares — the same Herfindahl inverse used for position concentration,
   * applied to the source of return instead. 1.0 means the entire result came from
   * a single name.
   */
  effectiveDrivers: number;
  /** How many holdings moved up vs down. A breadth check on the result. */
  winners: number;
  losers: number;
  /**
   * Σ|pnl| — the total gross movement being decomposed.
   *
   * Exposed so a caller can tell "nothing has moved" apart from "movement is
   * evenly spread". Both leave `top3SharePct` at 0, and treating the first as the
   * second reported a brand-new portfolio — every position still exactly at cost —
   * as a "Broad result" with "0.0 effective drivers" that was "broadly sourced,
   * so it reflects the portfolio rather than a handful of names". Zero drivers
   * described as broad diversification is self-contradictory on its face, and it
   * is the FIRST thing a new user would have seen.
   */
  grossMovement: number;
  /**
   * Holdings excluded because they have no usable cost basis, so their
   * contribution is unknown rather than zero. Disclosed, never silently dropped.
   */
  excluded: { name: string; weight: number }[];
}

/* -------------------------------------------------------------------------- */

/**
 * A holding contributes to attribution only when BOTH its P&L and the basis it was
 * earned on are known. A position with no recorded cost has an UNKNOWN
 * contribution, and counting it as zero would silently understate every other
 * position's share of the result.
 */
function isAttributable(h: Holding): boolean {
  return h.unrealizedPL != null && Number.isFinite(h.unrealizedPL) && h.costBasisBase > 0;
}

function groupBy(
  holdings: Holding[],
  totalCost: number,
  keyOf: (h: Holding) => string | null,
  labelOf: (key: string) => string,
): GroupContribution[] {
  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    const key = keyOf(h);
    if (key == null || key === "") continue;
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, hs]) => {
      const pnl = hs.reduce((s, h) => s + (h.unrealizedPL ?? 0), 0);
      return {
        key,
        label: labelOf(key),
        weight: hs.reduce((s, h) => s + h.weight, 0),
        pnl,
        contributionPct: totalCost > 0 ? (pnl / totalCost) * 100 : 0,
      };
    })
    .sort((a, b) => b.contributionPct - a.contributionPct);
}

export function computeAttribution(holdings: Holding[]): ReturnAttribution | null {
  const attributable = holdings.filter(isAttributable);
  if (attributable.length === 0) return null;

  // The denominator is the cost of the ATTRIBUTABLE set, so the contributions sum
  // to the return of that same set. Using the whole portfolio's cost while summing
  // only part of its P&L is the classic way a decomposition stops adding up.
  const totalCost = attributable.reduce((s, h) => s + h.costBasisBase, 0);
  const totalPnl = attributable.reduce((s, h) => s + (h.unrealizedPL ?? 0), 0);
  const totalReturnPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // Gross movement, not net: a portfolio that made $100 on one name and lost $100
  // on another has a net return of zero and two very active drivers. Netting them
  // to zero would report "no drivers", which is the opposite of the truth.
  const grossMovement = attributable.reduce((s, h) => s + Math.abs(h.unrealizedPL ?? 0), 0);

  const contributors: Contributor[] = attributable
    .map((h) => {
      const pnl = h.unrealizedPL ?? 0;
      return {
        id: h.id,
        symbol: h.symbol,
        name: h.name,
        assetClass: h.assetClass,
        weight: h.weight,
        pnl,
        ownReturnPct: h.unrealizedPct,
        contributionPct: totalCost > 0 ? (pnl / totalCost) * 100 : 0,
        shareOfMovementPct: grossMovement > 0 ? (Math.abs(pnl) / grossMovement) * 100 : 0,
      };
    })
    .sort((a, b) => b.contributionPct - a.contributionPct);

  const byMovement = [...contributors].sort((a, b) => b.shareOfMovementPct - a.shareOfMovementPct);
  const top3SharePct = byMovement.slice(0, 3).reduce((s, c) => s + c.shareOfMovementPct, 0);

  const sumSqShares = contributors.reduce((s, c) => s + (c.shareOfMovementPct / 100) ** 2, 0);
  const effectiveDrivers = sumSqShares > 0 ? 1 / sumSqShares : 0;

  const excluded = holdings
    .filter((h) => !isAttributable(h))
    .map((h) => ({ name: h.symbol ?? h.name, weight: h.weight }));

  return {
    totalReturnPct,
    totalPnl,
    contributors,
    carrying: contributors.filter((c) => c.pnl > 0),
    dragging: contributors.filter((c) => c.pnl < 0).reverse(),
    byAssetClass: groupBy(
      attributable,
      totalCost,
      (h) => h.assetClass,
      (k) => PORTFOLIO_CLASS_LABEL[k as PortfolioAssetClass] ?? k,
    ),
    bySector: groupBy(attributable, totalCost, (h) => h.attributes.sector ?? null, (k) => k),
    top3SharePct,
    effectiveDrivers,
    winners: contributors.filter((c) => c.pnl > 0).length,
    losers: contributors.filter((c) => c.pnl < 0).length,
    grossMovement,
    excluded,
  };
}

/**
 * The additivity check, exported so it can be asserted rather than assumed:
 * Σ contributionPct − totalReturnPct. Must be ~0.
 */
export function attributionResidual(a: ReturnAttribution): number {
  return a.contributors.reduce((s, c) => s + c.contributionPct, 0) - a.totalReturnPct;
}
