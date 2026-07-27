import type { Quote } from "./types";

export type MarketRegion = "IN" | "JP" | "HK" | "AU" | "EU" | "US" | "CRYPTO";

/**
 * Charset covers every symbol shape the app accepts: US tickers (BRK.B),
 * suffixed listings (RELIANCE.NS), NSE names with ampersands (M&M), crypto
 * pairs (BTC-USD), indices (^GSPC), futures (GC=F). Deliberately excludes
 * "/", "?", "#", whitespace — symbols are interpolated into external URLs
 * and cache keys, so this doubles as injection protection.
 */
const SYMBOL_RE = /^[A-Z0-9.\-&^=]{1,15}$/;

/** True when `raw` (after trim/uppercase) is a plausible, URL-safe symbol. */
export function isValidSymbol(raw: string | null | undefined): boolean {
  return normalizeSymbol(raw) !== null;
}

/**
 * Canonical symbol from user input: trimmed, uppercased, validated.
 * Returns null for anything unsafe or empty — the single validation gate
 * for every API route that accepts a symbol.
 */
export function normalizeSymbol(raw: string | null | undefined): string | null {
  const sym = raw?.trim().toUpperCase();
  return sym && SYMBOL_RE.test(sym) ? sym : null;
}

/** Derive the listing market from a Yahoo Finance quote object (or any subset with these 4 fields — e.g. when only a symbol is known server-side). */
export function detectMarket(quote: Pick<Quote, "symbol" | "currency" | "exchange" | "assetType">): MarketRegion {
  const exch = (quote.exchange ?? "").toLowerCase();
  const cur = (quote.currency ?? "").toUpperCase();
  const sym = (quote.symbol ?? "").toUpperCase();

  if (quote.assetType === "CRYPTOCURRENCY") return "CRYPTO";

  if (
    cur === "INR" ||
    exch.includes("nse") ||
    exch.includes("bse") ||
    exch.includes("bombay") ||
    exch.includes("national stock exchange") ||
    sym.endsWith(".NS") ||
    sym.endsWith(".BO")
  ) return "IN";

  if (cur === "JPY" || exch.includes("tokyo") || exch.includes("osaka") || sym.endsWith(".T"))
    return "JP";

  if (cur === "HKD" || exch.includes("hong kong") || exch.includes("hkex") || sym.endsWith(".HK"))
    return "HK";

  if (cur === "AUD" || exch.includes("australian") || sym.endsWith(".AX"))
    return "AU";

  if (
    cur === "EUR" ||
    exch.includes("frankfurt") ||
    exch.includes("amsterdam") ||
    exch.includes("paris") ||
    exch.includes("milan") ||
    exch.includes("madrid") ||
    sym.endsWith(".DE") ||
    sym.endsWith(".AS") ||
    sym.endsWith(".PA") ||
    sym.endsWith(".MI") ||
    sym.endsWith(".MC")
  ) return "EU";

  return "US";
}

/** Country identity for a listing — drives the flag shown in global search results. */
export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  flag: string; // emoji flag
}

/**
 * Ticker suffix → country, for every exchange Yahoo Finance search can surface.
 * This is the single place to add a new market: one row here, and the global
 * search dropdown, flags, and grouping all pick it up with zero UI changes.
 * (Suffixes per Yahoo Finance's own convention: https://help.yahoo.com/kb/SLN2310.html)
 */
const SUFFIX_COUNTRY: Record<string, CountryInfo> = {
  // India
  NS: { code: "IN", flag: "🇮🇳" }, BO: { code: "IN", flag: "🇮🇳" },
  // United Kingdom
  L: { code: "GB", flag: "🇬🇧" }, IL: { code: "GB", flag: "🇬🇧" },
  // Germany (Xetra + regional exchanges)
  DE: { code: "DE", flag: "🇩🇪" }, F: { code: "DE", flag: "🇩🇪" }, BE: { code: "DE", flag: "🇩🇪" },
  DU: { code: "DE", flag: "🇩🇪" }, HM: { code: "DE", flag: "🇩🇪" }, HA: { code: "DE", flag: "🇩🇪" },
  MU: { code: "DE", flag: "🇩🇪" }, SG: { code: "DE", flag: "🇩🇪" },
  // Japan
  T: { code: "JP", flag: "🇯🇵" },
  // Greater China
  HK: { code: "HK", flag: "🇭🇰" }, SS: { code: "CN", flag: "🇨🇳" }, SZ: { code: "CN", flag: "🇨🇳" },
  TW: { code: "TW", flag: "🇹🇼" }, TWO: { code: "TW", flag: "🇹🇼" },
  // Australia / New Zealand
  AX: { code: "AU", flag: "🇦🇺" }, NZ: { code: "NZ", flag: "🇳🇿" },
  // Canada
  TO: { code: "CA", flag: "🇨🇦" }, V: { code: "CA", flag: "🇨🇦" }, CN: { code: "CA", flag: "🇨🇦" }, NE: { code: "CA", flag: "🇨🇦" },
  // Western Europe
  PA: { code: "FR", flag: "🇫🇷" }, MI: { code: "IT", flag: "🇮🇹" }, MC: { code: "ES", flag: "🇪🇸" },
  AS: { code: "NL", flag: "🇳🇱" }, BR: { code: "BE", flag: "🇧🇪" }, LS: { code: "PT", flag: "🇵🇹" },
  SW: { code: "CH", flag: "🇨🇭" }, VX: { code: "CH", flag: "🇨🇭" }, VI: { code: "AT", flag: "🇦🇹" }, IR: { code: "IE", flag: "🇮🇪" },
  // Nordics
  ST: { code: "SE", flag: "🇸🇪" }, CO: { code: "DK", flag: "🇩🇰" }, OL: { code: "NO", flag: "🇳🇴" },
  HE: { code: "FI", flag: "🇫🇮" }, IC: { code: "IS", flag: "🇮🇸" },
  // Central / Eastern Europe
  AT: { code: "GR", flag: "🇬🇷" }, WA: { code: "PL", flag: "🇵🇱" }, PR: { code: "CZ", flag: "🇨🇿" },
  IS: { code: "TR", flag: "🇹🇷" },
  // Southeast / South Asia & Middle East
  SI: { code: "SG", flag: "🇸🇬" }, KS: { code: "KR", flag: "🇰🇷" }, KQ: { code: "KR", flag: "🇰🇷" },
  JK: { code: "ID", flag: "🇮🇩" }, KL: { code: "MY", flag: "🇲🇾" }, BK: { code: "TH", flag: "🇹🇭" },
  TA: { code: "IL", flag: "🇮🇱" }, SR: { code: "SA", flag: "🇸🇦" }, QA: { code: "QA", flag: "🇶🇦" },
  // Americas
  SA: { code: "BR", flag: "🇧🇷" }, MX: { code: "MX", flag: "🇲🇽" }, BA: { code: "AR", flag: "🇦🇷" }, SN: { code: "CL", flag: "🇨🇱" },
  // Africa
  JO: { code: "ZA", flag: "🇿🇦" },
};

// Yahoo quote types that aren't tied to a single country — no flag makes sense.
const COUNTRYLESS_TYPES = new Set(["CRYPTOCURRENCY", "CURRENCY", "INDEX", "FUTURE"]);

/**
 * Resolve the listing country for a search suggestion. Suffix is checked
 * first since it's an explicit, unambiguous signal; suffix-less tickers
 * (the overwhelming majority of US listings) default to US. Returns null
 * for instruments that aren't tied to one country (crypto, FX, indices).
 */
export function countryForSuggestion(symbol: string, quoteType?: string | null): CountryInfo | null {
  if (quoteType && COUNTRYLESS_TYPES.has(quoteType.toUpperCase())) return null;
  const dot = symbol.lastIndexOf(".");
  const suffix = dot >= 0 ? symbol.slice(dot + 1).toUpperCase() : null;
  if (suffix && SUFFIX_COUNTRY[suffix]) return SUFFIX_COUNTRY[suffix];
  return { code: "US", flag: "🇺🇸" };
}

export const MARKET_LABEL: Record<MarketRegion, string> = {
  IN:     "NSE / BSE",
  JP:     "Tokyo",
  HK:     "HKEX",
  AU:     "ASX",
  EU:     "Europe",
  US:     "NYSE / NASDAQ",
  CRYPTO: "Crypto",
};

/** Tailwind class string: text-color + border-color + bg-color for market badges */
export const MARKET_BADGE: Record<MarketRegion, string> = {
  IN:     "text-orange-400 border-orange-400/30 bg-orange-400/10",
  JP:     "text-red-400 border-red-400/30 bg-red-400/10",
  HK:     "text-rose-300 border-rose-300/30 bg-rose-300/10",
  AU:     "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  EU:     "text-blue-400 border-blue-400/30 bg-blue-400/10",
  US:     "text-accent border-accent/30 bg-accent/10",
  CRYPTO: "text-purple-400 border-purple-400/30 bg-purple-400/10",
};
