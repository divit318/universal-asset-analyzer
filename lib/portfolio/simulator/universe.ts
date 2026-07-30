/**
 * Curated candidate universe for portfolio generation — the backbone of the
 * hybrid ticker-selection strategy.
 *
 * Local models hallucinate tickers; a generated portfolio must not contain
 * one. The AI therefore selects core positions from this hand-curated list of
 * deeply liquid, real instruments (every pick is still re-validated against a
 * live quote), and may add satellite picks beyond it, which survive only if
 * Yahoo returns a live price. This is deliberately NOT the screener universes
 * (lib/screener/universes/): those are async multi-hundred-name fetches built
 * for ranking, and construction wants a small vetted menu, not a market scan.
 */

import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";

export interface UniverseCandidate {
  symbol: string;
  name: string;
  /** What role this instrument plays in a book — shown to the AI. */
  role: string;
}

/** Asset classes the generator may allocate to (a subset of PortfolioAssetClass:
 * everything live-priceable through Yahoo plus the cash sleeve). */
export const GENERATABLE_CLASSES = [
  "equity",
  "etf",
  "bond",
  "reit",
  "commodity",
  "crypto",
  "cash",
] as const satisfies readonly PortfolioAssetClass[];

export type GeneratableClass = (typeof GENERATABLE_CLASSES)[number];

export const CURATED_UNIVERSE: Record<Exclude<GeneratableClass, "cash">, UniverseCandidate[]> = {
  etf: [
    { symbol: "VOO", name: "Vanguard S&P 500 ETF", role: "US large-cap core" },
    { symbol: "VTI", name: "Vanguard Total Stock Market ETF", role: "US total-market core" },
    { symbol: "QQQ", name: "Invesco QQQ Trust", role: "US large-cap growth / tech tilt" },
    { symbol: "VXUS", name: "Vanguard Total International Stock ETF", role: "ex-US developed + emerging core" },
    { symbol: "VEA", name: "Vanguard FTSE Developed Markets ETF", role: "developed international" },
    { symbol: "VWO", name: "Vanguard FTSE Emerging Markets ETF", role: "emerging markets" },
    { symbol: "SCHD", name: "Schwab US Dividend Equity ETF", role: "dividend income + quality" },
    { symbol: "VIG", name: "Vanguard Dividend Appreciation ETF", role: "dividend growth" },
    { symbol: "IJR", name: "iShares Core S&P Small-Cap ETF", role: "US small-cap" },
    { symbol: "VGT", name: "Vanguard Information Technology ETF", role: "technology sector" },
    { symbol: "VHT", name: "Vanguard Health Care ETF", role: "healthcare sector" },
    { symbol: "VPU", name: "Vanguard Utilities ETF", role: "defensive utilities / income" },
  ],
  bond: [
    { symbol: "BND", name: "Vanguard Total Bond Market ETF", role: "US aggregate bond core" },
    { symbol: "AGG", name: "iShares Core US Aggregate Bond ETF", role: "US aggregate bond core" },
    { symbol: "VGIT", name: "Vanguard Intermediate-Term Treasury ETF", role: "intermediate treasuries" },
    { symbol: "VGLT", name: "Vanguard Long-Term Treasury ETF", role: "long-duration treasuries / equity hedge" },
    { symbol: "SHY", name: "iShares 1-3 Year Treasury Bond ETF", role: "short-duration / near-cash" },
    { symbol: "TIP", name: "iShares TIPS Bond ETF", role: "inflation-protected treasuries" },
    { symbol: "VTIP", name: "Vanguard Short-Term Inflation-Protected ETF", role: "short-duration inflation protection" },
    { symbol: "LQD", name: "iShares Investment Grade Corporate Bond ETF", role: "IG corporate credit / yield" },
    { symbol: "HYG", name: "iShares High Yield Corporate Bond ETF", role: "high-yield credit (higher risk)" },
    { symbol: "BNDX", name: "Vanguard Total International Bond ETF", role: "hedged international bonds" },
    { symbol: "MUB", name: "iShares National Muni Bond ETF", role: "tax-exempt income (US taxable accounts)" },
  ],
  reit: [
    { symbol: "VNQ", name: "Vanguard Real Estate ETF", role: "US REIT core" },
    { symbol: "SCHH", name: "Schwab US REIT ETF", role: "US REIT core (low cost)" },
    { symbol: "VNQI", name: "Vanguard Global ex-US Real Estate ETF", role: "international real estate" },
    { symbol: "O", name: "Realty Income Corp", role: "single-name net-lease income REIT" },
    { symbol: "PLD", name: "Prologis Inc", role: "industrial/logistics REIT" },
    { symbol: "AMT", name: "American Tower Corp", role: "communications infrastructure REIT" },
  ],
  commodity: [
    { symbol: "GLD", name: "SPDR Gold Shares", role: "gold / crisis hedge" },
    { symbol: "IAU", name: "iShares Gold Trust", role: "gold (low cost)" },
    { symbol: "SLV", name: "iShares Silver Trust", role: "silver" },
    { symbol: "PDBC", name: "Invesco Optimum Yield Diversified Commodity", role: "broad commodities (no K-1)" },
    { symbol: "DBC", name: "Invesco DB Commodity Index Fund", role: "broad commodities" },
    { symbol: "USO", name: "United States Oil Fund", role: "crude oil (tactical only)" },
  ],
  crypto: [
    { symbol: "BTC-USD", name: "Bitcoin", role: "crypto core" },
    { symbol: "ETH-USD", name: "Ethereum", role: "crypto — smart-contract platform" },
  ],
  // Single-name equities: a menu of megacap anchors. The AI may go beyond this
  // list for satellites; anything it invents dies at quote validation.
  equity: [
    { symbol: "AAPL", name: "Apple Inc", role: "megacap quality" },
    { symbol: "MSFT", name: "Microsoft Corp", role: "megacap quality / software" },
    { symbol: "GOOGL", name: "Alphabet Inc", role: "megacap — advertising/AI" },
    { symbol: "AMZN", name: "Amazon.com Inc", role: "megacap — retail/cloud" },
    { symbol: "NVDA", name: "NVIDIA Corp", role: "AI/semiconductor growth" },
    { symbol: "BRK-B", name: "Berkshire Hathaway B", role: "diversified quality compounder" },
    { symbol: "JNJ", name: "Johnson & Johnson", role: "defensive healthcare dividend" },
    { symbol: "PG", name: "Procter & Gamble", role: "defensive staples dividend" },
    { symbol: "JPM", name: "JPMorgan Chase", role: "financials anchor" },
    { symbol: "XOM", name: "Exxon Mobil", role: "energy / inflation hedge" },
  ],
};

/**
 * Predicate identifying candidates a mandate forbids.
 *
 * Passed in rather than imported so this module stays a data file with no
 * knowledge of intake — and so the SAME filter runs over the menu the model sees
 * and over the deterministic fallbacks. Offering XOM on the menu to a client who
 * excluded fossil fuels and then discarding the pick afterwards wastes a model
 * call and produces a thinner portfolio for no reason; the honest fix is to never
 * offer it.
 */
export type CandidateFilter = (c: UniverseCandidate & { assetClass: Exclude<GeneratableClass, "cash"> }) => boolean;

function allowedIn(cls: Exclude<GeneratableClass, "cash">, allow?: CandidateFilter): UniverseCandidate[] {
  if (!allow) return CURATED_UNIVERSE[cls];
  return CURATED_UNIVERSE[cls].filter((c) => allow({ ...c, assetClass: cls }));
}

/** Compact menu text for prompts: one line per candidate, grouped by class. */
export function universeForPrompt(
  classes: Exclude<GeneratableClass, "cash">[],
  allow?: CandidateFilter,
): string {
  return classes
    .map((cls) => ({ cls, candidates: allowedIn(cls, allow) }))
    // A class whose every candidate is excluded is omitted rather than printed
    // with an empty body, which would read as a data bug to the model.
    .filter(({ candidates }) => candidates.length > 0)
    .map(
      ({ cls, candidates }) =>
        `${cls.toUpperCase()}:\n` +
        candidates.map((c) => `  ${c.symbol} — ${c.name} (${c.role})`).join("\n"),
    )
    .join("\n");
}

/**
 * Deterministic fallback pick when the AI leaves a class empty: its first (most
 * core) curated candidate that the mandate permits.
 *
 * Returns null when the mandate forbids every candidate in the class — the caller
 * must then leave the class unfilled rather than substitute something excluded.
 * Silently planting GLD in the book of someone who asked for no commodities would
 * be worse than an underweight class.
 */
export function fallbackCandidate(
  cls: Exclude<GeneratableClass, "cash">,
  allow?: CandidateFilter,
): UniverseCandidate | null {
  return allowedIn(cls, allow)[0] ?? null;
}
