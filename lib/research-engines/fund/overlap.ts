/**
 * Portfolio overlap & impact — "what does buying THIS fund do to what I already
 * own?".
 *
 * A fund's whole risk is that it looks like diversification while being a
 * second helping of what you hold already. UAA is one of the few tools that can
 * answer that, because the user's book is right there: the Research Hub hands
 * this module the positions the IOS profile already loaded, so the entire
 * analysis is arithmetic in render — no fetch, no AI, no server round-trip.
 *
 * ── The honesty constraints this module is built around ────────────────────
 *
 * The provider discloses roughly a fund's ten largest positions, not all of
 * them. So the true overlap between a fund and a portfolio is NOT knowable from
 * this data, and any single "% overlap" figure would be a guess. What IS exactly
 * knowable is a *floor*: the summed weight of disclosed holdings the user
 * already has exposure to. `overlapWeightPct` is that floor, `disclosedWeightPct`
 * is the share of the fund it was measured over, and the UI must present the
 * pair — "at least X% of the fund, measured across the Y% it discloses".
 *
 * Position projections assume the purchase is funded with NEW money, which is
 * what "add a position" means everywhere else in the app (lib/ios/fit-scorer.ts
 * sizes against total value the same way). Existing weights are therefore
 * diluted by the new capital, and that dilution is applied — not ignored, which
 * would overstate every projected increase.
 */

import type { FundHolding, FundSectorWeight } from "../../types";

/* -------------------------------------------------------------------------- */
/* Inputs — deliberately narrow                                                */
/* -------------------------------------------------------------------------- */

/**
 * A portfolio line item, reduced to the four fields this analysis needs. Kept
 * structural rather than importing lib/portfolio/model/types' `Holding` so this
 * module stays pure and client-safe, and so a caller can feed it a watchlist,
 * a simulated book, or a fixture without constructing a full Holding.
 */
export interface OverlapPosition {
  symbol: string | null;
  name: string;
  /** % of the user's current total portfolio value. */
  weightPct: number;
  sector: string | null;
  /** True for positions that are themselves funds — candidates for look-through. */
  isFund: boolean;
}

export interface OverlapInput {
  fundHoldings: FundHolding[];
  fundSectorWeights: FundSectorWeight[];
  positions: OverlapPosition[];
  /**
   * The size of the prospective purchase, as % of the POST-trade portfolio.
   * Callers pass the IOS's own `suggestedAllocationPct` so the projection
   * describes the trade the rest of the page is actually recommending.
   */
  addAllocationPct: number;
  /**
   * Holdings of funds the user already owns, keyed by their symbol — lets the
   * analysis see a name the user holds *inside* another ETF rather than
   * directly. Absent entries are reported in `unlookedFunds` instead of being
   * silently treated as non-overlapping.
   */
  lookThrough?: Record<string, FundHolding[]>;
}

/* -------------------------------------------------------------------------- */
/* Output                                                                      */
/* -------------------------------------------------------------------------- */

export interface OverlapMatch {
  symbol: string;
  name: string;
  /** Weight of this name inside the researched fund. */
  fundWeightPct: number;
  /** Weight held directly in the portfolio today. */
  directWeightPct: number;
  /** Weight held indirectly, through funds the user owns (look-through). */
  indirectWeightPct: number;
  /** directWeightPct + indirectWeightPct. */
  currentWeightPct: number;
  /** Effective weight after the purchase, including dilution of existing lines. */
  projectedWeightPct: number;
  /** projected − current, in percentage points of the portfolio. */
  deltaPct: number;
  /** Which held funds contribute the indirect exposure. */
  viaFunds: string[];
}

export interface SectorShift {
  sector: string;
  currentPct: number;
  projectedPct: number;
  deltaPct: number;
}

/**
 * `unknown` is not a degenerate case of `diversifies` — it is the honest answer
 * when the fund itemises no holdings at all (bond funds routinely don't).
 * Zero matches out of zero disclosed positions is not evidence of new exposure;
 * it is an absence of evidence, and reporting it as "largely new exposure"
 * would be the page's most confident lie.
 */
export type OverlapVerdict = "reinforces" | "partial" | "diversifies" | "unknown";

export interface OverlapResult {
  /**
   * Summed weight, inside the researched fund, of names the user already has
   * exposure to. A FLOOR on true overlap — see the module header.
   */
  overlapWeightPct: number;
  /** Share of the researched fund the disclosure covers — the denominator. */
  disclosedWeightPct: number;
  /** overlapWeightPct as a share of what was actually measurable. */
  overlapOfDisclosedPct: number;
  /**
   * Percentage points of the portfolio that the purchase routes straight back
   * into names already held: `addAllocationPct × overlapWeightPct / 100`.
   *
   * This exists because the per-name projections can be counter-intuitive on
   * their own. Funding an 8% position with new money dilutes a 15% holding to
   * 14.4% even when the fund is stuffed with that very name — so a book that is
   * plainly doubling down shows falling weights everywhere, and the table looks
   * like it contradicts the verdict. This is the figure that reconciles them:
   * how much of the new capital never actually left the exposures you had.
   */
  recycledCapitalPct: number;
  matches: OverlapMatch[];
  sectorShifts: SectorShift[];
  /** False when the fund itemises no holdings — name-level overlap is unmeasurable. */
  holdingsDisclosed: boolean;
  verdict: OverlapVerdict;
  headline: string;
  /** True when at least one held fund's holdings were folded in. */
  lookThroughApplied: boolean;
  /** Held funds whose holdings weren't available — the stated blind spot. */
  unlookedFunds: string[];
  /** Echoed back so the UI can label the projection with the trade it assumes. */
  addAllocationPct: number;
}

/* -------------------------------------------------------------------------- */
/* Verdict bands                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Bands on `overlapOfDisclosedPct` — the share of the *measurable* part of the
 * fund the user already owns. Stated as constants rather than buried in an
 * if-chain because the UI quotes them: a threshold the reader can't see is a
 * threshold they can't disagree with.
 */
export const OVERLAP_BANDS = {
  /** At or above this, the fund is mostly a second helping of the book. */
  reinforces: 50,
  /** At or above this, it is a meaningful but partial duplicate. */
  partial: 20,
} as const;

/* -------------------------------------------------------------------------- */
/* Matching                                                                    */
/* -------------------------------------------------------------------------- */

const normSymbol = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
/** Names are matched only as a fallback for holdings with no ticker, so the
 *  normalization just has to defeat punctuation and suffix noise. */
const normName = (s: string | null | undefined) =>
  (s ?? "").trim().toUpperCase().replace(/[.,]/g, "").replace(/\b(INC|CORP|CORPORATION|CO|LTD|PLC|NV|SA|AG|CLASS [A-Z])\b/g, "").replace(/\s+/g, " ").trim();

/** Key a holding/position for cross-matching: ticker when there is one, else name. */
function matchKey(symbol: string | null | undefined, name: string | null | undefined): string | null {
  const sym = normSymbol(symbol);
  if (sym) return `S:${sym}`;
  const nm = normName(name);
  return nm ? `N:${nm}` : null;
}

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

export function analyzeOverlap(input: OverlapInput): OverlapResult {
  const { fundHoldings, fundSectorWeights, positions, addAllocationPct, lookThrough } = input;

  // Dilution factor: adding A% of the post-trade portfolio in new money leaves
  // every existing line at (1 - A/100) of its former weight.
  const alloc = Math.max(0, Math.min(100, addAllocationPct));
  const dilution = 1 - alloc / 100;

  /* ── Current effective exposure, by name ─────────────────────────────────
     Direct positions first, then anything visible inside funds the user owns.
     A name held both ways accumulates — that is the whole point. */
  interface Exposure { name: string; symbol: string; direct: number; indirect: number; viaFunds: string[] }
  const current = new Map<string, Exposure>();

  const touch = (key: string, symbol: string, name: string): Exposure => {
    let e = current.get(key);
    if (!e) {
      e = { name, symbol, direct: 0, indirect: 0, viaFunds: [] };
      current.set(key, e);
    }
    return e;
  };

  for (const p of positions) {
    const key = matchKey(p.symbol, p.name);
    if (!key) continue;
    const e = touch(key, normSymbol(p.symbol), p.name);
    e.direct += p.weightPct;
  }

  const unlookedFunds: string[] = [];
  let lookThroughApplied = false;
  for (const p of positions) {
    if (!p.isFund) continue;
    const sym = normSymbol(p.symbol);
    const inner = sym ? lookThrough?.[sym] : undefined;
    if (!inner || inner.length === 0) {
      if (sym) unlookedFunds.push(sym);
      continue;
    }
    lookThroughApplied = true;
    for (const h of inner) {
      const key = matchKey(h.symbol, h.name);
      if (!key) continue;
      const e = touch(key, normSymbol(h.symbol), h.name);
      // The held fund is p.weightPct of the book; h is h.weightPercent of it.
      e.indirect += (p.weightPct * h.weightPercent) / 100;
      if (sym && !e.viaFunds.includes(sym)) e.viaFunds.push(sym);
    }
  }

  /* ── Match the researched fund's disclosed holdings against that ────────── */
  const disclosedWeightPct = fundHoldings.reduce((s, h) => s + h.weightPercent, 0);
  const matches: OverlapMatch[] = [];
  let overlapWeightPct = 0;

  for (const h of fundHoldings) {
    const key = matchKey(h.symbol, h.name);
    if (!key) continue;
    const e = current.get(key);
    // The researched fund itself can appear in the user's book; that is a
    // top-up, not an overlap, and the position card upstream already says so.
    const currentWeight = e ? e.direct + e.indirect : 0;
    if (currentWeight <= 0) continue;

    overlapWeightPct += h.weightPercent;
    const projected = currentWeight * dilution + (alloc * h.weightPercent) / 100;
    matches.push({
      symbol: normSymbol(h.symbol) || h.name,
      name: h.name,
      fundWeightPct: h.weightPercent,
      directWeightPct: e!.direct,
      indirectWeightPct: e!.indirect,
      currentWeightPct: currentWeight,
      projectedWeightPct: projected,
      deltaPct: projected - currentWeight,
      viaFunds: e!.viaFunds,
    });
  }

  matches.sort((a, b) => b.fundWeightPct - a.fundWeightPct);

  const overlapOfDisclosedPct = disclosedWeightPct > 0 ? (overlapWeightPct / disclosedWeightPct) * 100 : 0;

  /* ── Sector shift ────────────────────────────────────────────────────────
     Complete on both sides (sector weights sum to 100 within the classified
     part of each), so this is the one figure here that is not a floor. Only
     sectors the fund or the portfolio actually carries appear. */
  const portfolioSectors = new Map<string, number>();
  for (const p of positions) {
    if (!p.sector) continue;
    portfolioSectors.set(p.sector, (portfolioSectors.get(p.sector) ?? 0) + p.weightPct);
  }
  const fundSectors = new Map(fundSectorWeights.map((s) => [s.sector, s.weightPercent]));

  const sectorShifts: SectorShift[] = [];
  for (const sector of new Set([...portfolioSectors.keys(), ...fundSectors.keys()])) {
    const currentPct = portfolioSectors.get(sector) ?? 0;
    const projectedPct = currentPct * dilution + (alloc * (fundSectors.get(sector) ?? 0)) / 100;
    sectorShifts.push({ sector, currentPct, projectedPct, deltaPct: projectedPct - currentPct });
  }
  sectorShifts.sort((a, b) => b.deltaPct - a.deltaPct);

  /* ── Verdict + headline ──────────────────────────────────────────────────── */
  const holdingsDisclosed = fundHoldings.length > 0;
  const verdict: OverlapVerdict =
    !holdingsDisclosed ? "unknown"
    : overlapOfDisclosedPct >= OVERLAP_BANDS.reinforces ? "reinforces"
    : overlapOfDisclosedPct >= OVERLAP_BANDS.partial ? "partial"
    : "diversifies";

  const topNames = matches.slice(0, 3).map((m) => m.symbol);
  const biggestShift = sectorShifts[0];

  let headline: string;
  if (!holdingsDisclosed) {
    headline =
      "Our data source doesn't itemise this fund's holdings, so overlap with your positions can't be measured name by name.";
  } else if (matches.length === 0) {
    headline = positions.length === 0
      ? "No positions to compare against yet."
      : "None of this fund's disclosed holdings appear in your portfolio — on the visible part of the fund, this is genuinely new exposure.";
  } else if (verdict === "reinforces") {
    headline = `This mostly doubles down on what you already own — ${topNames.join(", ")} and ${matches.length > 3 ? `${matches.length - 3} other disclosed ${matches.length - 3 === 1 ? "holding" : "holdings"}` : "the rest of the overlap"} are already in your book.`;
  } else if (verdict === "partial") {
    headline = `Part duplicate, part new: ${topNames.join(", ")} ${topNames.length === 1 ? "is" : "are"} exposure you already have, but most of the fund's disclosed weight sits in names you don't hold.`;
  } else {
    headline = `Largely new exposure — only ${matches.length} of the fund's disclosed holdings (${topNames.join(", ")}) overlap with what you own.`;
  }
  if (biggestShift && biggestShift.deltaPct >= 1) {
    headline += ` It would move your ${biggestShift.sector.toLowerCase()} weight from ${biggestShift.currentPct.toFixed(1)}% to ${biggestShift.projectedPct.toFixed(1)}%.`;
  }

  return {
    overlapWeightPct,
    disclosedWeightPct,
    overlapOfDisclosedPct,
    recycledCapitalPct: (alloc * overlapWeightPct) / 100,
    matches,
    sectorShifts,
    holdingsDisclosed,
    verdict,
    headline,
    lookThroughApplied,
    unlookedFunds,
    addAllocationPct: alloc,
  };
}
