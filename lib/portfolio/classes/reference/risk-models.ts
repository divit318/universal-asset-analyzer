/**
 * THE RISK-MODEL CATALOGUE — one place that decides how any instrument responds
 * to a macro shock.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * Every class adapter used to decide its own factor loadings, and three of those
 * decisions were wrong in ways that mattered on a real book:
 *
 *   • VCLT (Vanguard LONG-TERM CORPORATE bond ETF, 8.4% of the portfolio) was
 *     modelled as `{ equityBeta: 0.25 }` — no duration, no credit exposure. Its
 *     ~13-year duration and ~13%-per-percentage-point spread sensitivity, the two
 *     things that actually move it, were absent. It barely reacted to a rate or
 *     credit scenario.
 *   • VXUS (international EQUITY ETF) was modelled as a bond: `rates −4.48,
 *     creditSpread −1.5, inflation −0.8`. It has zero bonds in it.
 *   • Both came from the same line — `if (fundamentals.duration != null) treat as
 *     a bond fund` — a classification inferred from the PRESENCE of one provider
 *     field. Yahoo returns `bondHoldings.duration` for VXUS and for two commodity
 *     futures funds, and omits it for VCLT, VCIT, VTIP, BNDX, BIL and SGOV.
 *
 * A commodity ETF (GLD), a REIT ETF (SCHH), a T-bill fund (BIL) and a money-market
 * fund all had the same failure mode: bought through the normal flow they are
 * stored as `etf` because Yahoo's quoteType is ETF, and the etf adapter modelled
 * them as broad equity — so GLD, held precisely for its crisis behaviour, was
 * stress-tested as a stock. That is the exact class of bug the scenario engine was
 * built to eliminate, reappearing one layer up: not in the SCENARIOS, but in the
 * mapping from instrument to sensitivities.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 *
 * The wrapper is not the risk. What an instrument HOLDS is the risk. So the
 * classification is driven by the fund's Morningstar category (Yahoo's
 * `fundProfile.categoryName`, present for 47/47 funds probed and the only field
 * that cleanly separates a corporate bond fund from a gold trust), corroborated —
 * never led — by the position mix, and never by the presence of a field.
 *
 * ── Provider fields deliberately NOT trusted ─────────────────────────────────
 *
 * Measured beats reference ONLY when the measurement is real. Probed against live
 * data on 2026-07-29, `topHoldings.bondHoldings.duration` is not effective
 * duration and cannot be used for rate risk:
 *
 *     TLT   3.55   (true effective duration ≈ 16)
 *     IEF   4.19   vs SHY 3.05 — a 7-10y fund barely separable from a 1-3y fund
 *     USFR  3.88   a FLOATING-RATE fund whose rate duration is ≈ 0.02
 *     FLOT  4.43   likewise
 *     TIP   1.30   (true ≈ 6.5)
 *     VCLT  absent (true ≈ 13)
 *     VXUS  4.48   an equity fund
 *
 * `bondHoldings.maturity` is equally unusable (USFR 10.0y, TLT 7.98y).
 * `bondRatings` buckets overlap and do not partition (BND sums to ~152%, VCLT
 * carries a negative bucket, and pure equity ETFs return a ratings object at all).
 * `quoteType.legalType`, `summaryDetail.category` and `morningStarRiskRating` were
 * null for all 61 symbols probed. `sectorWeightings` is degenerate for non-equity
 * funds (HYG → "utilities 99.6%", from a 0.84% cash-sweep holding), so it is only
 * read when the fund is actually majority equity.
 *
 * Duration therefore comes from, in order:
 *   1. An EMPIRICAL measurement — the fund's own price history regressed on
 *      changes in the 10-year Treasury yield (see measuredDuration() in
 *      ../market-base.ts). This is a real measurement of the real instrument.
 *      Accepted only when the regression actually fits AND the answer is
 *      plausible for the model (`durationBand`).
 *   2. This file's curated `referenceDuration` for the category.
 *   3. The provider's field, clamped — last resort, for a fund with no history
 *      and no recognised category.
 *
 * ⚠️ REVIEW CADENCE: same as ./factor-sensitivities.ts. Category names track
 * Morningstar and change slowly; reference durations drift with the underlying
 * indices and should be reviewed annually against the funds named in each entry.
 *
 * This module is PURE (no I/O, no server-only imports) because client components
 * import the class registry.
 */

import { BOND_CATEGORIES } from "../../../assets/bond";
import type { Factor, FactorSensitivities, PortfolioAssetClass } from "../../model/types";
import {
  CLASS_FACTORS,
  COMMODITY_FACTORS,
  SECTOR_FACTORS,
  commodityBucket,
  mergeFactors,
} from "./factor-sensitivities";

export const RISK_MODELS_AS_OF = "2026-07-29";

/* -------------------------------------------------------------------------- */
/* Model identity                                                              */
/* -------------------------------------------------------------------------- */

export type RiskModelKind = "equity" | "bond" | "commodity" | "crypto" | "fx" | "cash" | "manual";

export type RiskModelId =
  /* Equity — single names and equity funds */
  | "equity_us"
  | "equity_developed_ex_us"
  | "equity_em"
  | "equity_gold_miner"
  | "fund_equity_us_broad"
  | "fund_equity_developed_ex_us"
  | "fund_equity_global"
  | "fund_equity_em"
  | "fund_equity_sector"
  | "fund_equity_precious_metals"
  | "reit"
  /* Fixed income */
  | "bond_treasury_short"
  | "bond_treasury_intermediate"
  | "bond_treasury_long"
  | "bond_aggregate"
  | "bond_corporate_short"
  | "bond_corporate_ig"
  | "bond_corporate_long"
  | "bond_high_yield"
  | "bond_bank_loan"
  | "bond_floating_rate"
  | "bond_muni_short"
  | "bond_muni"
  | "bond_muni_long"
  | "bond_muni_high_yield"
  | "bond_tips_short"
  | "bond_tips"
  | "bond_em"
  | "bond_global_hedged"
  | "bond_global_unhedged"
  | "bond_preferred"
  | "bond_convertible"
  | "cash_equivalent"
  /* Commodities — one per complex, because gold and crude are opposites */
  | "commodity_gold"
  | "commodity_silver"
  | "commodity_oil"
  | "commodity_natural_gas"
  | "commodity_copper"
  | "commodity_agriculture"
  | "commodity_broad"
  /* Crypto */
  | "crypto_major"
  | "crypto_alt"
  | "crypto_stablecoin"
  /* Currency and cash */
  | "fx_long_base"
  | "fx_short_base"
  | "fx_cross"
  | "cash_base"
  | "cash_foreign"
  /* Manually-valued */
  | "real_estate_direct"
  | "private_equity"
  | "collectible"
  | "collectible_luxury"
  | "structured_note";

export interface RiskModelDef {
  id: RiskModelId;
  label: string;
  kind: RiskModelKind;

  /**
   * THE asset class this instrument belongs to — the one the whole Portfolio
   * subsystem aggregates, targets and reports on.
   *
   * This field is what makes the classification single-sourced. Before it, the
   * risk engine classified VCLT from what the fund holds (a long corporate bond
   * fund) while Allocation, Health and the optimizer classified it from the
   * `asset_class` column, which stores Yahoo's quoteType (`etf`) — so the same
   * holding was a bond in one engine and an ETF in another, and the optimizer
   * emitted "SELL VCLT, ETFs overweight" alongside "BUY SHY / TIP / IEF, Bonds
   * underweight". Declaring the class HERE, next to the factor loadings derived
   * from the same evidence, makes that state unrepresentable.
   *
   * It is REQUIRED, so `RISK_MODELS` cannot gain a model without one, and the
   * mapping is exhaustive by construction rather than by review.
   *
   * Note `cash_equivalent` → `bond`, not `cash`: a T-bill ETF or money-market
   * fund is a FUND with a share price, and the cash adapter's contract is
   * "quantity IS the amount". Bucketing it as cash would value 100 shares of BIL
   * at $100. It is cash-LIKE in its factor loadings, which is where that belongs.
   */
  assetClass: PortfolioAssetClass;

  /* ---- Bond-like inputs ---- */
  /** Curated effective duration, years. The fallback when nothing is measurable. */
  referenceDuration?: number;
  /** A measured duration outside this band is rejected as implausible for this model. */
  durationBand?: [number, number];
  /**
   * creditSpread loading = −duration × this.
   *
   * TWO EFFECTS, MULTIPLIED. The loading has to scale with SPREAD DURATION, which
   * for a cash bond is its effective duration — a 13-year corporate fund reprices
   * four times as much as a 3-year one for the same widening, and a single flat
   * number per rating bucket (what this replaces) could not express that. It also
   * has to scale with the segment's BETA TO THE COMMON CREDIT FACTOR, because the
   * scenarios state one `creditSpread` shock for the whole credit complex while
   * segments move by very different amounts: through 2008 investment-grade spreads
   * widened roughly a third as much as high yield.
   *
   * So this multiple is (segment spread beta) and the duration supplies the rest.
   * The values are calibrated so that the 2008 scenario — rates −2pp, spreads
   * +5pp, equities −50% — reproduces what these funds actually did that year:
   *
   *     BND  (D≈6,  m=0.25)  →  +3%    actual +5%
   *     LQD  (D≈8,  m=0.30)  →  −4%    actual −3%
   *     VCLT (D≈13, m=0.30)  →  −9%    actual ≈ −10%
   *     HYG  (D≈3.4,m=0.60)  →  −25%   actual ≈ −26%
   *     TLT  (D≈16, m=−0.15) →  +32%   actual +34%
   *
   * NEGATIVE values mean the instrument GAINS when spreads widen: a Treasury fund
   * rallies in a flight to quality, and it rallies more the longer it is.
   */
  spreadDurationMultiple?: number;
  /** Explicit creditSpread loading, for instruments where it is not duration-driven. */
  creditSpread?: number;
  /**
   * TIPS: price responds to REAL yields. Modelled as rates −D and inflation +D, so
   * any scenario's (Δnominal − Δinflation) produces −D × Δreal automatically — and
   * a scenario that raises inflation faster than rates makes TIPS gain, which is
   * the entire reason to own them.
   */
  realRateLinked?: boolean;
  /** Residual inflation loading for a nominal instrument. */
  inflation?: number;

  /* ---- Equity inputs ---- */
  /** Fallback equity beta when none can be measured. */
  equityBeta?: number;
  /** A measured beta outside this band is rejected as implausible for this model. */
  equityBetaBand?: [number, number];

  /* ---- Shared ---- */
  /** Static loadings merged last: sector, complex, liquidity, crypto. */
  extra?: FactorSensitivities;
  /**
   * How much of a trade-weighted USD move passes through to this holding's value,
   * for a NON-base-currency exposure. See FX_PASS_THROUGH for the reasoning.
   */
  fxPassThrough?: number;
  /** Why this model looks the way it does, and which real funds calibrate it. */
  notes: string;
}

/* -------------------------------------------------------------------------- */
/* Modelling assumptions, stated once                                          */
/* -------------------------------------------------------------------------- */

/**
 * FX pass-through — the `usd` loading a foreign-currency exposure carries.
 *
 * NEW ASSUMPTION (2026-07-29). Before this, an unhedged international fund and a
 * foreign ADR both carried NO dollar loading at all, so a portfolio that was 24%
 * non-US registered zero currency risk in a dollar-rally scenario. That is a
 * missing exposure, not a conservative one.
 *
 * The values are pass-through coefficients against the TRADE-WEIGHTED dollar, not
 * against a single pair, and they are below 1.0 for two compounding reasons: a
 * fund's currency basket is not the dollar index's basket, and a local equity
 * market partially offsets its own currency move (exporters gain when the local
 * currency falls). Cash and a currency pair have no such offset, so they are 1.0.
 *
 *   deposit / currency pair   1.00   mechanical, no offset
 *   developed-market equity   0.85   funds (VXUS, VEA, EFA)
 *   foreign single name/ADR   0.70   partial local offset, single currency
 *   emerging-market equity    0.60   managed floats and partial USD pegs
 *   global (US + ex-US) fund  0.45   roughly the ex-US share of a world index
 *   USD-hedged fund           0.00   the hedge is the product
 */
export const FX_PASS_THROUGH = {
  cash: 1.0,
  developedEquityFund: 0.85,
  foreignSingleName: 0.7,
  emergingEquity: 0.6,
  globalEquityFund: 0.45,
  hedged: 0,
} as const;

/**
 * Liquidity-stress loadings on fixed income.
 *
 * Deliberately small next to the credit loading, because a scenario shocks
 * `creditSpread` and `liquidityStress` together and the two would otherwise
 * double-count the same sell-off. What this captures is only the part spread
 * widening does not: Treasuries being BOUGHT in a scramble for collateral, and
 * the bid disappearing in high yield and EM regardless of where spreads print.
 */
const LIQ = {
  treasury: 0.2,
  aggregate: 0.05,
  investmentGrade: -0.3,
  highYield: -0.8,
  emerging: -0.9,
  muni: -0.4,
  cashLike: 0.1,
} as const;

/* -------------------------------------------------------------------------- */
/* The catalogue                                                               */
/* -------------------------------------------------------------------------- */

export const RISK_MODELS: Record<RiskModelId, RiskModelDef> = {
  /* ---------------------------------------------------------------- equity -- */
  equity_us: {
    id: "equity_us", label: "US equity", kind: "equity", assetClass: "equity",
    equityBeta: 1.0, equityBetaBand: [-1, 4],
    notes: "Measured beta vs SPY plus its GICS sector's own rate/oil/inflation loadings.",
  },
  equity_developed_ex_us: {
    id: "equity_developed_ex_us", label: "Developed ex-US equity", kind: "equity", assetClass: "equity",
    equityBeta: 1.0, equityBetaBand: [-1, 4], fxPassThrough: FX_PASS_THROUGH.foreignSingleName,
    notes: "A foreign listing or ADR: local equity risk plus unhedged currency risk (TM, KB).",
  },
  equity_em: {
    id: "equity_em", label: "Emerging-market equity", kind: "equity", assetClass: "equity",
    equityBeta: 1.1, equityBetaBand: [-1, 4], fxPassThrough: FX_PASS_THROUGH.emergingEquity,
    notes: "Higher default beta and a smaller FX pass-through than developed (managed floats).",
  },
  equity_gold_miner: {
    id: "equity_gold_miner", label: "Gold miner", kind: "equity", assetClass: "equity",
    equityBeta: 1.1, equityBetaBand: [-1, 4], extra: { gold: 1.2 },
    notes: "Operationally levered to the gold price: a miner's margin moves faster than bullion (NEM, ORLA).",
  },
  fund_equity_us_broad: {
    id: "fund_equity_us_broad", label: "US broad equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 1.0, equityBetaBand: [0, 3],
    notes: "VOO/VTI/SPY/QQQ/SCHD. Beta is the whole model; no sector tilt is asserted.",
  },
  fund_equity_developed_ex_us: {
    id: "fund_equity_developed_ex_us", label: "Developed ex-US equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 0.95, equityBetaBand: [0, 3], fxPassThrough: FX_PASS_THROUGH.developedEquityFund,
    notes: "VXUS/VEA/EFA. Unhedged currency exposure is the point of the fund and is modelled.",
  },
  fund_equity_global: {
    id: "fund_equity_global", label: "Global equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 1.0, equityBetaBand: [0, 3], fxPassThrough: FX_PASS_THROUGH.globalEquityFund,
    notes: "World/global stock: roughly 45% of the basket is non-USD.",
  },
  fund_equity_em: {
    id: "fund_equity_em", label: "Emerging-market equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 1.05, equityBetaBand: [0, 3], fxPassThrough: FX_PASS_THROUGH.emergingEquity,
    notes: "VWO/EEM/China/India/LatAm.",
  },
  fund_equity_sector: {
    id: "fund_equity_sector", label: "Sector equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 1.0, equityBetaBand: [0, 3],
    notes: "XLE/XLK/XLF/XLU. The sector's SECTOR_FACTORS loadings are applied on top of beta — an energy fund is exposed to oil, a utility fund to rates, and neither was before.",
  },
  fund_equity_precious_metals: {
    id: "fund_equity_precious_metals", label: "Precious-metals equity fund", kind: "equity", assetClass: "etf",
    equityBeta: 1.1, equityBetaBand: [0, 3], extra: { gold: 1.2 },
    notes: "Morningstar \"Equity Precious Metals\" is MINERS, not bullion — equity beta plus levered gold, not a gold trust.",
  },
  reit: {
    id: "reit", label: "Real-estate equity", kind: "equity", assetClass: "reit",
    equityBeta: 0.9, equityBetaBand: [-1, 3],
    extra: { rates: -2.8, realEstateCap: -8.0, inflation: 0.3 },
    notes: "REITs and REIT funds (O, VNQ, SCHH): a rate instrument in an equity wrapper.",
  },

  /* ----------------------------------------------------------- fixed income -- */
  bond_treasury_short: {
    id: "bond_treasury_short", label: "Short Treasury fund", kind: "bond", assetClass: "bond",
    referenceDuration: 1.9, durationBand: [0.1, 4], spreadDurationMultiple: -0.15,
    inflation: -0.9, equityBeta: 0, equityBetaBand: [-0.4, 0.5],
    extra: { liquidityStress: LIQ.treasury },
    notes: "SHY. Gains modestly in a flight to quality; almost no rate risk.",
  },
  bond_treasury_intermediate: {
    id: "bond_treasury_intermediate", label: "Intermediate Treasury fund", kind: "bond", assetClass: "bond",
    referenceDuration: 5.5, durationBand: [2, 9], spreadDurationMultiple: -0.15,
    inflation: -0.8, equityBeta: 0, equityBetaBand: [-0.6, 0.6],
    extra: { liquidityStress: LIQ.treasury },
    notes: "GOVT. Yahoo cannot distinguish this from a 20-year fund, so the measured duration matters most here.",
  },
  bond_treasury_long: {
    id: "bond_treasury_long", label: "Long Treasury fund", kind: "bond", assetClass: "bond",
    referenceDuration: 11, durationBand: [3, 25], spreadDurationMultiple: -0.15,
    inflation: -0.8, equityBeta: 0, equityBetaBand: [-0.8, 0.8],
    extra: { liquidityStress: LIQ.treasury },
    notes: "Yahoo files both IEF (7-10y, D≈7) and TLT (20y+, D≈16) as \"Long Government\"; the empirical duration separates them. The band is wide for exactly that reason.",
  },
  bond_aggregate: {
    id: "bond_aggregate", label: "Core / aggregate bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 6.0, durationBand: [2, 10], spreadDurationMultiple: 0.25,
    inflation: -0.8, equityBeta: 0.1, equityBetaBand: [-0.4, 0.8],
    extra: { liquidityStress: LIQ.aggregate },
    notes: "BND/AGG: ~65% government, ~25% IG credit. Net spread exposure is small and slightly negative.",
  },
  bond_corporate_short: {
    id: "bond_corporate_short", label: "Short-term bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 2.6, durationBand: [0.5, 5], spreadDurationMultiple: 0.3,
    inflation: -0.9, equityBeta: 0.1, equityBetaBand: [-0.4, 0.8],
    extra: { liquidityStress: LIQ.investmentGrade },
    notes: "Short IG credit (1-5y corporates): enough duration to matter, little enough that spread widening dominates its drawdowns.",
  },
  bond_corporate_ig: {
    id: "bond_corporate_ig", label: "Investment-grade corporate fund", kind: "bond", assetClass: "bond",
    referenceDuration: 7.5, durationBand: [2, 12], spreadDurationMultiple: 0.3,
    inflation: -0.8, equityBeta: 0.25, equityBetaBand: [-0.4, 1.0],
    extra: { liquidityStress: LIQ.investmentGrade },
    notes: "LQD/VCIT. Spread duration ≈ effective duration, so a 1pp widening costs ≈ duration percent.",
  },
  bond_corporate_long: {
    id: "bond_corporate_long", label: "Long-dated corporate fund", kind: "bond", assetClass: "bond",
    referenceDuration: 13, durationBand: [7, 20], spreadDurationMultiple: 0.3,
    inflation: -0.8, equityBeta: 0.3, equityBetaBand: [-0.4, 1.2],
    extra: { liquidityStress: LIQ.investmentGrade },
    notes: "VCLT — Morningstar \"Long-Term Bond\". Duration ≈ 13 and spread beta ≈ −13, both absent from the model this replaces.",
  },
  bond_high_yield: {
    id: "bond_high_yield", label: "High-yield bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 3.4, durationBand: [1, 7], spreadDurationMultiple: 0.6,
    inflation: -0.6, equityBeta: 0.45, equityBetaBand: [0, 1.2],
    extra: { liquidityStress: LIQ.highYield },
    notes: "HYG/JNK/SPHY. Genuine equity beta and the harshest liquidity loading in fixed income; rate duration is secondary.",
  },
  bond_bank_loan: {
    id: "bond_bank_loan", label: "Bank-loan fund", kind: "bond", assetClass: "bond",
    referenceDuration: 0.3, durationBand: [0, 1.5], creditSpread: -3.0,
    inflation: -0.4, equityBeta: 0.35, equityBetaBand: [0, 1.0],
    extra: { liquidityStress: LIQ.highYield },
    notes: "Floating coupon → almost no rate duration, but full sub-IG credit and severe liquidity risk.",
  },
  bond_floating_rate: {
    id: "bond_floating_rate", label: "Floating-rate note fund", kind: "bond", assetClass: "bond",
    referenceDuration: 0.1, durationBand: [0, 1], creditSpread: -1.8,
    inflation: -0.9, equityBeta: 0.05, equityBetaBand: [-0.3, 0.5],
    extra: { liquidityStress: LIQ.investmentGrade },
    notes: "USFR (Treasury FRNs) and FLOT (IG corporate FRNs). Yahoo reports duration 3.88 and 4.43 for these; the real rate duration is ~0.02, which is the clearest case for distrusting that field.",
  },
  bond_muni_short: {
    id: "bond_muni_short", label: "Short municipal fund", kind: "bond", assetClass: "bond",
    referenceDuration: 2.3, durationBand: [0.5, 4], spreadDurationMultiple: 0.2,
    inflation: -0.9, equityBeta: 0.05, equityBetaBand: [-0.3, 0.5],
    extra: { liquidityStress: LIQ.muni },
    notes: "Municipal credit widens less than corporate in a typical risk-off, but the market is thinner.",
  },
  bond_muni: {
    id: "bond_muni", label: "Municipal bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 4.8, durationBand: [1.5, 8], spreadDurationMultiple: 0.2,
    inflation: -0.8, equityBeta: 0.05, equityBetaBand: [-0.3, 0.6],
    extra: { liquidityStress: LIQ.muni },
    notes: "MUB. Tax-exempt credit widens less than corporate in a typical risk-off, but the market is thinner — hence the small spread multiple and the larger liquidity loading.",
  },
  bond_muni_long: {
    id: "bond_muni_long", label: "Long municipal fund", kind: "bond", assetClass: "bond",
    referenceDuration: 6.5, durationBand: [3, 12], spreadDurationMultiple: 0.2,
    inflation: -0.8, equityBeta: 0.05, equityBetaBand: [-0.3, 0.6],
    extra: { liquidityStress: LIQ.muni },
    notes: "TFI. Same credit profile as MUB with materially more duration, which is the whole difference between the two.",
  },
  bond_muni_high_yield: {
    id: "bond_muni_high_yield", label: "High-yield municipal fund", kind: "bond", assetClass: "bond",
    referenceDuration: 7.0, durationBand: [2, 12], spreadDurationMultiple: 0.5,
    inflation: -0.7, equityBeta: 0.25, equityBetaBand: [0, 1.0],
    extra: { liquidityStress: LIQ.highYield },
    notes: "Long duration AND sub-IG credit in an illiquid market.",
  },
  bond_tips_short: {
    id: "bond_tips_short", label: "Short inflation-protected fund", kind: "bond", assetClass: "bond",
    referenceDuration: 2.5, durationBand: [0.5, 5], spreadDurationMultiple: 0.05,
    realRateLinked: true, equityBeta: 0.05, equityBetaBand: [-0.3, 0.6],
    extra: { liquidityStress: LIQ.treasury },
    notes: "VTIP. Real-rate exposure: an inflation surprise is a GAIN, not a loss.",
  },
  bond_tips: {
    id: "bond_tips", label: "Inflation-protected bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 6.5, durationBand: [2, 10], spreadDurationMultiple: 0.05,
    realRateLinked: true, equityBeta: 0.1, equityBetaBand: [-0.4, 0.8],
    extra: { liquidityStress: LIQ.treasury },
    notes: "TIP. The old model gave it inflation −0.8 — the wrong SIGN on the one bond held for inflation.",
  },
  bond_em: {
    id: "bond_em", label: "Emerging-market bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 6.5, durationBand: [2, 12], spreadDurationMultiple: 0.55,
    inflation: -0.6, equityBeta: 0.5, equityBetaBand: [0, 1.3],
    extra: { liquidityStress: LIQ.emerging },
    notes: "EMB (USD-denominated, so no FX pass-through; a local-currency EM fund would need one).",
  },
  bond_global_hedged: {
    id: "bond_global_hedged", label: "Global bond fund (USD-hedged)", kind: "bond", assetClass: "bond",
    referenceDuration: 7.0, durationBand: [2, 12], spreadDurationMultiple: 0.25,
    inflation: -0.8, equityBeta: 0.1, equityBetaBand: [-0.4, 0.8],
    fxPassThrough: FX_PASS_THROUGH.hedged, extra: { liquidityStress: LIQ.aggregate },
    notes: "BNDX. The hedge is the product, so no currency loading — but its duration is foreign, which this model cannot separate from US duration.",
  },
  bond_global_unhedged: {
    id: "bond_global_unhedged", label: "Global bond fund (unhedged)", kind: "bond", assetClass: "bond",
    referenceDuration: 7.0, durationBand: [2, 12], spreadDurationMultiple: 0.25,
    inflation: -0.8, equityBeta: 0.1, equityBetaBand: [-0.4, 0.8],
    fxPassThrough: 0.8, extra: { liquidityStress: LIQ.aggregate },
    notes: "Unhedged foreign bonds are mostly a currency position with a bond attached.",
  },
  bond_preferred: {
    id: "bond_preferred", label: "Preferred stock fund", kind: "bond", assetClass: "bond",
    referenceDuration: 5.5, durationBand: [1, 12], spreadDurationMultiple: 0.5,
    inflation: -0.7, equityBeta: 0.5, equityBetaBand: [0, 1.3],
    extra: { liquidityStress: LIQ.highYield },
    notes: "A perpetual subordinated hybrid: long duration, corporate credit, and real equity beta.",
  },
  bond_convertible: {
    id: "bond_convertible", label: "Convertible bond fund", kind: "bond", assetClass: "bond",
    referenceDuration: 2.5, durationBand: [0, 8], spreadDurationMultiple: 0.5,
    inflation: -0.5, equityBeta: 0.7, equityBetaBand: [0, 1.5],
    extra: { liquidityStress: LIQ.highYield },
    notes: "Mostly an equity call option; the bond floor only matters on the way down.",
  },
  cash_equivalent: {
    id: "cash_equivalent", label: "Cash-equivalent fund", kind: "bond", assetClass: "bond",
    referenceDuration: 0.08, durationBand: [0, 0.6], creditSpread: 0,
    inflation: -1.0, equityBeta: 0, equityBetaBand: [-0.2, 0.3],
    extra: { liquidityStress: LIQ.cashLike },
    notes: "BIL/SGOV and every money-market fund. Modelled like cash — nominal value stable, purchasing power not — NOT like a stock, which is what a MONEYMARKET quoteType used to get.",
  },

  /* ------------------------------------------------------------ commodities -- */
  commodity_gold: {
    id: "commodity_gold", label: "Gold", kind: "commodity", assetClass: "commodity",
    equityBetaBand: [-0.6, 1.0],
    notes: "GLD/IAU and bullion. Rises in a crisis — the single most important thing a stress test must get right.",
  },
  commodity_silver: {
    id: "commodity_silver", label: "Silver", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "SLV. Half precious metal, half industrial — it neither hedges a crisis as reliably as gold nor tracks growth as closely as copper.",
  },
  commodity_oil: {
    id: "commodity_oil", label: "Crude oil / energy", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "USO. Collapses in a demand shock — the opposite of gold.",
  },
  commodity_natural_gas: {
    id: "commodity_natural_gas", label: "Natural gas", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "UNG. Priced off its own complex; a weather and storage market that is only loosely related to crude.",
  },
  commodity_copper: {
    id: "commodity_copper", label: "Copper / industrial metals", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "CPER. The most growth-sensitive commodity — it behaves closer to an industrial equity than to bullion.",
  },
  commodity_agriculture: {
    id: "commodity_agriculture", label: "Agriculture", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "DBA. Driven by weather and food inflation rather than the business cycle, so its equity loading is the lowest of the complexes.",
  },
  commodity_broad: {
    id: "commodity_broad", label: "Broad commodity basket", kind: "commodity", assetClass: "commodity", equityBetaBand: [-0.6, 1.5],
    notes: "DBC/PDBC. Energy-heavy in practice, so a broad basket behaves much more like crude than like the gold it also contains.",
  },

  /* ----------------------------------------------------------------- crypto -- */
  crypto_major: {
    id: "crypto_major", label: "Major crypto asset", kind: "crypto", assetClass: "crypto",
    equityBeta: 0.4, equityBetaBand: [-0.5, 2],
    extra: { cryptoBeta: 1.0, liquidityStress: -0.6 },
    notes: "BTC — the complex's own benchmark, so cryptoBeta is 1.0 by definition.",
  },
  crypto_alt: {
    id: "crypto_alt", label: "Alternative crypto asset", kind: "crypto", assetClass: "crypto",
    equityBeta: 0.5, equityBetaBand: [-0.5, 2.5],
    extra: { cryptoBeta: 1.35, liquidityStress: -0.8 },
    notes: "ETH and smaller tokens fall harder than BTC in a crypto drawdown and lose their bid faster.",
  },
  crypto_stablecoin: {
    id: "crypto_stablecoin", label: "Stablecoin", kind: "crypto", assetClass: "crypto",
    equityBeta: 0, equityBetaBand: [-0.2, 0.3],
    extra: { cryptoBeta: 0.02, liquidityStress: -0.15 },
    notes: "A dollar token is not a 70%-drawdown asset. It carries depeg/liquidity risk, not crypto beta — modelling USDC with cryptoBeta 1.0 was a pure classification error.",
  },

  /* ------------------------------------------------------------ currency/cash -- */
  fx_long_base: {
    id: "fx_long_base", label: "Currency pair — long base currency", kind: "fx", assetClass: "forex",
    notes: "USDCHF=X in a USD book is LONG the dollar. The old flat usd −1.0 had the sign backwards for every pair quoted this way.",
  },
  fx_short_base: {
    id: "fx_short_base", label: "Currency pair — short base currency", kind: "fx", assetClass: "forex",
    notes: "EURUSD=X in a USD book is long EUR and short the dollar: the one case the old flat usd −1.0 got right.",
  },
  fx_cross: {
    id: "fx_cross", label: "Currency cross", kind: "fx", assetClass: "forex",
    extra: { equityBeta: 0.25, liquidityStress: -0.2 },
    notes: "Neither leg is the base currency (EURJPY=X), so NO dollar loading is asserted — the sign would depend on which two currencies. What is asserted is a modest risk-on loading: a cross is a carry position, and the funding leg (JPY, CHF) appreciates when risk assets fall. Claiming a cross is immune to everything would be worse — the scenario coverage line would then report it as 'genuinely unaffected'.",
  },
  cash_base: {
    id: "cash_base", label: "Base-currency cash", kind: "cash", assetClass: "cash",
    inflation: -1.0, extra: { liquidityStress: LIQ.cashLike },
    notes: "Nominal value stable, purchasing power not: a +1pp inflation surprise is a ~1% real loss, and modelling cash as all-zeros is how a tool ends up recommending it as a free lunch.",
  },
  cash_foreign: {
    id: "cash_foreign", label: "Foreign-currency cash", kind: "cash", assetClass: "cash",
    inflation: -1.0, extra: { liquidityStress: LIQ.cashLike }, fxPassThrough: FX_PASS_THROUGH.cash,
    notes: "A CHF deposit in a USD book is a currency position. It used to be modelled as immune to FX.",
  },

  /* ------------------------------------------------------------------ manual -- */
  real_estate_direct: {
    id: "real_estate_direct", label: "Direct property", kind: "manual", assetClass: "real_estate",
    extra: CLASS_FACTORS.real_estate,
    notes: "Cap-rate exposure, multiplied by the mortgage leverage the real-estate adapter measures. A 75%-LTV property has ~4× the cap-rate sensitivity of an unlevered one.",
  },
  private_equity: {
    id: "private_equity", label: "Private company stake", kind: "manual", assetClass: "private_market",
    extra: CLASS_FACTORS.private_market,
    notes: "Levered equity with smoothed marks — beta above 1 in truth, and no bid at all in a liquidity event.",
  },
  collectible: {
    id: "collectible", label: "Collectible / alternative", kind: "manual", assetClass: "alternative",
    extra: CLASS_FACTORS.alternative,
    notes: "Discretionary-spending sensitive, inflation-linked, no market on demand.",
  },
  collectible_luxury: {
    id: "collectible_luxury", label: "Luxury collectible", kind: "manual", assetClass: "alternative",
    extra: { equityBeta: 0.45, inflation: 0.6, liquidityStress: -0.7 },
    notes: "Watches, art, classic cars: the bid is wealth-effect driven, so it tracks equities more closely than a generic alternative and disappears faster in a liquidity squeeze. Physical bullion recorded as an alternative is routed to the gold complex instead.",
  },
  structured_note: {
    id: "structured_note", label: "Structured note", kind: "manual", assetClass: "structured_product",
    notes: "Barrier-conditional equity beta plus issuer credit; computed by the structured-product adapter.",
  },
};

/* -------------------------------------------------------------------------- */
/* Category → model                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo's `fundProfile.categoryName` (Morningstar) → risk model.
 *
 * Ordered keyword rules rather than exact matches, because Morningstar has
 * hundreds of category strings and they are stable in their KEYWORDS ("Long-Term
 * Bond", "Muni National Interm", "Diversified Emerging Mkts") rather than in their
 * exact spelling. First match wins, so the specific rules come before the general
 * ones — "High Yield Muni" must be tested before "muni", and "Equity Precious
 * Metals" (miners) before "precious metals" (bullion).
 *
 * The strings in each comment are categories actually observed from the provider.
 */
const CATEGORY_RULES: { test: RegExp; model: RiskModelId }[] = [
  /* --- cash-like --------------------------------------------------------- */
  { test: /money market/, model: "cash_equivalent" },

  /* --- inflation-protected (before the generic government/short rules) --- */
  { test: /short.*(inflation|infl-protected|protected)/, model: "bond_tips_short" },
  { test: /inflation-protected|inflation protected|tips/, model: "bond_tips" },

  /* --- municipal (specific before generic) ------------------------------ */
  { test: /high yield muni|muni.*high yield/, model: "bond_muni_high_yield" },
  { test: /muni.*(short|ultrashort)/, model: "bond_muni_short" },
  { test: /muni.*long/, model: "bond_muni_long" },
  { test: /\bmuni/, model: "bond_muni" },

  /* --- government ------------------------------------------------------- */
  { test: /short government/, model: "bond_treasury_short" },
  { test: /intermediate government/, model: "bond_treasury_intermediate" },
  { test: /long government/, model: "bond_treasury_long" },

  /* --- credit ----------------------------------------------------------- */
  { test: /high yield bond|high-yield bond/, model: "bond_high_yield" },
  { test: /bank loan/, model: "bond_bank_loan" },
  { test: /preferred/, model: "bond_preferred" },
  { test: /convertible/, model: "bond_convertible" },
  { test: /emerging markets bond|emerging-markets bond|emerging markets local/, model: "bond_em" },
  { test: /(global|world) bond.*(usd )?hedged/, model: "bond_global_hedged" },
  { test: /(global|world) bond/, model: "bond_global_unhedged" },
  { test: /long-term bond|long term bond/, model: "bond_corporate_long" },
  { test: /corporate bond/, model: "bond_corporate_ig" },
  { test: /intermediate core|core-plus|core bond|multisector|nontraditional/, model: "bond_aggregate" },
  { test: /ultrashort/, model: "cash_equivalent" },
  { test: /short-term bond|short term bond/, model: "bond_corporate_short" },

  /* --- commodities (bullion/futures) before sector equity --------------- */
  { test: /commodit/, model: "commodity_broad" },       // refined by complex below
  { test: /equity precious metals/, model: "fund_equity_precious_metals" },
  { test: /precious metals/, model: "commodity_gold" },
  { test: /digital assets|bitcoin|cryptocurrenc/, model: "crypto_major" },

  /* --- real estate ------------------------------------------------------ */
  { test: /real estate/, model: "reit" },

  /* --- sector equity ---------------------------------------------------- */
  {
    test: /equity energy|natural resources|technology|health|financial|utilities|industrial|consumer cyclical|consumer defensive|communication|infrastructure|miscellaneous sector/,
    model: "fund_equity_sector",
  },

  /* --- regional equity -------------------------------------------------- */
  { test: /emerging|china|india|latin america|frontier/, model: "fund_equity_em" },
  { test: /foreign|international|europe|japan|pacific|\bex-us\b|ex us/, model: "fund_equity_developed_ex_us" },
  { test: /world|global/, model: "fund_equity_global" },

  /* --- US broad equity (the residual for an equity fund) ---------------- */
  {
    test: /large|mid-cap|small|blend|growth|value|dividend|total (stock )?market|equity income|derivative income/,
    model: "fund_equity_us_broad",
  },
];

/** Morningstar sector categories → the SECTOR_FACTORS key they correspond to. */
const CATEGORY_SECTOR: { test: RegExp; sector: keyof typeof SECTOR_FACTORS }[] = [
  { test: /equity energy|natural resources/, sector: "Energy" },
  { test: /technology/, sector: "Technology" },
  { test: /health/, sector: "Healthcare" },
  { test: /financial/, sector: "Financials" },
  { test: /utilities/, sector: "Utilities" },
  { test: /industrial|infrastructure/, sector: "Industrials" },
  { test: /communication/, sector: "Communication Services" },
  { test: /consumer cyclical/, sector: "Consumer Discretionary" },
  { test: /consumer defensive/, sector: "Consumer Staples" },
];

/** The fund's own top-holdings sector label → SECTOR_FACTORS key. */
const TOP_SECTOR_ALIAS: Record<string, keyof typeof SECTOR_FACTORS> = {
  "Technology": "Technology",
  "Healthcare": "Healthcare",
  "Financial Services": "Financials",
  "Energy": "Energy",
  "Utilities": "Utilities",
  "Industrials": "Industrials",
  "Basic Materials": "Materials",
  "Communication Services": "Communication Services",
  "Consumer Cyclical": "Consumer Discretionary",
  "Consumer Defensive": "Consumer Staples",
  "Real Estate": "Real Estate",
};

const BOND_CATEGORY_SET = new Set<string>(BOND_CATEGORIES.map((c) => c.toLowerCase()));

/** Is this Morningstar category one the screener already treats as fixed income? */
export function isBondCategory(category: string | null): boolean {
  if (!category) return false;
  return BOND_CATEGORY_SET.has(category.trim().toLowerCase());
}

/**
 * Stablecoins. A dollar token has none of crypto's factor exposure, and there is
 * no provider field that says "this is a stablecoin" — the ticker is the signal.
 */
const STABLECOINS = /^(USDT|USDC|DAI|BUSD|TUSD|USDP|FDUSD|PYUSD|USDD|GUSD|LUSD|USDE)(-USD)?$/i;
/** The crypto asset the `cryptoBeta` factor is defined against. */
const CRYPTO_BENCHMARK = /^(BTC|WBTC|XBT)(-USD)?$/i;

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Everything the classifier is allowed to look at. Assembled by the class
 * adapters from MarketContext; nothing here is fetched.
 */
export interface InstrumentSignals {
  symbol: string | null;
  name: string;
  /** The stored class. A hint, never the last word — a bond ETF is stored as `etf`. */
  assetClass: PortfolioAssetClass;
  /** Yahoo quoteType: EQUITY / ETF / MUTUALFUND / MONEYMARKET / CRYPTOCURRENCY / CURRENCY. */
  quoteAssetType?: string | null;
  /** Morningstar `fundProfile.categoryName` — the primary signal for any fund. */
  fundCategory?: string | null;
  /**
   * Dominant credit-rating bucket ("us_government", "bbb", "bb", …). Corroborating
   * evidence for which credit segment a bond fund is in, when no category exists.
   */
  creditQuality?: string | null;
  /** Position mix, in percent. Corroborating evidence only. */
  bondWeight?: number | null;
  equityWeight?: number | null;
  cashWeight?: number | null;
  otherWeight?: number | null;
  /** Dominant sector of the fund's holdings, and its weight. Only read when the fund is majority equity. */
  topSector?: string | null;
  topSectorWeight?: number | null;
  /** GICS-ish sector of a single company. */
  sector?: string | null;
  /** Industry of a single company — the field that identifies a gold miner ("Gold"). */
  industry?: string | null;
  /** Manual-asset subcategory ("Watches", "Precious Metals", …), from the details blob. */
  subcategory?: string | null;
  /** Country of domicile of a single company (assetProfile.country). */
  country?: string | null;
  /** The holding's own currency, and the portfolio's. */
  currency?: string | null;
  baseCurrency?: string | null;
}

/**
 * How strong the evidence for the chosen model is. This is NOT decoration: it
 * decides whether a measurement may override the model's reference.
 *
 *   "declared"    — the instrument type or the Morningstar category said so.
 *   "corroborated"— inferred from the position mix or the dominant rating bucket.
 *   "fallback"    — nothing but the stored asset class was available.
 *
 * A narrow plausibility band only makes sense against a CONFIRMED category. On the
 * fallback path the model is a bucket average, so a measurement is the better
 * evidence and must not be rejected for disagreeing with the bucket: a 1-3 year
 * Treasury fund whose category lookup failed measured 1.65 years and was being
 * overridden by the generic 6.0-year reference — the same holding rendering two
 * different durations depending on whether one provider call succeeded.
 */
export type ModelConfidence = "declared" | "corroborated" | "fallback";

export interface RiskModelResolution {
  model: RiskModelDef;
  confidence: ModelConfidence;
  /** Sector whose SECTOR_FACTORS apply, when the model is a sector-exposed equity. */
  sector: keyof typeof SECTOR_FACTORS | null;
  /** Commodity complex, when the model is a commodity. */
  complex: keyof typeof COMMODITY_FACTORS | null;
  /** Whether this holding carries non-base-currency exposure. */
  foreignCurrency: boolean;
  /** Human-readable trail of WHY this model was chosen. Order = order of reasoning. */
  evidence: string[];
}

/** Physically possible duration for any cash bond. The gate on the fallback path. */
const PHYSICAL_DURATION_BAND: [number, number] = [0.02, 30];
/** Physically possible equity beta for any real instrument. */
const PHYSICAL_BETA_BAND: [number, number] = [-1.5, 4];

/** Countries whose equity markets are modelled as emerging rather than developed. */
const EMERGING_COUNTRIES = new Set([
  "china", "taiwan", "south korea", "korea", "india", "brazil", "mexico", "chile",
  "colombia", "peru", "argentina", "south africa", "turkey", "indonesia", "thailand",
  "malaysia", "philippines", "vietnam", "poland", "hungary", "czech republic", "greece",
  "egypt", "nigeria", "kenya", "saudi arabia", "united arab emirates", "qatar", "kuwait",
  "russia", "pakistan", "bangladesh", "sri lanka",
]);

const DEVELOPED_NON_US = new Set([
  "japan", "united kingdom", "germany", "france", "canada", "australia", "switzerland",
  "netherlands", "sweden", "norway", "denmark", "finland", "spain", "italy", "belgium",
  "austria", "ireland", "portugal", "israel", "singapore", "hong kong", "new zealand",
  "luxembourg", "iceland",
]);

function equityModelForCountry(country: string | null | undefined): {
  id: RiskModelId;
  why: string;
} {
  const c = (country ?? "").trim().toLowerCase();
  if (!c || c === "united states" || c === "usa" || c === "us") {
    return { id: "equity_us", why: c ? `Domiciled in ${country} → US equity risk` : "No domicile reported → US equity risk assumed" };
  }
  if (EMERGING_COUNTRIES.has(c)) {
    return { id: "equity_em", why: `Domiciled in ${country} → emerging-market equity, with FX pass-through` };
  }
  if (DEVELOPED_NON_US.has(c)) {
    return { id: "equity_developed_ex_us", why: `Domiciled in ${country} → developed ex-US equity, with FX pass-through` };
  }
  return { id: "equity_developed_ex_us", why: `Domiciled in ${country} (not a recognised market) → developed ex-US equity` };
}

/**
 * A gold/silver miner is an equity, but a levered bet on the metal.
 *
 * The INDUSTRY field is the signal that works: Yahoo reports industry "Gold" for
 * both NEM and ORLA, while the company NAME only gives it away for one of them
 * ("Orla Mining Ltd." matches a keyword, "Newmont Corporation" does not). Keying on
 * the name alone would have modelled the world's largest gold miner as a generic
 * materials stock with no bullion exposure at all.
 */
function isPreciousMetalMiner(signals: InstrumentSignals): boolean {
  const industry = (signals.industry ?? "").toLowerCase();
  if (/gold|silver|precious metal/.test(industry)) return true;

  const sector = signals.sector ?? "";
  if (sector !== "Materials" && sector !== "Basic Materials") return false;
  return /GOLD|SILVER|MINING|MINES|BULLION/.test(`${signals.symbol ?? ""} ${signals.name}`.toUpperCase());
}

/**
 * Dominant credit-rating bucket → bond model. Used only when no category is
 * available, and only to place the fund in the right CREDIT SEGMENT; the duration
 * still comes from the measurement or the model's reference.
 *
 * Yahoo's rating buckets overlap and do not sum to 100 (BND sums to ~152%, and pure
 * equity ETFs return a ratings object at all), so this is corroboration, never a
 * primary signal. `dominantRating()` in lib/portfolio/context.ts already applies the
 * one rule that matters: a fund that is majority `us_government` IS a Treasury fund
 * whatever its letter buckets say.
 */
function bondModelForRating(quality: string | null | undefined): RiskModelId | null {
  const q = (quality ?? "").trim().toLowerCase();
  if (!q) return null;
  if (q === "us_government" || q === "aaa") return "bond_treasury_intermediate";
  if (q === "aa" || q === "a" || q === "bbb") return "bond_corporate_ig";
  if (q === "bb" || q === "b" || q === "below_b") return "bond_high_yield";
  return null;
}

/**
 * Parse a Yahoo FX ticker into its two legs. Returns null when the symbol is not a
 * currency pair.
 *
 * Yahoo publishes TWO representations of the same instrument, and both must
 * normalize to one canonical `{ base, quote }` so everything downstream — model,
 * factor loadings, asset class, scenario impacts — is identical either way:
 *
 *   `USDJPY=X`  explicit six-letter form  → { base: "USD", quote: "JPY" }
 *   `JPY=X`     short three-letter form   → { base: "USD", quote: "JPY" }
 *
 * In the short form the dollar leg is IMPLIED and is always the BASE: the price is
 * yen per dollar (163.61), so holding it is long USD / short JPY. Until this form
 * was parsed it fell through to the unparseable-pair path and was modelled as
 * foreign-currency CASH, which loads `usd: -1` — right for HOLDING yen, and the
 * exact inverse of holding a USD/JPY pair. A JPY=X position was reported at -13.0%
 * under a +15% dollar rally it would actually profit from, while `USDJPY=X`, the
 * same trade, reported +15.0%. `JPY=X`, `GBP=X`, `CHF=X`, `CAD=X` and `AUD=X` are
 * all live Yahoo tickers, so this was reachable through the normal buy flow.
 *
 * The implied leg is hard-coded USD, not the portfolio's base currency: the
 * convention belongs to Yahoo, not to the book. For a EUR-denominated portfolio
 * `JPY=X` therefore has no local leg and the caller correctly treats it as a cross.
 */
export function currencyPairLegs(symbol: string | null): { base: string; quote: string } | null {
  if (!symbol) return null;
  const s = symbol.trim();

  const explicit = /^([A-Z]{3})([A-Z]{3})=X$/i.exec(s);
  if (explicit) return { base: explicit[1].toUpperCase(), quote: explicit[2].toUpperCase() };

  const impliedUsdBase = /^([A-Z]{3})=X$/i.exec(s);
  if (impliedUsdBase) {
    const quote = impliedUsdBase[1].toUpperCase();
    // `USD=X` would imply USD/USD, which is not a pair. Returning null keeps it
    // exactly where it was before the short form was parsed at all.
    return quote === "USD" ? null : { base: "USD", quote };
  }

  return null;
}

/**
 * Resolve an instrument to its risk model. Deterministic, and total: every input
 * produces a model plus the reasoning that got there.
 *
 * PRECEDENCE — most specific evidence first, and never the presence of a field:
 *   1. Instrument TYPE from quoteType (money market, currency, crypto).
 *   2. The stored class, where it is unambiguous (cash and the four manual classes).
 *   3. For anything fund-shaped: the Morningstar CATEGORY.
 *   4. Failing a category: the POSITION MIX (bond/equity/cash/other weights).
 *   5. Failing that: the stored class's default model.
 *   6. Single companies: sector + country of domicile.
 */
export function resolveRiskModel(signals: InstrumentSignals): RiskModelResolution {
  const evidence: string[] = [];
  const quoteType = (signals.quoteAssetType ?? "").toUpperCase();
  const category = signals.fundCategory?.trim() ?? null;
  const cat = category?.toLowerCase() ?? null;
  const base = (signals.baseCurrency ?? "USD").toUpperCase();
  const currency = (signals.currency ?? base).toUpperCase();

  const done = (
    id: RiskModelId,
    extra: Partial<Omit<RiskModelResolution, "model" | "evidence">> = {},
  ): RiskModelResolution => ({
    model: RISK_MODELS[id],
    // Everything routed through here was identified by its instrument type, its
    // category or its own symbol — declared evidence unless the caller says otherwise.
    confidence: extra.confidence ?? "declared",
    sector: extra.sector ?? null,
    complex: extra.complex ?? null,
    foreignCurrency: extra.foreignCurrency ?? false,
    evidence,
  });

  /* ---- 1. Instrument type ------------------------------------------------ */

  if (quoteType === "MONEYMARKET") {
    evidence.push("Yahoo quoteType MONEYMARKET → cash-equivalent, not equity");
    return done("cash_equivalent");
  }

  if (signals.assetClass === "forex" || quoteType === "CURRENCY") {
    const legs = currencyPairLegs(signals.symbol);
    if (!legs) {
      // A pair we cannot parse. When the PROVIDER calls it a currency it is still a
      // ticker-priced instrument, so it stays in the forex class — bucketing it as
      // cash would hand it to an adapter whose contract is "quantity IS the amount"
      // and value 10,000 units of a pair at $10,000. A user-booked plain currency
      // holding (stored class forex, no pair symbol) is genuinely foreign cash and
      // gets cash's factor loadings; the valuation-regime guard in
      // model/holding.ts keeps it on its market-priced adapter.
      if (quoteType === "CURRENCY" && signals.assetClass !== "forex") {
        evidence.push(`Provider reports a currency instrument with an unparseable pair symbol → no dollar leg asserted`);
        return done("fx_cross");
      }
      evidence.push(`Currency position in ${currency}`);
      return done(currency === base ? "cash_base" : "cash_foreign", { foreignCurrency: currency !== base });
    }
    if (legs.base === base) {
      evidence.push(`${signals.symbol}: long ${legs.base} (the base currency) against ${legs.quote} → LONG the dollar`);
      return done("fx_long_base");
    }
    if (legs.quote === base) {
      evidence.push(`${signals.symbol}: long ${legs.base} against ${legs.quote} (the base currency) → short the dollar`);
      return done("fx_short_base");
    }
    evidence.push(`${signals.symbol}: ${legs.base}/${legs.quote} cross — neither leg is ${base}, so no dollar loading is asserted`);
    return done("fx_cross");
  }

  if (signals.assetClass === "crypto" || quoteType === "CRYPTOCURRENCY") {
    const sym = (signals.symbol ?? "").toUpperCase();
    if (STABLECOINS.test(sym) || /\bSTABLECOIN\b|\bUSD COIN\b|\bTETHER\b/i.test(signals.name)) {
      evidence.push(`${sym} is a stablecoin → depeg and liquidity risk, not crypto beta`);
      return done("crypto_stablecoin");
    }
    if (CRYPTO_BENCHMARK.test(sym)) {
      evidence.push(`${sym} is the crypto complex's own benchmark → cryptoBeta 1.0`);
      return done("crypto_major");
    }
    evidence.push(`${sym} is a non-benchmark crypto asset → higher crypto beta and worse liquidity than BTC`);
    return done("crypto_alt");
  }

  /* ---- 2. Unambiguous stored classes ------------------------------------ */

  if (signals.assetClass === "cash") {
    const foreign = currency !== base;
    evidence.push(foreign
      ? `${currency} cash in a ${base} portfolio → currency exposure as well as inflation exposure`
      : `${base} cash → inflation exposure only`);
    return done(foreign ? "cash_foreign" : "cash_base", { foreignCurrency: foreign });
  }
  if (signals.assetClass === "real_estate") {
    evidence.push("Directly held property");
    return done("real_estate_direct");
  }
  if (signals.assetClass === "private_market") {
    evidence.push("Private company stake");
    return done("private_equity");
  }
  if (signals.assetClass === "alternative") {
    const sub = `${signals.subcategory ?? ""} ${signals.name}`.toLowerCase();
    // Physical metal recorded as an "alternative" IS bullion. Modelling a gold bar
    // with a generic alternative's 0.3 equity beta gets its crisis behaviour
    // backwards — the same error the scenario engine exists to prevent.
    if (/gold|silver|platinum|bullion|precious metal/.test(sub)) {
      evidence.push(`Subcategory "${signals.subcategory ?? "—"}" is physical precious metal → gold complex, not a generic alternative`);
      return done("commodity_gold", { complex: "gold" });
    }
    if (/watch|art\b|painting|classic car|jewel|luxury|handbag|sneaker|memorabilia|card/.test(sub)) {
      evidence.push(`Subcategory "${signals.subcategory ?? "—"}" is a luxury collectible → wealth-effect equity beta and severe liquidity risk`);
      return done("collectible_luxury");
    }
    evidence.push("Collectible / alternative asset — no recognised subcategory, generic alternative model");
    return done("collectible");
  }
  if (signals.assetClass === "structured_product") {
    evidence.push("Structured note");
    return done("structured_note");
  }

  /* ---- 3/4/5. Fund-shaped instruments ----------------------------------- */

  const fundShaped =
    signals.assetClass === "etf" ||
    signals.assetClass === "bond" ||
    signals.assetClass === "commodity" ||
    quoteType === "ETF" ||
    quoteType === "MUTUALFUND" ||
    quoteType === "CLOSEDENDFUND";

  if (fundShaped) {
    /* A FLOATING-RATE fund files under "Ultrashort Bond" alongside T-bill funds,
       and the two are not the same instrument: a Treasury FRN fund (USFR) carries
       no credit at all, while a corporate FRN fund (FLOT) carries IG spread risk
       with almost no duration. Only the fund's name distinguishes them, and both
       matter more than the distinction the category makes. */
    if (cat?.includes("ultrashort") || cat?.includes("bank loan")) {
      const text = `${signals.symbol ?? ""} ${signals.name}`.toLowerCase();
      if (/floating/.test(text)) {
        const govt = /treasury|govt|government/.test(text);
        evidence.push(
          `Category "${category}" with a floating-rate mandate → ${govt ? "Treasury FRNs: no credit risk and ~no duration" : "corporate FRNs: spread risk without duration"}`,
        );
        return finishFundModel(govt ? "cash_equivalent" : "bond_floating_rate", signals, evidence, cat, currency !== base);
      }
    }

    if (cat) {
      const rule = CATEGORY_RULES.find((r) => r.test.test(cat));
      if (rule) {
        evidence.push(`Morningstar category "${category}" → ${RISK_MODELS[rule.model].label}`);
        if (isBondCategory(category)) {
          evidence.push("Category is one the screener also treats as fixed income (BOND_CATEGORIES)");
        }
        return finishFundModel(rule.model, signals, evidence, cat, currency !== base);
      }
      evidence.push(`Morningstar category "${category}" is not in the risk-model table — falling through to the fund's position mix`);
    } else {
      evidence.push("No fund category available — using the fund's position mix");
    }

    /* Position mix. Note the ORDER: a T-bill fund reports cashPosition 1.0 and
       bondPosition 0, and a bullion trust reports otherPosition 1.0, so bonds
       cannot be detected by bondWeight alone. */
    const bondW = signals.bondWeight ?? null;
    const equityW = signals.equityWeight ?? null;
    const cashW = signals.cashWeight ?? null;
    const otherW = signals.otherWeight ?? null;

    if (bondW != null && bondW >= 50) {
      // The dominant RATING bucket, where the provider gives one, decides which
      // bond model — because it decides the SIGN of the credit-spread loading.
      // Calling a Treasury fund "aggregate" costs it its flight-to-quality gain,
      // which is the single most valuable thing a Treasury sleeve does in a crisis.
      const byRating = bondModelForRating(signals.creditQuality);
      if (byRating) {
        evidence.push(`Holdings are ${bondW.toFixed(0)}% bonds, dominant rating "${signals.creditQuality}" → ${RISK_MODELS[byRating].label}`);
        return finishFundModel(byRating, signals, evidence, cat, currency !== base, "corroborated");
      }
      evidence.push(`Holdings are ${bondW.toFixed(0)}% bonds, no dominant rating → core bond fund model`);
      return finishFundModel("bond_aggregate", signals, evidence, cat, currency !== base, "corroborated");
    }
    if (otherW != null && otherW >= 50 && (equityW ?? 0) < 20 && (bondW ?? 0) < 20) {
      const complex = commodityBucket(signals.symbol, signals.name);
      evidence.push(`Holdings are ${otherW.toFixed(0)}% "other" (futures / bullion) with no equity or bonds → commodity, ${complex} complex`);
      return done(COMPLEX_MODEL[complex], { complex });
    }
    if (cashW != null && cashW >= 50 && (equityW ?? 0) < 20) {
      evidence.push(`Holdings are ${cashW.toFixed(0)}% cash → cash-equivalent fund`);
      return finishFundModel("cash_equivalent", signals, evidence, cat, currency !== base, "corroborated");
    }
    if (equityW != null && equityW >= 50) {
      evidence.push(`Holdings are ${equityW.toFixed(0)}% equity → equity fund`);
      return finishFundModel("fund_equity_us_broad", signals, evidence, cat, currency !== base, "corroborated");
    }

    /* 5. The stored class's default. */
    if (signals.assetClass === "bond") {
      const byRating = bondModelForRating(signals.creditQuality);
      if (byRating) {
        evidence.push(`Stored as a bond with dominant rating "${signals.creditQuality}" → ${RISK_MODELS[byRating].label}`);
        return finishFundModel(byRating, signals, evidence, cat, currency !== base, "corroborated");
      }
      evidence.push("No category and no position mix — stored as a bond, modelled as a core bond fund; a measured duration overrides this bucket average");
      return finishFundModel("bond_aggregate", signals, evidence, cat, currency !== base, "fallback");
    }
    if (signals.assetClass === "commodity") {
      const complex = commodityBucket(signals.symbol, signals.name);
      evidence.push(`No category — stored as a commodity, ${complex} complex resolved from the symbol/name`);
      return done(COMPLEX_MODEL[complex], { complex, confidence: "corroborated" });
    }
    evidence.push("No category and no position mix — modelled as a broad equity fund");
    return finishFundModel("fund_equity_us_broad", signals, evidence, cat, currency !== base, "fallback");
  }

  /* ---- 6. Single companies --------------------------------------------- */

  if (signals.assetClass === "reit") {
    evidence.push("Stored as a REIT → rate and cap-rate exposure on top of equity beta");
    return done("reit", { foreignCurrency: currency !== base });
  }

  if (isPreciousMetalMiner(signals)) {
    evidence.push(`${signals.symbol ?? signals.name} is a precious-metals miner → equity beta plus levered gold exposure`);
    const country = equityModelForCountry(signals.country);
    return done("equity_gold_miner", {
      foreignCurrency: country.id !== "equity_us",
      sector: null,
    });
  }

  const eq = equityModelForCountry(signals.country);
  evidence.push(eq.why);
  const sector = signals.sector && signals.sector in SECTOR_FACTORS
    ? (signals.sector as keyof typeof SECTOR_FACTORS)
    : null;
  if (sector) evidence.push(`Sector ${sector} → its own rate / oil / inflation loadings apply`);
  return done(eq.id, { sector, foreignCurrency: eq.id !== "equity_us" });
}

const COMPLEX_MODEL: Record<keyof typeof COMMODITY_FACTORS, RiskModelId> = {
  gold: "commodity_gold",
  silver: "commodity_silver",
  oil: "commodity_oil",
  natural_gas: "commodity_natural_gas",
  copper: "commodity_copper",
  agriculture: "commodity_agriculture",
  broad: "commodity_broad",
};

/**
 * Attach the sector / complex a fund model needs, once the model itself is known.
 *
 * The fund's own `topSector` is only consulted when the fund is majority EQUITY:
 * Yahoo reports "utilities 99.6%" for HYG and "technology 100%" for BNDX, both
 * derived from a sub-1% cash-sweep holding.
 */
function finishFundModel(
  id: RiskModelId,
  signals: InstrumentSignals,
  evidence: string[],
  cat: string | null,
  foreignCurrency: boolean,
  confidence: ModelConfidence = "declared",
): RiskModelResolution {
  const model = RISK_MODELS[id];

  if (model.kind === "commodity" || id === "commodity_broad") {
    const complex = commodityBucket(signals.symbol, signals.name);
    if (complex !== "broad" || id === "commodity_broad") {
      evidence.push(`Commodity complex "${complex}" resolved from the symbol/name`);
      return { model: RISK_MODELS[COMPLEX_MODEL[complex]], confidence, sector: null, complex, foreignCurrency: false, evidence };
    }
  }

  let sector: keyof typeof SECTOR_FACTORS | null = null;
  if (id === "fund_equity_sector") {
    const byCategory = cat ? CATEGORY_SECTOR.find((r) => r.test.test(cat)) : undefined;
    if (byCategory) {
      sector = byCategory.sector;
      evidence.push(`Sector fund → ${sector} loadings`);
    } else if (
      signals.topSector &&
      (signals.equityWeight ?? 0) >= 50 &&
      (signals.topSectorWeight ?? 0) >= 60 &&
      TOP_SECTOR_ALIAS[signals.topSector]
    ) {
      sector = TOP_SECTOR_ALIAS[signals.topSector];
      evidence.push(`${signals.topSectorWeight!.toFixed(0)}% of holdings are ${signals.topSector} → ${sector} loadings`);
    }
  }

  /* A FUND's currency exposure comes from what it HOLDS, not from what it is quoted
     in. VXUS, VEA and EFA are all USD-listed and USD-quoted, and all of them are
     unhedged baskets of foreign shares — testing the quote currency would find no
     FX exposure in any international fund ever offered to a US investor. So the
     mandate decides: a model that declares an fxPassThrough has that exposure. */
  return {
    model,
    confidence,
    sector,
    complex: null,
    foreignCurrency: (model.fxPassThrough ?? 0) !== 0 || foreignCurrency,
    evidence,
  };
}

/* -------------------------------------------------------------------------- */
/* Factor construction                                                         */
/* -------------------------------------------------------------------------- */

/** What the adapters can measure for this holding, and how good the measurement is. */
export interface Measurements {
  /** Beta vs SPY from daily returns. Null when it could not be measured honestly. */
  equityBeta?: number | null;
  /** Effective duration in years, from the fund's own returns vs the 10-year yield. */
  measuredDuration?: number | null;
  /** The provider's stated duration. Used only as a last resort — see the file header. */
  providerDuration?: number | null;
  /** Multiplies every loading (real estate leverage). */
  leverage?: number;
}

export interface ResolvedFactors {
  modelId: RiskModelId;
  label: string;
  factors: FactorSensitivities;
  /** Effective duration actually used, for display. Null for non-bond models. */
  duration: number | null;
  evidence: string[];
}

const inBand = (v: number | null | undefined, band?: [number, number]): boolean =>
  v != null && Number.isFinite(v) && (!band || (v >= band[0] && v <= band[1]));

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Build the factor vector for a resolved model.
 *
 * Every branch appends to `evidence`, so the resulting vector can always be
 * explained field by field — which is the only way a stress-test number is
 * auditable rather than merely plausible.
 */
export function buildFactors(
  resolution: RiskModelResolution,
  m: Measurements = {},
): ResolvedFactors {
  const { model } = resolution;
  const evidence = [...resolution.evidence];
  const out: FactorSensitivities = {};
  let duration: number | null = null;

  /* A plausibility band is a statement about the MODEL, so it can only overrule a
     measurement when the model itself is well identified. On the fallback path the
     model is a bucket average and the measurement is the better evidence — see
     ModelConfidence. */
  const fallback = resolution.confidence === "fallback";
  const durationBand = fallback ? PHYSICAL_DURATION_BAND : model.durationBand;
  const betaBand = fallback ? PHYSICAL_BETA_BAND : model.equityBetaBand;

  /* ---- equity beta ------------------------------------------------------ */
  const wantsBeta = model.kind === "equity" || model.kind === "bond" || model.kind === "commodity" || model.kind === "crypto";
  if (wantsBeta) {
    if (inBand(m.equityBeta, betaBand)) {
      out.equityBeta = round2(m.equityBeta!);
      evidence.push(`Equity beta ${out.equityBeta} measured from daily returns vs SPY`);
    } else if (m.equityBeta != null && Number.isFinite(m.equityBeta)) {
      const reference = model.equityBeta ?? null;
      evidence.push(
        `Measured equity beta ${round2(m.equityBeta)} is outside the plausible range ` +
        `[${betaBand?.[0]}, ${betaBand?.[1]}] for ${model.label} — using the reference ${reference ?? "none"}`,
      );
      if (reference != null) out.equityBeta = reference;
    } else if (model.equityBeta != null) {
      out.equityBeta = model.equityBeta;
      evidence.push(`Equity beta ${model.equityBeta} from the ${model.label} reference (not measurable)`);
    }
  }

  /* ---- bond block ------------------------------------------------------- */
  if (model.kind === "bond") {
    if (inBand(m.measuredDuration, durationBand)) {
      duration = round2(m.measuredDuration!);
      evidence.push(`Effective duration ${duration}y MEASURED from this fund's own returns vs the 10-year Treasury yield`);
    } else if (m.measuredDuration != null && Number.isFinite(m.measuredDuration)) {
      duration = model.referenceDuration ?? null;
      evidence.push(
        `Measured duration ${round2(m.measuredDuration)}y is outside the plausible band ` +
        `[${durationBand?.[0]}, ${durationBand?.[1]}]y for ${model.label} — using the reference ${duration}y`,
      );
    } else if (model.referenceDuration != null) {
      duration = model.referenceDuration;
      evidence.push(`Effective duration ${duration}y from the ${model.label} reference table (as of ${RISK_MODELS_AS_OF})`);
    } else if (inBand(m.providerDuration, [0.02, 30])) {
      duration = round2(m.providerDuration!);
      evidence.push(`Duration ${duration}y from the provider — last resort; this field is known to be unreliable`);
    }

    if (duration != null) {
      out.rates = -round2(duration);
      if (model.realRateLinked) {
        // Real-rate exposure: −D on nominal rates, +D on inflation, so the net is
        // −D × Δ(real rate) for any scenario without hard-coding a TIPS case.
        out.inflation = round2(duration);
        evidence.push(`Inflation-linked: rates ${out.rates} and inflation +${out.inflation} are equal and opposite, so only the REAL rate moves this fund`);
      }
      if (model.creditSpread != null) {
        out.creditSpread = model.creditSpread;
        evidence.push(`Credit-spread loading ${model.creditSpread} declared for ${model.label} (not duration-scaled: the coupon floats)`);
      } else if (model.spreadDurationMultiple != null) {
        out.creditSpread = round2(-duration * model.spreadDurationMultiple);
        evidence.push(
          `Credit-spread loading ${out.creditSpread} = −${duration}y duration × ${model.spreadDurationMultiple} ` +
          `(spread duration ≈ effective duration${model.spreadDurationMultiple < 0 ? "; negative multiple = flight-to-quality GAIN" : ""})`,
        );
      }
    }
    if (!model.realRateLinked && model.inflation != null) out.inflation = model.inflation;
  }

  /* ---- commodity complex ----------------------------------------------- */
  if (model.kind === "commodity" && resolution.complex) {
    const complexFactors = COMMODITY_FACTORS[resolution.complex];
    for (const [k, v] of Object.entries(complexFactors)) {
      if (k === "equityBeta" && out.equityBeta != null) continue;  // measured wins
      out[k as Factor] = v;
    }
    evidence.push(`${resolution.complex} complex loadings applied (own-factor rule: no double-counted usd/inflation)`);
  }

  /* ---- sector loadings -------------------------------------------------- */
  if (resolution.sector) {
    const sf = SECTOR_FACTORS[resolution.sector];
    for (const [k, v] of Object.entries(sf)) {
      const key = k as Factor;
      out[key] = round2((out[key] ?? 0) + v);
    }
  }

  /* ---- static extras ---------------------------------------------------- */
  if (model.extra) {
    for (const [k, v] of Object.entries(model.extra)) {
      const key = k as Factor;
      out[key] = round2((out[key] ?? 0) + v);
    }
  }
  if (model.kind === "cash" && model.inflation != null) out.inflation = model.inflation;

  /* ---- currency -------------------------------------------------------- */
  if (model.kind === "fx") {
    if (model.id === "fx_long_base") {
      out.usd = 1.0;
      evidence.push("usd +1.0: the position is long the base currency");
    } else if (model.id === "fx_short_base") {
      out.usd = -1.0;
      evidence.push("usd −1.0: the position is short the base currency");
    }
  } else if (resolution.foreignCurrency && model.fxPassThrough) {
    out.usd = round2((out.usd ?? 0) - model.fxPassThrough);
    evidence.push(`usd ${out.usd}: unhedged non-base-currency exposure, ${model.fxPassThrough} pass-through (see FX_PASS_THROUGH)`);
  }

  /* ---- leverage -------------------------------------------------------- */
  if (m.leverage != null && m.leverage !== 1) {
    for (const k of Object.keys(out) as Factor[]) out[k] = round2(out[k]! * m.leverage);
    if (duration != null) duration = round2(duration * m.leverage);
    evidence.push(`Every loading multiplied by ${round2(m.leverage)}× for leverage`);
  }

  /* Drop zeros so `isCovered()` and the driver list stay honest about what is
     actually exposed rather than listing zero-loading factors. */
  const factors = mergeFactors(out);
  for (const k of Object.keys(factors) as Factor[]) {
    if (factors[k] === 0) delete factors[k];
  }

  return { modelId: model.id, label: model.label, factors, duration, evidence };
}

/** Classify and build in one call — what every adapter uses. */
export function resolveFactors(signals: InstrumentSignals, m: Measurements = {}): ResolvedFactors {
  return buildFactors(resolveRiskModel(signals), m);
}

/* -------------------------------------------------------------------------- */
/* THE asset-class authority                                                   */
/* -------------------------------------------------------------------------- */

/**
 * THE asset class of an instrument. The single authority for the whole Portfolio
 * subsystem — Allocation, Health, Optimize, Decisions, Performance, Simulator and
 * the Risk Lab all read the class this function produced, none of them derive one.
 *
 * It is deliberately the SAME resolution that produces the factor loadings, so a
 * holding cannot be a bond to the stress test and an ETF to the rebalancer: both
 * answers come out of one `resolveRiskModel()` call over one set of signals.
 *
 * The stored `asset_class` column is an INPUT here (a hint, and the ledger's record
 * of how the position was booked), never the answer. That is what stops the stored
 * value drifting away from what the instrument actually is.
 */
export function resolveAssetClass(signals: InstrumentSignals): PortfolioAssetClass {
  return resolveRiskModel(signals).model.assetClass;
}

/**
 * The asset class implied by a provider quoteType alone, for the BOOKING moment —
 * a buy flow has a quote and nothing else yet (no Morningstar category, no holdings
 * mix), so this is the same authority running on the only evidence available.
 *
 * It replaces a hand-maintained `quoteType → class` table that lived in
 * model/types.ts. Two mappings for one question is exactly how the ETF/bond
 * contradiction survived as long as it did; there is now one, and this is a call
 * into it rather than a copy of it. Read-time resolution supersedes whatever gets
 * booked here as soon as fund data is available, so this is a starting value, not
 * a commitment.
 */
export function assetClassFromQuoteType(
  symbol: string | null,
  name: string,
  assetType: string | null | undefined,
): PortfolioAssetClass {
  return resolveAssetClass({
    symbol,
    name,
    // The hint the classifier falls back to when a quoteType says nothing useful,
    // and the historical default of the table this replaces.
    assetClass: "equity",
    quoteAssetType: assetType ?? null,
  });
}
