/**
 * Candidate instruments the recommendation engine can propose.
 *
 * The old engine could only ever recommend moving money BETWEEN EXISTING HOLDINGS,
 * or into a hardcoded list of US large-cap stocks (`SECTOR_RATIONALE`: JNJ, JPM,
 * PG…). It structurally could not say "you have no bonds" or "you have no inflation
 * hedge", because it had no vocabulary for an asset class it didn't already own.
 *
 * These are broad, liquid, low-cost, widely-held index vehicles — deliberately
 * generic. The point is to name the EXPOSURE the portfolio is missing (duration,
 * inflation protection, international equity), not to make a stock pick. A user who
 * wants a different vehicle for the same exposure can substitute one; the
 * recommendation is about the gap, not the ticker.
 *
 * Candidates become real Holdings via the class adapters — they are valued, scored
 * and stress-tested by exactly the same code as everything else in the portfolio,
 * which is what makes the "expected impact" figures real rather than asserted.
 */

import type { PortfolioAssetClass, RawHolding } from "../model/types";

export interface Candidate {
  symbol: string;
  name: string;
  assetClass: PortfolioAssetClass;
  /** The exposure this instrument buys. This — not the ticker — is the recommendation. */
  exposure: string;
  /** Which portfolio weakness it addresses. */
  addresses: GapKind[];
  rationale: string;
}

export type GapKind =
  | "no_bonds"
  | "no_inflation_hedge"
  | "no_international"
  | "no_real_assets"
  | "no_income"
  | "no_cash"
  | "equity_concentration"
  | "no_defensives"
  | "duration_risk";

export const CANDIDATES: Candidate[] = [
  {
    symbol: "IEF",
    name: "iShares 7-10 Year Treasury Bond ETF",
    assetClass: "bond",
    exposure: "Intermediate US Treasury duration",
    addresses: ["no_bonds", "no_defensives", "equity_concentration"],
    rationale:
      "Intermediate Treasuries are the classic equity hedge: they rally in a flight to quality, which is exactly when equities fall.",
  },
  {
    symbol: "SHY",
    name: "iShares 1-3 Year Treasury Bond ETF",
    assetClass: "bond",
    exposure: "Short-duration Treasuries",
    addresses: ["no_bonds", "duration_risk", "no_income"],
    rationale:
      "Short duration captures most of the yield with a fraction of the rate risk — the right bond exposure when rates may still rise.",
  },
  {
    symbol: "TIP",
    name: "iShares TIPS Bond ETF",
    assetClass: "bond",
    exposure: "Inflation-linked government bonds",
    addresses: ["no_inflation_hedge", "no_bonds", "no_income"],
    rationale:
      "TIPS pay a real yield: the principal adjusts with CPI, so they protect purchasing power directly rather than by proxy.",
  },
  {
    symbol: "GLD",
    name: "SPDR Gold Shares",
    assetClass: "commodity",
    exposure: "Gold",
    addresses: ["no_inflation_hedge", "no_real_assets", "equity_concentration"],
    rationale:
      "Gold has near-zero equity beta and rises in crises and currency debasements — one of very few genuinely uncorrelated liquid assets.",
  },
  {
    symbol: "VNQ",
    name: "Vanguard Real Estate ETF",
    assetClass: "reit",
    exposure: "US listed real estate",
    addresses: ["no_real_assets", "no_income", "no_inflation_hedge"],
    rationale:
      "REITs pass through rental income and carry inflation-linked rents, though they are rate-sensitive.",
  },
  {
    symbol: "VXUS",
    name: "Vanguard Total International Stock ETF",
    assetClass: "etf",
    exposure: "Ex-US developed and emerging equity",
    addresses: ["no_international", "equity_concentration"],
    rationale:
      "Ex-US equity adds both geographic and currency diversification — a hedge against sustained US underperformance or dollar decline.",
  },
  {
    symbol: "VEA",
    name: "Vanguard FTSE Developed Markets ETF",
    assetClass: "etf",
    exposure: "Developed ex-US equity",
    addresses: ["no_international"],
    rationale: "Broad developed-market equity outside the US, at low cost.",
  },
  {
    symbol: "VYM",
    name: "Vanguard High Dividend Yield ETF",
    assetClass: "etf",
    exposure: "High-dividend US equity",
    addresses: ["no_income", "no_defensives"],
    rationale: "Raises portfolio income while keeping equity exposure, tilted toward mature cash-generative businesses.",
  },
  {
    symbol: "USFR",
    name: "WisdomTree Floating Rate Treasury Fund",
    assetClass: "bond",
    exposure: "Floating-rate Treasuries (T-bill proxy)",
    addresses: ["no_cash", "no_income", "duration_risk"],
    rationale:
      "A cash equivalent that actually earns the short rate with effectively zero duration — strictly better than idle cash.",
  },
  {
    symbol: "DBC",
    name: "Invesco DB Commodity Index Tracking Fund",
    assetClass: "commodity",
    exposure: "Broad commodities",
    addresses: ["no_inflation_hedge", "no_real_assets"],
    rationale:
      "Broad commodity exposure is among the few assets with reliably positive inflation beta, including energy and agriculture.",
  },
];

/** Turn a candidate into a RawHolding sized at `amount`, so the engines can value it. */
export function candidateToRaw(c: Candidate, amount: number, price: number | null): RawHolding {
  // Quantity is derived from the live price where we have one, so the simulated
  // position is a real, purchasable size — not an abstract dollar blob.
  const quantity = price != null && price > 0 ? amount / price : amount;

  return {
    id: `candidate:${c.symbol}`,
    assetClass: c.assetClass,
    symbol: c.symbol,
    name: c.name,
    currency: "USD",
    quantity,
    unit: c.assetClass === "commodity" ? "units" : "shares",
    costBasis: amount,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    meta: { candidate: true },
  };
}

export function candidatesFor(gap: GapKind): Candidate[] {
  return CANDIDATES.filter((c) => c.addresses.includes(gap));
}

/** Every symbol the recommendation engine may need a quote for. */
export function candidateSymbols(): string[] {
  return CANDIDATES.map((c) => c.symbol);
}
