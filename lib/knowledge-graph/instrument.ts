/**
 * Instrument type resolution for the knowledge graph.
 *
 * "What kind of thing is this symbol" was previously not modeled at all:
 * FX pairs, futures, crypto and bond ETFs all rendered as companies and were
 * force-fed a single equity-style sector. This resolver distinguishes them
 * deterministically:
 *
 * 1. Symbol shape (pure, no I/O): `=X` FX, `=F` futures, `^` index,
 *    `-P?` US preferred share suffixes.
 * 2. Yahoo `quoteType` (via the platform-cached quote): EQUITY / ETF /
 *    MUTUALFUND / CRYPTOCURRENCY / CURRENCY / FUTURE / INDEX.
 * 3. For funds, the underlying asset class is inferred from the fund name
 *    (bond/commodity/mixed keywords). That is a heuristic and is labeled as
 *    such: `underlyingSource: "name-heuristic"`, confidence stays null.
 *
 * Sector policy: only common equity and preferreds get a single-sector
 * classification. Funds get weighted sector *exposures* from Yahoo's holdings
 * composition when available (see fundSectorExposures), never a fake
 * single-sector edge. FX/crypto/futures/indices get none.
 */

import { getQuote, getQuoteSummary } from "../yahoo";
import { canonicalizeSector } from "../gics-sectors";
import type { Quote } from "../types";
import type { InstrumentType } from "./types";

export interface ResolvedInstrument {
  symbol: string;
  /** Human name when a quote resolved; falls back to the symbol. */
  name: string;
  instrument: InstrumentType;
  /** Canonical GICS-11 sector, only for single-issuer instruments; null otherwise. */
  sector: string | null;
  /** Live quote when available (platform-cached); null when the fetch failed. */
  quote: Quote | null;
  /** Where the fund-underlying call came from, for honest UI labeling. */
  underlyingSource: "quote-type" | "name-heuristic" | null;
}

const BOND_RE = /\b(bond|treasury|fixed income|high yield|corporate|municipal|aggregate|tips|floating rate|income fund|yield bond|t-bill|duration)\b/i;
const COMMODITY_RE = /\b(gold|silver|platinum|palladium|commodit\w*|crude|oil fund|natural gas|copper|uranium|agriculture)\b/i;
const MIXED_RE = /\b(allocation|balanced|target(?:\s|-)date|multi-asset|60\/40)\b/i;

/** Pure: classify a fund's underlying asset class from its name. Heuristic, labeled as such. */
export function classifyFundUnderlying(name: string): InstrumentType {
  if (BOND_RE.test(name)) return "etf_bond";
  if (COMMODITY_RE.test(name)) return "etf_commodity";
  if (MIXED_RE.test(name)) return "etf_mixed";
  return "etf_equity";
}

/** Pure: instrument type from symbol shape + Yahoo quoteType + name. */
export function classifyInstrument(symbol: string, quoteType: string | null | undefined, name: string): InstrumentType {
  const sym = symbol.toUpperCase();
  if (sym.endsWith("=X")) return "fx_pair";
  if (sym.endsWith("=F")) return "future";
  if (sym.startsWith("^")) return "index";

  const qt = (quoteType ?? "").toUpperCase();
  if (qt === "CRYPTOCURRENCY") return "crypto";
  if (qt === "CURRENCY") return "fx_pair";
  if (qt === "FUTURE") return "future";
  if (qt === "INDEX") return "index";
  if (qt === "ETF" || qt === "CLOSEDENDFUND") return classifyFundUnderlying(name);
  if (qt === "MUTUALFUND") return "mutual_fund";
  if (qt === "EQUITY") {
    // US preferred share listings (SCHW-PD, PBR-A is a share class, not preferred;
    // require the -P prefix convention specifically).
    if (/-P[A-Z]?$/.test(sym)) return "preferred";
    return "common_equity";
  }
  return "unknown";
}

/** Strip Yahoo feed suffixes for display: "USDCHF=X" -> "USD/CHF", "HO=F" -> "HO". */
export function displaySymbol(symbol: string, instrument: InstrumentType): string {
  const sym = symbol.toUpperCase();
  if (instrument === "fx_pair" && sym.endsWith("=X")) {
    const pair = sym.slice(0, -2);
    return pair.length === 6 ? `${pair.slice(0, 3)}/${pair.slice(3)}` : pair;
  }
  if (instrument === "future" && sym.endsWith("=F")) return sym.slice(0, -2);
  if (instrument === "crypto" && sym.endsWith("-USD")) return sym.slice(0, -4);
  return sym;
}

/** True when this instrument type is a single-issuer security that can carry one sector. */
export function isSingleIssuer(instrument: InstrumentType): boolean {
  return instrument === "common_equity" || instrument === "preferred";
}

/**
 * Resolve one symbol. Best-effort: a failed quote fetch degrades to
 * shape-only classification with `quote: null`, never throws.
 */
export async function resolveInstrument(symbol: string, knownSector?: string | null): Promise<ResolvedInstrument> {
  const quote = await getQuote(symbol).catch(() => null);
  const name = quote?.name || symbol;
  const instrument = classifyInstrument(symbol, quote?.assetType, name);
  const sector = isSingleIssuer(instrument) && knownSector ? canonicalizeSector(knownSector) : null;
  return {
    symbol: symbol.toUpperCase(),
    name,
    instrument,
    sector,
    quote,
    underlyingSource: instrument.startsWith("etf_") ? "name-heuristic" : instrument === "unknown" ? null : "quote-type",
  };
}

/* -------------------------------------------------------------------------- */
/* Fund sector exposure (holdings composition)                                */
/* -------------------------------------------------------------------------- */

/** Yahoo topHoldings sectorWeightings keys -> canonical GICS-11 names. */
const YAHOO_FUND_SECTOR: Record<string, string> = {
  realestate: "Real Estate",
  consumer_cyclical: "Consumer Cyclical",
  basic_materials: "Materials",
  consumer_defensive: "Consumer Staples",
  technology: "Technology",
  communication_services: "Communication Services",
  financial_services: "Financials",
  utilities: "Utilities",
  industrials: "Industrials",
  energy: "Energy",
  healthcare: "Healthcare",
};

export interface FundSectorExposure {
  sector: string; // canonical GICS-11
  weight: number; // 0-1
}

interface RawTopHoldings {
  topHoldings?: { sectorWeightings?: Record<string, number>[] };
}

/**
 * Weighted sector exposures for a fund from Yahoo's holdings composition.
 * Only exposures >= minWeight are returned (default 5%), largest first.
 * Best-effort: [] when Yahoo has no composition for this fund.
 */
export async function fundSectorExposures(symbol: string, minWeight = 0.05): Promise<FundSectorExposure[]> {
  try {
    const raw = (await getQuoteSummary(symbol, ["topHoldings"])) as RawTopHoldings;
    const weightings = raw?.topHoldings?.sectorWeightings ?? [];
    const out: FundSectorExposure[] = [];
    for (const entry of weightings) {
      for (const [key, weight] of Object.entries(entry)) {
        const sector = YAHOO_FUND_SECTOR[key];
        if (sector && typeof weight === "number" && weight >= minWeight) out.push({ sector, weight });
      }
    }
    return out.sort((a, b) => b.weight - a.weight);
  } catch {
    return [];
  }
}
