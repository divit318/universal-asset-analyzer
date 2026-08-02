/**
 * Look-through overlap engine.
 *
 * "Show me the exposure I own twice without realizing it." Funds are opaque
 * in a position list: you can hold NVDA directly, again through VOO, and a
 * third time through VGT, and no page in the app would say so. This module
 * looks through every fund position to its disclosed holdings and computes,
 * per underlying security:
 *
 *   effectiveWeight = directWeight + sum(fundBookWeight x weightInsideFund)
 *
 * Honesty constraints:
 * - Yahoo discloses only a fund's TOP holdings (usually 10). The residual is
 *   NOT attributed and every consumer must say so: this is a floor on
 *   look-through exposure, never an estimate of it. `basis` carries that
 *   caveat and the UI renders it.
 * - No correlation, no factor math, no guessing: only disclosed holding
 *   weights multiplied by measured book weights.
 *
 * The computation core is pure (fund holdings in, exposures out) and unit
 * tested; only fetchFundHoldings does I/O (platform-cached quoteSummary).
 */

import { getQuoteSummary } from "../yahoo";
import type { LookThroughExposure, FundOverlapPair, LookThroughResult } from "./types";

/** One disclosed holding inside a fund. */
export interface FundHolding {
  /** Ticker when Yahoo discloses one; null for unlisted/aggregated lines. */
  symbol: string | null;
  name: string;
  /** Share of the fund, 0-1. */
  weight: number;
}

export const LOOK_THROUGH_BASIS =
  "Computed from each fund's top disclosed holdings (Yahoo, usually 10). Undisclosed remainder is not attributed, so these are floors, not totals.";

/**
 * Cross-listing identity: international funds disclose local listings
 * ("2330.TW") while US books hold the ADR ("TSM"). Same issuer, same
 * economic exposure; without this map the engine would miss exactly the
 * overlap it exists to find. Deliberately a short, curated list of
 * unambiguous mega-cap pairs (the names that actually appear in fund top-10
 * disclosures), not a fuzzy matcher: an unmapped local listing simply does
 * not match, which errs on the side of under-reporting (consistent with the
 * floors-not-totals basis above).
 */
export const LISTING_IDENTITY: Record<string, string> = {
  "2330.TW": "TSM", // Taiwan Semiconductor (ADR)
  "7203.T": "TM", // Toyota (ADR)
  "ASML.AS": "ASML",
  "0700.HK": "TCEHY", // Tencent (OTC ADR)
  "HSBA.L": "HSBC",
  "NOVN.SW": "NVS", // Novartis (ADR)
  "ROG.SW": "RHHBY", // Roche (OTC ADR)
  "AZN.L": "AZN",
  "SHEL.L": "SHEL",
  "SAP.DE": "SAP",
  "NESN.SW": "NSRGY", // Nestle (OTC ADR)
  "MC.PA": "LVMUY", // LVMH (OTC ADR)
  "BHP.AX": "BHP",
  "RIO.L": "RIO",
  "005930.KS": "SSNLF", // Samsung Electronics (OTC, thinly traded)
  "000660.KS": "HXSCL", // SK hynix (OTC ADR)
};

/** Canonicalize a disclosed holding symbol to its US listing when the identity is known. */
export function canonicalizeListing(symbol: string): string {
  const sym = symbol.toUpperCase();
  return LISTING_IDENTITY[sym] ?? sym;
}

interface PositionInput {
  symbol: string;
  name: string;
  /** Book weight, 0-1. */
  weight: number;
  isFund: boolean;
}

/**
 * Pure core: fold direct positions and fund holdings into per-security
 * effective exposures plus fund/fund overlap pairs.
 */
export function computeLookThrough(
  positions: PositionInput[],
  holdingsByFund: Map<string, FundHolding[]>,
): LookThroughResult {
  const bySymbol = new Map<string, LookThroughExposure>();

  const ensure = (symbol: string, name: string): LookThroughExposure => {
    const sym = symbol.toUpperCase();
    const existing = bySymbol.get(sym);
    if (existing) return existing;
    const created: LookThroughExposure = {
      symbol: sym,
      name,
      directWeight: 0,
      routes: [],
      effectiveWeight: 0,
      routeCount: 0,
    };
    bySymbol.set(sym, created);
    return created;
  };

  for (const pos of positions) {
    if (pos.isFund) continue;
    const entry = ensure(pos.symbol, pos.name);
    entry.directWeight += pos.weight;
  }

  for (const pos of positions) {
    if (!pos.isFund) continue;
    for (const holding of holdingsByFund.get(pos.symbol.toUpperCase()) ?? []) {
      if (!holding.symbol || holding.weight <= 0) continue;
      const entry = ensure(holding.symbol, holding.name);
      entry.routes.push({
        via: pos.symbol.toUpperCase(),
        fundWeight: pos.weight,
        holdingWeight: holding.weight,
        contribution: pos.weight * holding.weight,
      });
    }
  }

  const exposures = [...bySymbol.values()]
    .map((e) => ({
      ...e,
      routes: e.routes.sort((a, b) => b.contribution - a.contribution),
      effectiveWeight: e.directWeight + e.routes.reduce((s, r) => s + r.contribution, 0),
      routeCount: e.routes.length + (e.directWeight > 0 ? 1 : 0),
    }))
    // Only multi-route exposure is a finding; a fund holding something once
    // is just what a fund is.
    .filter((e) => e.routeCount >= 2)
    .sort((a, b) => b.effectiveWeight - a.effectiveWeight);

  const funds = positions.filter((p) => p.isFund && (holdingsByFund.get(p.symbol.toUpperCase())?.length ?? 0) > 0);
  const fundOverlaps: FundOverlapPair[] = [];
  for (let i = 0; i < funds.length; i++) {
    for (let j = i + 1; j < funds.length; j++) {
      const a = funds[i].symbol.toUpperCase();
      const b = funds[j].symbol.toUpperCase();
      const holdingsA = new Map(
        (holdingsByFund.get(a) ?? []).filter((h) => h.symbol).map((h) => [h.symbol!.toUpperCase(), h.weight]),
      );
      const shared: string[] = [];
      let weightA = 0;
      let weightB = 0;
      for (const h of holdingsByFund.get(b) ?? []) {
        const sym = h.symbol?.toUpperCase();
        if (sym && holdingsA.has(sym)) {
          shared.push(sym);
          weightA += holdingsA.get(sym)!;
          weightB += h.weight;
        }
      }
      if (shared.length >= 2) {
        fundOverlaps.push({
          fundA: a,
          fundB: b,
          sharedSymbols: shared,
          sharedWeight: Math.round(((weightA + weightB) / 2) * 1000) / 1000,
        });
      }
    }
  }
  fundOverlaps.sort((a, b) => b.sharedWeight - a.sharedWeight);

  return { exposures, fundOverlaps, basis: LOOK_THROUGH_BASIS };
}

/* -------------------------------------------------------------------------- */
/* Yahoo fetch                                                                */
/* -------------------------------------------------------------------------- */

interface RawHolding {
  symbol?: string;
  holdingName?: string;
  holdingPercent?: number | { raw?: number };
}

interface RawTopHoldings {
  topHoldings?: { holdings?: RawHolding[] };
}

/** A fund's disclosed top holdings. Best-effort: [] when Yahoo has none. */
export async function fetchFundHoldings(symbol: string): Promise<FundHolding[]> {
  try {
    const raw = (await getQuoteSummary(symbol, ["topHoldings"])) as RawTopHoldings;
    return (raw?.topHoldings?.holdings ?? [])
      .map((h) => {
        const pct = typeof h.holdingPercent === "number" ? h.holdingPercent : h.holdingPercent?.raw;
        return {
          symbol: h.symbol?.trim() ? canonicalizeListing(h.symbol.trim()) : null,
          name: h.holdingName ?? h.symbol ?? "Unknown holding",
          weight: typeof pct === "number" && Number.isFinite(pct) ? pct : 0,
        };
      })
      .filter((h) => h.weight > 0);
  } catch {
    return [];
  }
}
