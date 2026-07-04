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
