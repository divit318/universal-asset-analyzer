import type { Quote } from "./types";

/**
 * Orthogonal to MarketRegion (lib/market.ts): region answers "which
 * exchange/geography", this answers "what kind of instrument is this".
 * A symbol always has exactly one AssetClass; equities/funds additionally
 * have a MarketRegion, while classes like crypto/forex/macro mostly don't
 * carry a meaningful one.
 *
 * Only "equity" and "fund" have a working research engine today (see
 * lib/research-engines/registry.ts) — the rest are declared here so the
 * detection surface, registry keys, and UI switch statements are already
 * exhaustive by the time each engine is built, instead of every future
 * phase having to widen a union type across a dozen call sites.
 */
export type AssetClass =
  | "equity"
  | "fund"
  // Individual bonds have no free numeric feed at all (Yahoo covers bond
  // ETFs — already "fund" — and Treasury *yield* indices — now "macro" —
  // but no corporate/treasury bond pricing/CUSIPs). This value is kept
  // declared (not deleted) so the union stays exhaustive if a bond-data
  // provider is ever added, but no detection path produces it today —
  // fixed income's only real, honest deliverable (the yield curve) was
  // merged into "macro" instead of standing alone.
  | "fixed_income"
  | "commodity"
  | "crypto"
  | "forex"
  | "derivative"
  | "real_estate"
  | "private_market"
  | "alternative"
  | "structured_product"
  | "macro";

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  equity: "Equity",
  fund: "Fund",
  fixed_income: "Fixed Income",
  commodity: "Commodity",
  crypto: "Digital Asset",
  forex: "Forex",
  derivative: "Derivative",
  real_estate: "Real Estate",
  private_market: "Private Market",
  alternative: "Alternative Investment",
  structured_product: "Structured Product",
  macro: "Macroeconomic",
};

/**
 * Yahoo's `quoteType` (surfaced on Quote as `assetType`, untouched raw
 * string) is the primary — and for equity/fund/crypto/forex, sufficient —
 * detection signal. Classes with no live quote feed (real estate, private
 * markets, alternatives, structured products) can't be detected this way at
 * all; they enter through their own manual/comparable-driven flow rather
 * than a ticker search, so they're intentionally absent from this map.
 */
const QUOTE_TYPE_TO_ASSET_CLASS: Record<string, AssetClass> = {
  EQUITY: "equity",
  ETF: "fund",
  MUTUALFUND: "fund",
  CLOSEDENDFUND: "fund",
  CRYPTOCURRENCY: "crypto",
  CURRENCY: "forex",
  FUTURE: "commodity",
  OPTION: "derivative",
};

/**
 * Treasury yield indices (Yahoo quoteType INDEX, same as ^GSPC/^VIX/etc. —
 * not distinguishable by assetType alone) that carry real macroeconomic
 * meaning as a set — see lib/macro-analysis.ts. Deliberately a narrow exact-
 * match list, not "any INDEX symbol", so ^GSPC/^DJI/^VIX correctly keep
 * falling through to the equity-shaped default rather than being treated
 * as rate/macro instruments they aren't.
 */
export const MACRO_SYMBOLS = new Set(["^IRX", "^FVX", "^TNX", "^TYX"]);

/**
 * Derive the asset class from a quote's symbol + Yahoo `assetType`. Falls
 * back to "equity" for anything unrecognized (raw indices, unusual
 * quoteTypes) — the same "most common case wins" default `detectMarket()`
 * uses for region.
 */
export function detectAssetClass(quote: Pick<Quote, "assetType" | "symbol">): AssetClass {
  if (MACRO_SYMBOLS.has((quote.symbol ?? "").toUpperCase())) return "macro";
  const raw = (quote.assetType ?? "").toUpperCase();
  return QUOTE_TYPE_TO_ASSET_CLASS[raw] ?? "equity";
}
