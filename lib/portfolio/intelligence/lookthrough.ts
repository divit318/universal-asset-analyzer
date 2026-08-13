/**
 * Look-through exposure math — the arithmetic under "you own more X than you
 * think".
 *
 * Everything here is a DERIVED calculation over observed inputs (portfolio
 * weights from the ledger, constituent weights from Yahoo's `topHoldings`), and
 * everything carries the same structural caveat: Yahoo reports only a fund's
 * ten largest constituents, so every effective exposure and every overlap is a
 * LOWER BOUND. That is the honest direction to be wrong in — the tool may
 * under-warn, but it never manufactures exposure that might not exist.
 *
 * Pure functions, no I/O — testable against fixtures.
 */

import { canonicalizeSector } from "../../gics-sectors";
import type { FundLookThrough, IntelligenceInput } from "./types";
import { holdingLabel, isFundWrapper } from "./types";

/* ────────────────────────── Cross-listing identity ────────────────────────── */

/**
 * Same issuer, two listings. International funds disclose the local line
 * ("2330.TW") while a US book holds the ADR ("TSM") — same company, same
 * economic exposure, and without this map the engine misses exactly the
 * overlap it exists to find.
 *
 * Deliberately a short curated list of unambiguous mega-caps (the names that
 * actually turn up in fund top-ten disclosures), not a fuzzy matcher: an
 * unmapped local listing simply fails to match, which under-reports. That is
 * the same direction of error as the top-ten disclosure limit, and the only
 * acceptable one here.
 *
 * (Moved from the deleted lib/knowledge-graph/overlap.ts, which was a second
 * implementation of everything else in this file.)
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
  "NESN.SW": "NSRGY", // Nestlé (OTC ADR)
  "MC.PA": "LVMUY", // LVMH (OTC ADR)
  "OR.PA": "LRLCY", // L'Oréal (OTC ADR)
  "SIE.DE": "SIEGY", // Siemens (OTC ADR)
  "9988.HK": "BABA", // Alibaba
  "005930.KS": "SSNLF", // Samsung Electronics
};

/** The one symbol a company is counted under, whichever listing disclosed it. */
export function canonicalIssuerSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return LISTING_IDENTITY[upper] ?? upper;
}

/* ────────────────────────── Effective exposure ────────────────────────── */

export interface ExposureSource {
  /** "direct" or the wrapper's symbol — the LEDGER line the exposure arrives on. */
  via: string;
  /** Percentage points of PORTFOLIO value contributed through this source. */
  pct: number;
  /**
   * The issuer's effective weight INSIDE that wrapper, %, so the arithmetic can
   * be shown rather than asserted: `VOO 20.4% × NVDA 7.1% = 1.45% of book`.
   * 100 for a direct position (the line is the company).
   */
  innerPct: number;
  /**
   * Intermediate wrappers when the exposure passed through a fund-of-funds,
   * outermost first and excluding `via` itself. Empty in the common case.
   */
  nested: string[];
}

export interface EffectiveExposure {
  /** Underlying company symbol, upper-cased. */
  symbol: string;
  name: string;
  /** % of portfolio held directly. */
  directPct: number;
  /** % of portfolio held through fund wrappers (top-10 visible slice only). */
  indirectPct: number;
  totalPct: number;
  sources: ExposureSource[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Distribute every fund's weight across its visible constituents and merge with
 * direct positions, so "how much of company X do I actually own?" has one
 * answer across wrappers.
 *
 * Recurses one level when a constituent is itself a fund the portfolio holds
 * data for (a fund-of-funds top slice), with a visited set so a pathological
 * A-holds-B-holds-A payload cannot loop.
 */
export function computeEffectiveExposures(input: IntelligenceInput): EffectiveExposure[] {
  const acc = new Map<string, EffectiveExposure>();
  /** via → the ledger weight of that wrapper, for the innerPct back-solve below. */
  const viaWeight = new Map<string, number>();

  const add = (
    symbol: string,
    name: string,
    via: string,
    pct: number,
    direct: boolean,
    nested: string[],
  ) => {
    const key = canonicalIssuerSymbol(symbol);
    let e = acc.get(key);
    if (!e) {
      e = { symbol: key, name, directPct: 0, indirectPct: 0, totalPct: 0, sources: [] };
      acc.set(key, e);
    }
    if (direct) e.directPct += pct;
    else e.indirectPct += pct;
    e.totalPct += pct;
    const existing = e.sources.find((s) => s.via === via);
    if (existing) {
      existing.pct += pct;
      // Union of the chains seen through this wrapper — a fund-of-funds can
      // reach one issuer both directly and through a sleeve.
      for (const n of nested) if (!existing.nested.includes(n)) existing.nested.push(n);
    } else {
      e.sources.push({ via, pct, innerPct: 0, nested: [...nested] });
    }
    // Prefer the constituent's full company name over a bare ticker.
    if (name.length > e.name.length) e.name = name;
  };

  const distribute = (
    fund: FundLookThrough,
    portfolioPct: number,
    via: string,
    visited: Set<string>,
    nested: string[],
  ) => {
    if (visited.has(fund.symbol)) return;
    const next = new Set(visited).add(fund.symbol);
    for (const c of fund.topHoldings) {
      if (!c.symbol) continue;
      const slice = portfolioPct * (c.weightPercent / 100);
      if (slice <= 0) continue;
      const inner = input.funds.get(c.symbol.toUpperCase());
      if (inner && inner !== fund) {
        distribute(inner, slice, via, next, [...nested, c.symbol.toUpperCase()]);
      } else {
        add(c.symbol, c.name || c.symbol, via, slice, false, nested);
      }
    }
  };

  for (const h of input.holdings) {
    if (!h.symbol || h.weight <= 0) continue;
    const sym = h.symbol.toUpperCase();
    const fund = isFundWrapper(h) ? input.funds.get(sym) : undefined;
    if (fund) {
      viaWeight.set(sym, (viaWeight.get(sym) ?? 0) + h.weight);
      distribute(fund, h.weight, sym, new Set(), []);
    } else if (h.assetClass === "equity" || h.assetClass === "reit") {
      viaWeight.set("direct", (viaWeight.get("direct") ?? 0) + h.weight);
      add(h.symbol, h.name, "direct", h.weight, true, []);
    }
  }

  /* innerPct is back-solved from the totals rather than accumulated during the
     walk, so a fund-of-funds chain yields the issuer's EFFECTIVE weight inside
     the wrapper the user actually holds — which is the number the hover
     arithmetic needs, and the only one that reconciles with the band width. */
  const out = [...acc.values()].map((e) => ({
    ...e,
    directPct: round2(e.directPct),
    indirectPct: round2(e.indirectPct),
    totalPct: round2(e.totalPct),
    sources: e.sources
      .map((s) => {
        const wrapper = s.via === "direct" ? 0 : (viaWeight.get(s.via) ?? 0);
        return {
          ...s,
          pct: round2(s.pct),
          innerPct: s.via === "direct" ? 100 : wrapper > 0 ? round2((s.pct / wrapper) * 100) : 0,
        };
      })
      .sort((a, b) => b.pct - a.pct),
  }));
  return out.sort((a, b) => b.totalPct - a.totalPct);
}

/* ────────────────────────── Fund pair overlap ────────────────────────── */

export interface FundOverlap {
  a: string;
  b: string;
  /** Σ min(weight in A, weight in B) over shared top-10 names — % of a fund. Lower bound. */
  overlapPct: number;
  shared: { symbol: string; name: string; aPct: number; bPct: number }[];
  sameCategory: boolean;
  category: string | null;
}

/** Pairwise visible overlap between two held funds. */
export function fundPairOverlap(a: FundLookThrough, b: FundLookThrough): FundOverlap {
  // Keyed on the canonical issuer, so a fund disclosing 2330.TW and one
  // disclosing TSM are recognised as holding the same company.
  const bBySymbol = new Map(b.topHoldings.map((h) => [canonicalIssuerSymbol(h.symbol), h]));
  const shared: FundOverlap["shared"] = [];
  let overlap = 0;
  for (const h of a.topHoldings) {
    const canonical = canonicalIssuerSymbol(h.symbol);
    const other = bBySymbol.get(canonical);
    if (!other) continue;
    overlap += Math.min(h.weightPercent, other.weightPercent);
    shared.push({
      symbol: canonical,
      name: h.name || h.symbol,
      aPct: round2(h.weightPercent),
      bPct: round2(other.weightPercent),
    });
  }
  shared.sort((x, y) => Math.min(y.aPct, y.bPct) - Math.min(x.aPct, x.bPct));
  const sameCategory = a.category != null && a.category === b.category;
  return {
    a: a.symbol,
    b: b.symbol,
    overlapPct: round2(overlap),
    shared,
    sameCategory,
    category: sameCategory ? a.category : null,
  };
}

/* ────────────────────────── Sector look-through ────────────────────────── */

export interface LookThroughSector {
  sector: string;
  /** % of portfolio value, through wrappers and direct positions combined. */
  pct: number;
  viaFundsPct: number;
  viaDirectPct: number;
}

export interface SectorLookThroughResult {
  sectors: LookThroughSector[];
  /** % of portfolio value the look-through could classify by sector. */
  classifiedPct: number;
}

/**
 * True sector exposure: distribute each majority-equity fund's weight across its
 * reported sector distribution and add direct equities' own sectors. Bond,
 * commodity, cash and opaque-fund value stays UNclassified — counted in the
 * denominator disclosure, never guessed into a sector.
 *
 * This is the number the allocation panel structurally cannot show: there,
 * every diversified ETF is one "Diversified" slice.
 */
export function lookThroughSectors(input: IntelligenceInput): SectorLookThroughResult {
  const acc = new Map<string, LookThroughSector>();
  let classified = 0;

  const add = (sector: string, pct: number, viaFund: boolean) => {
    let s = acc.get(sector);
    if (!s) {
      s = { sector, pct: 0, viaFundsPct: 0, viaDirectPct: 0 };
      acc.set(sector, s);
    }
    s.pct += pct;
    if (viaFund) s.viaFundsPct += pct;
    else s.viaDirectPct += pct;
  };

  for (const h of input.holdings) {
    if (h.weight <= 0) continue;
    const fund = h.symbol && isFundWrapper(h) ? input.funds.get(h.symbol.toUpperCase()) : undefined;
    if (fund?.sectorWeights && (fund.equityWeightPct ?? 0) >= 50) {
      // Sector weightings describe the equity sleeve; for a majority-equity fund
      // treating them as % of the fund overstates each sector by at most the
      // non-equity remainder, so scale by the equity share to stay conservative.
      const scale = Math.min(1, (fund.equityWeightPct ?? 100) / 100);
      for (const sw of fund.sectorWeights) {
        const pct = h.weight * (sw.weightPercent / 100) * scale;
        if (pct <= 0) continue;
        add(canonicalizeSector(sw.sector) ?? sw.sector, pct, true);
        classified += pct;
      }
    } else if (h.assetClass === "equity" || h.assetClass === "reit") {
      const sector = h.attributes.sector ? canonicalizeSector(h.attributes.sector) : null;
      if (sector) {
        add(sector, h.weight, false);
        classified += h.weight;
      }
    }
  }

  const sectors = [...acc.values()]
    .map((s) => ({
      sector: s.sector,
      pct: round2(s.pct),
      viaFundsPct: round2(s.viaFundsPct),
      viaDirectPct: round2(s.viaDirectPct),
    }))
    .sort((a, b) => b.pct - a.pct);
  return { sectors, classifiedPct: round2(classified) };
}

/* ────────────────────────── Coverage ────────────────────────── */

export function lookThroughCoverage(input: IntelligenceInput): {
  fundsAnalyzed: number;
  fundsOpaque: string[];
  lookThroughPct: number;
} {
  let fundValuePct = 0;
  let visiblePct = 0;
  let analyzed = 0;
  const opaque: string[] = [];
  for (const h of input.holdings) {
    if (!isFundWrapper(h) || !h.symbol) continue;
    fundValuePct += h.weight;
    if (input.funds.has(h.symbol.toUpperCase())) {
      visiblePct += h.weight;
      analyzed++;
    } else {
      opaque.push(holdingLabel(h));
    }
  }
  return {
    fundsAnalyzed: analyzed,
    fundsOpaque: opaque,
    lookThroughPct: fundValuePct > 0 ? Math.round((visiblePct / fundValuePct) * 100) : 100,
  };
}

/* ────────────────────────── Correlation helpers ────────────────────────── */

/**
 * Union-find clusters over the correlation matrix: labels joined when their
 * pairwise r meets the threshold. NaN cells (unmeasurable pairs) never join —
 * unknown correlation is not high correlation.
 */
export function correlationClusters(
  symbols: string[],
  matrix: number[][],
  threshold: number,
): string[][] {
  const parent = symbols.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };
  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const r = matrix[i]?.[j];
      if (r != null && Number.isFinite(r) && r >= threshold) union(i, j);
    }
  }
  const groups = new Map<number, string[]>();
  for (let i = 0; i < symbols.length; i++) {
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(symbols[i]);
    groups.set(root, g);
  }
  return [...groups.values()].filter((g) => g.length >= 2);
}

/** Pairwise r between two labels, or null when unmeasured. */
export function pairCorrelation(
  symbols: string[],
  matrix: number[][],
  a: string,
  b: string,
): number | null {
  const i = symbols.indexOf(a);
  const j = symbols.indexOf(b);
  if (i < 0 || j < 0) return null;
  const r = matrix[i]?.[j];
  return r != null && Number.isFinite(r) ? r : null;
}
