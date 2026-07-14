/**
 * The Universal Holdings Model — Portfolio's asset-agnostic contract.
 *
 * The governing rule of this module, and the reason it exists:
 *
 *   Asset classes plug metrics INTO shared engines. Engines never branch ON
 *   asset class.
 *
 * A `switch (assetClass)` inside lib/portfolio/engines/ is a design failure —
 * it means class-specific knowledge leaked out of the class adapter. Engines
 * read only the normalized fields below (valueBase, liquidity, income, factors,
 * attributes); everything class-specific reaches them through those.
 *
 * Taxonomy: this file deliberately does NOT invent a new asset-class enum.
 * PortfolioAssetClass is the union of the two that already exist
 * (lib/assets/types.ts AssetClassId for market-priced classes, lib/types.ts
 * ManualAssetCategory for the manually-valued ones) plus the one thing neither
 * models — cash. See PLAN-portfolio-universal.md §2.2.
 */

import type { AssetClassId } from "../../assets/types";
import type { DataSourceId } from "../../provenance";
import type { ManualAssetCategory } from "../../types";

/* -------------------------------------------------------------------------- */
/* Class identity                                                              */
/* -------------------------------------------------------------------------- */

export type PortfolioAssetClass = AssetClassId | ManualAssetCategory | "cash";

export const PORTFOLIO_ASSET_CLASSES: PortfolioAssetClass[] = [
  "equity",
  "etf",
  "reit",
  "bond",
  "crypto",
  "commodity",
  "forex",
  "cash",
  "real_estate",
  "private_market",
  "alternative",
  "structured_product",
];

/**
 * The subset of PortfolioAssetClass that resolves through a ticker + live
 * quote (no cash, no manually-valued classes). Shared by every buy/add flow
 * that looks a symbol up via /api/quote — the API route validating the
 * purchase and the client form offering the class picker must agree on
 * exactly this list, so it lives here once instead of two literals drifting.
 */
export const TICKER_PRICED_ASSET_CLASSES: PortfolioAssetClass[] = [
  "equity",
  "etf",
  "reit",
  "bond",
  "crypto",
  "commodity",
  "forex",
];

/**
 * Yahoo's raw quoteType (Quote.assetType) mapped straight to a ticker-priced
 * PortfolioAssetClass. Deliberately separate from lib/asset-class.ts's
 * detectAssetClass() — that maps into a different taxonomy (ETF/MUTUALFUND ->
 * "fund", not "etf") for the research side of the app, and applying it here
 * would silently mis-default every ETF/fund purchase to "equity". Both the
 * buy API route and the buy form's class picker use this one mapping, so
 * they can't drift.
 */
const QUOTE_TYPE_TO_PORTFOLIO_CLASS: Partial<Record<string, PortfolioAssetClass>> = {
  EQUITY: "equity",
  ETF: "etf",
  MUTUALFUND: "etf",
  CLOSEDENDFUND: "etf",
  CRYPTOCURRENCY: "crypto",
  CURRENCY: "forex",
  FUTURE: "commodity",
};

export function detectPortfolioAssetClass(assetType: string | null | undefined): PortfolioAssetClass {
  return QUOTE_TYPE_TO_PORTFOLIO_CLASS[(assetType ?? "").toUpperCase()] ?? "equity";
}

export const PORTFOLIO_CLASS_LABEL: Record<PortfolioAssetClass, string> = {
  equity: "Equities",
  etf: "ETFs",
  reit: "REITs",
  bond: "Bonds",
  crypto: "Crypto",
  commodity: "Commodities",
  forex: "Forex",
  cash: "Cash & Equivalents",
  real_estate: "Real Estate",
  private_market: "Private Markets",
  alternative: "Alternatives",
  structured_product: "Structured Products",
};

/* -------------------------------------------------------------------------- */
/* Valuation                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How a holding's current value is established. The current engine assumes
 * `quantity × live price` universally; that is exactly what makes it unable to
 * hold a house, a stake in a private company, or a dollar of cash.
 */
export type ValuationMode =
  /** quantity × live market price (equity, etf, reit, crypto, commodity, bond fund) */
  | "market"
  /** user-stated current value (real estate, private markets, alternatives) */
  | "manual"
  /** computed from a model (structured product payoff; ownership% × company valuation) */
  | "derived"
  /** face value, optionally yielding (cash & equivalents) */
  | "cash";

/** How fast the holding can be turned into cash without a material price concession. */
export type Liquidity =
  /** Same-day: listed equities, ETFs, major crypto, cash. */
  | "t0"
  /** Days: small caps, thin ETFs, most bond funds. */
  | "t1"
  /** Weeks: structured products, thinly traded alternatives with an active market. */
  | "t2"
  /** No market: real estate, private markets, most collectibles. */
  | "illiquid";

export const LIQUIDITY_LABEL: Record<Liquidity, string> = {
  t0: "Same day",
  t1: "Days",
  t2: "Weeks",
  illiquid: "Illiquid",
};

/** Ordered most→least liquid, for bucketing and comparison. */
export const LIQUIDITY_ORDER: Liquidity[] = ["t0", "t1", "t2", "illiquid"];

export interface Valuation {
  mode: ValuationMode;
  /** Current value in the holding's own `currency`. */
  value: number;
  /**
   * Current value in the portfolio's base currency. This is the ONLY value
   * field the engines are allowed to sum — mixing currencies in an aggregate is
   * the FX bug this field exists to make impossible.
   */
  valueBase: number;
  /** FX rate applied to get from `currency` to base. 1 when they're the same. */
  fxRate: number;
  source: DataSourceId | "user" | "model";
  /** ISO timestamp of when this value was established. */
  asOf: string;
  /**
   * True when a manually-entered valuation has aged past its class's staleness
   * bound. A house appraised three years ago is not the same input as a quote
   * from 60 seconds ago, and must not silently anchor a recommendation with the
   * same confidence.
   */
  stale: boolean;
}

/* -------------------------------------------------------------------------- */
/* Income                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Income is NOT "dividend yield". The current health score's Income dimension
 * reads `dividendYield` only, which scores a Treasury ladder, a rental property
 * and a staked-ETH position at exactly zero.
 */
export type IncomeKind =
  | "dividend"
  | "coupon"
  | "rent"
  | "interest"
  | "staking"
  | "distribution"
  | "none";

export interface Income {
  /** Expected annual income in base currency. */
  annual: number;
  /** annual / valueBase × 100. */
  yieldPct: number;
  kind: IncomeKind;
}

/* -------------------------------------------------------------------------- */
/* Factors — the core cross-asset abstraction                                  */
/* -------------------------------------------------------------------------- */

/**
 * The macro factors a portfolio is actually exposed to.
 *
 * This replaces the current engine's `shocks[gicsSector] ?? -20`, which does not
 * merely omit non-equities — it *mis-prices* them. Under the existing "2008
 * Financial Crisis" scenario gold is shocked -20% (it rose ~5%) and long
 * Treasuries -20% (they rallied hard), because neither has a GICS sector and both
 * fall through to the default. Those are precisely the assets one holds FOR their
 * crisis behaviour, so the tool is most wrong exactly where it matters most.
 *
 * A scenario is therefore a vector of factor shocks, and each asset class declares
 * its sensitivity to each factor. Impact = Σ_f sensitivity[f] × shock[f].
 * Every class reacts appropriately to every scenario by construction, rather than
 * because someone remembered to add a row to a lookup table.
 */
export type Factor =
  /** Broad equity market return. Sensitivity = beta. */
  | "equityBeta"
  /** Level of interest rates, in percentage points. Sensitivity = −duration. */
  | "rates"
  /** IG/HY credit spread widening, in percentage points. */
  | "creditSpread"
  /** Inflation surprise, in percentage points. */
  | "inflation"
  /** Trade-weighted USD strength, in percent. */
  | "usd"
  /** Crude oil / broad energy complex, in percent. */
  | "oil"
  /** Gold / precious metals, in percent. */
  | "gold"
  /** Crypto market beta, in percent. */
  | "cryptoBeta"
  /** Real-estate cap-rate expansion, in percentage points (higher cap rate = lower value). */
  | "realEstateCap"
  /** Market-wide liquidity stress / flight to quality, 0-1 severity. */
  | "liquidityStress";

export const FACTORS: Factor[] = [
  "equityBeta",
  "rates",
  "creditSpread",
  "inflation",
  "usd",
  "oil",
  "gold",
  "cryptoBeta",
  "realEstateCap",
  "liquidityStress",
];

export const FACTOR_LABEL: Record<Factor, string> = {
  equityBeta: "Equity market",
  rates: "Interest rates",
  creditSpread: "Credit spreads",
  inflation: "Inflation",
  usd: "US dollar",
  oil: "Oil & energy",
  gold: "Gold",
  cryptoBeta: "Crypto market",
  realEstateCap: "Real estate cap rates",
  liquidityStress: "Liquidity stress",
};

/** The unit a shock to this factor is expressed in — drives UI and prompt copy. */
export const FACTOR_SHOCK_UNIT: Record<Factor, "%" | "pp" | "severity"> = {
  equityBeta: "%",
  rates: "pp",
  creditSpread: "pp",
  inflation: "pp",
  usd: "%",
  oil: "%",
  gold: "%",
  cryptoBeta: "%",
  realEstateCap: "pp",
  liquidityStress: "severity",
};

/**
 * ∂(holding value %) / ∂(factor shock unit). Absent key = zero sensitivity.
 *
 * Example — a 7-year-duration Treasury fund: { rates: -7, creditSpread: -0.2 }.
 * A +1pp rate shock moves it -7%. That is a real, measured number (Yahoo's
 * `topHoldings.bondHoldings.duration`), not an assumption.
 */
export type FactorSensitivities = Partial<Record<Factor, number>>;

/**
 * Provenance of a sensitivity, mirroring the asset registry's availability model
 * (lib/assets/types.ts MetricAvailability). We do not guess: a sensitivity is
 * either measured from data, read from a curated table with an `asOf`, or absent.
 */
export type SensitivitySource = "measured" | "reference" | "unavailable";

/* -------------------------------------------------------------------------- */
/* The holding                                                                 */
/* -------------------------------------------------------------------------- */

export type HoldingUnit =
  | "shares"
  | "units"
  | "coins"
  | "contracts"
  /** Bonds: quantity is face value, price is a percentage of par. */
  | "face"
  /** Cash: quantity IS the amount. */
  | "currency"
  /** Private markets: quantity is an ownership fraction. */
  | "stake";

/**
 * What the user actually stored. The persisted shape, before market context is
 * applied. `symbol` is nullable — a house has no ticker, and the current schema's
 * `symbol TEXT PRIMARY KEY` is the reason Portfolio structurally cannot hold one.
 */
export interface RawHolding {
  id: string;
  assetClass: PortfolioAssetClass;
  symbol: string | null;
  name: string;
  currency: string;
  quantity: number;
  unit: HoldingUnit;
  costBasis: number;
  acquiredAt: string;
  /** For manual/derived valuation modes: the user's latest stated value. */
  manualValue: number | null;
  manualValueAsOf: string | null;
  /** Class-specific payload — e.g. the ManualAsset `details` blob. */
  meta: Record<string, unknown>;
}

/** A fully normalized, engine-ready holding. */
export interface Holding {
  id: string;
  assetClass: PortfolioAssetClass;
  symbol: string | null;
  name: string;
  currency: string;
  quantity: number;
  unit: HoldingUnit;

  costBasis: number;
  /** costBasis converted to base currency. */
  costBasisBase: number;
  acquiredAt: string;

  valuation: Valuation;

  /** % of total portfolio value. Assigned by the allocation engine. */
  weight: number;

  unrealizedPL: number | null;
  unrealizedPct: number | null;

  liquidity: Liquidity;
  income: Income | null;
  factors: FactorSensitivities;

  /**
   * Class-native metrics for display and for this class's own scoring. NEVER
   * summed or compared across classes — a bond's duration and an equity's P/E do
   * not live in the same space.
   */
  metrics: Record<string, number | null>;

  /**
   * Cross-cutting attributes the engines DO aggregate on: sector, geography,
   * currency, creditRating, propertyType, …
   */
  attributes: Record<string, string | null>;

  /**
   * This class's own view of the holding's attractiveness. `null` when the class
   * has no honest basis to score it.
   *
   * This is the fix for the current engine's worst habit: a bond or a gold bar
   * gets `composite = 50` because `computeScore()` needs a FundamentalsSnapshot
   * and gets null. That fabricated 50 then flows into target weights, actions and
   * the opportunity ranking as though it had been measured. Unknown must read as
   * unknown — so `score` is nullable and every aggregate over it is
   * confidence-weighted.
   */
  score: HoldingScore | null;

  /** Raw payload retained for the class adapter's own use (e.g. ManualAsset details). */
  meta: Record<string, unknown>;
}

export interface HoldingScore {
  /** 0-100. */
  score: number;
  /**
   * 0-100. How much of the class's scoring inputs were actually available. A
   * score of 70 at confidence 20 must never outrank a 65 at confidence 90 —
   * aggregates shrink toward neutral in proportion to confidence, the same
   * lesson already learned in lib/ios/fit-scorer.ts and lib/screener/ranking.
   */
  confidence: number;
  why: string[];
}

/* -------------------------------------------------------------------------- */
/* Market context                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything the class adapters need from the outside world, resolved ONCE by
 * lib/portfolio/context.ts through the platform data layer. Adapters are pure
 * functions of (RawHolding, MarketContext) — they never fetch.
 */
export interface MarketContext {
  baseCurrency: string;
  /** currency → units of base per 1 unit of that currency. Always contains base→1. */
  fx: Record<string, number>;
  /** symbol → latest quote-ish snapshot. */
  quotes: Map<string, ContextQuote>;
  /** symbol → daily closes, ascending. */
  history: Map<string, number[]>;
  /** symbol → equity/fund fundamentals, where the provider has them. */
  fundamentals: Map<string, ContextFundamentals>;
  /** Benchmark daily returns (SPY), for beta. */
  benchmarkReturns: number[];
  asOf: string;
}

export interface ContextQuote {
  symbol: string;
  price: number;
  changePercent: number | null;
  currency: string | null;
  name: string | null;
  marketCap: number | null;
}

/**
 * The union of provider fields the adapters read. Deliberately flat and all-
 * nullable: every field here is absent for some asset class, and the adapters
 * must handle that rather than assume an equity shape.
 */
export interface ContextFundamentals {
  sector: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  dividendYield: number | null;
  /** Bond funds (Yahoo topHoldings.bondHoldings) — real, not assumed. */
  duration: number | null;
  maturity: number | null;
  creditQuality: string | null;
  expenseRatio: number | null;
  marketCap: number | null;
  peRatio: number | null;
  priceToBook: number | null;
  returnOnEquity: number | null;
  revenueGrowth: number | null;
  operatingMargins: number | null;
  debtToEquity: number | null;
  operatingCashflow: number | null;
  beta: number | null;
}
