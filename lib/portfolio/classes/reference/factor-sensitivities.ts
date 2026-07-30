/**
 * Curated factor-sensitivity reference table.
 *
 * These are `reference` data in the asset registry's sense (lib/assets/types.ts
 * MetricAvailability): they ship with the app, carry an `asOf`, and are honest
 * about being estimates rather than live measurements. They are used ONLY where a
 * sensitivity cannot be measured from data we actually have.
 *
 * Measured wins over reference, always:
 *   - Equity/fund beta      → measured from daily returns vs SPY (lib/portfolio/engines/risk.ts)
 *   - Bond duration         → real, from Yahoo topHoldings.bondHoldings.duration
 *   - Bond credit quality   → real, from Yahoo topHoldings.bondRatings
 * Everything below is the fallback for the rest.
 *
 * WHY THIS FILE EXISTS AT ALL: the engine it replaces shocked every asset without
 * a GICS sector by a flat -20% in every crisis scenario. Gold, Treasuries and cash
 * — the three things people hold precisely BECAUSE they behave differently in a
 * crisis — were all marked down 20% alongside equities. A dated, reviewable table
 * of real sensitivities is not a heuristic shortcut; it is strictly more correct
 * than the number it replaces.
 *
 * ⚠️ These are long-run average relationships and DO go stale (regime changes,
 * e.g. the 2022 breakdown of the stock/bond correlation). Review on the cadence
 * below, the same discipline as lib/assets/reference/policy-rates.ts.
 */

import type { Factor, FactorSensitivities } from "../../model/types";

export const FACTOR_SENSITIVITIES_AS_OF = "2026-07-12";

/* -------------------------------------------------------------------------- */
/* Equity sector modifiers                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Sector-specific factor exposures LAYERED ON TOP of a stock's measured equity
 * beta — not a replacement for it. Energy's oil sensitivity and Utilities' rate
 * sensitivity are real and not captured by beta alone.
 *
 * Units: `rates`/`inflation` are % move per 1pp shock; `oil`/`usd`/`gold` are
 * % move per 1% shock in that complex.
 */
export const SECTOR_FACTORS: Record<string, FactorSensitivities> = {
  Technology:               { rates: -1.8, inflation: -0.8, usd: -0.15 },
  "Communication Services": { rates: -1.2, inflation: -0.6, usd: -0.10 },
  "Consumer Discretionary": { rates: -1.4, inflation: -1.0, oil: -0.10 },
  "Consumer Staples":       { rates: -0.4, inflation: -0.2, usd: -0.10 },
  Healthcare:              { rates: -0.6, inflation: -0.2 },
  Financials:              { rates: 0.8, creditSpread: -2.5, liquidityStress: -0.35 },
  Energy:                  { oil: 0.65, inflation: 1.2, usd: -0.20 },
  Materials:               { oil: 0.25, inflation: 0.9, usd: -0.25, gold: 0.15 },
  Industrials:             { oil: -0.15, inflation: -0.2, usd: -0.15 },
  Utilities:               { rates: -2.2, inflation: -0.3 },
  "Real Estate":           { rates: -2.8, realEstateCap: -8.0, inflation: 0.3 },
};

/* -------------------------------------------------------------------------- */
/* Whole-class defaults                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Baseline sensitivities per asset class, used when nothing more specific is
 * measurable. Equity/ETF/REIT beta is measured and overrides `equityBeta` here.
 */
export const CLASS_FACTORS: Record<string, FactorSensitivities> = {
  /* Broad equity: beta measured; 1.0 is the fallback if there's no price history. */
  equity: { equityBeta: 1.0 },
  etf:    { equityBeta: 1.0 },

  /* REITs are rate instruments wearing an equity costume. */
  reit:   { equityBeta: 0.9, rates: -2.8, realEstateCap: -8.0, inflation: 0.3 },

  /**
   * Bonds: `rates` is overridden with the REAL duration when the provider gives
   * it. This fallback is a generic intermediate-term aggregate profile.
   */
  bond:   { rates: -6.0, creditSpread: -1.5, inflation: -0.8, equityBeta: 0.1 },

  /**
   * Crypto: equityBeta ~0.4 is the post-2020 realized relationship — crypto is NOT
   * uncorrelated to equities, and treating it as a diversifier is a common and
   * expensive error. liquidityStress is severe: crypto sells off hardest exactly
   * when liquidity is scarce.
   *
   * No `usd` loading — per the own-factor rule (see COMMODITY_FACTORS), crypto is
   * priced by `cryptoBeta`, which each scenario states directly.
   */
  crypto: { cryptoBeta: 1.0, equityBeta: 0.4, liquidityStress: -0.60 },

  /* Broad commodity default; each complex overrides it — see COMMODITY_FACTORS. */
  commodity: { oil: 0.40, gold: 0.25, equityBeta: 0.25 },

  forex:  { usd: -1.0 },

  /**
   * Cash is NOT riskless. Its nominal value is stable, but a +1pp inflation
   * surprise is a ~1% loss of purchasing power. A 40%-cash portfolio must score
   * WORSE on inflation protection, not neutral — modelling cash as all-zeros is
   * how tools end up recommending cash as a free lunch.
   */
  cash:   { inflation: -1.0, liquidityStress: 0.10 },

  real_estate:    { realEstateCap: -10.0, rates: -1.5, inflation: 0.8, equityBeta: 0.3, liquidityStress: -0.25 },
  /* Private markets: levered equity with lagged, smoothed marks. Beta > 1 in truth. */
  private_market: { equityBeta: 1.3, liquidityStress: -0.80, rates: -1.0, creditSpread: -1.0 },
  alternative:    { inflation: 0.5, equityBeta: 0.3, liquidityStress: -0.55 },
  /* Overridden per-product by the payoff model; this is only the fallback. */
  structured_product: { equityBeta: 0.5, rates: -1.5, creditSpread: -1.0 },
};

/* -------------------------------------------------------------------------- */
/* Commodity-specific                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Commodities are not one thing. Gold and crude oil have nearly opposite crisis
 * behaviour, and collapsing them into a single "Commodity" bucket (as a
 * sector-keyed model must) destroys the entire reason to hold either.
 *
 * ⚠️ THE OWN-FACTOR RULE — read before adding a loading here.
 *
 * An asset priced BY a complex loads on that complex's factor and NOT on the macro
 * drivers behind it. Gold gets `gold: 1.0` and NO `usd`/`inflation` loading.
 *
 * Why: a scenario states the gold complex's move as an OUTCOME — in the 2008
 * scenario, gold +5% and the dollar +12% both happened, together. Gold's +5% IS its
 * move during that dollar rally. Loading gold on `usd: -0.8` as well would subtract
 * another 9.6%, charging it for the same dollar move twice — and it did exactly
 * that in the first version of this file, which turned gold's real +5% crisis gain
 * into a fictitious -6.8% loss. The double-count reintroduced, in a subtler form,
 * the very bug this engine was built to kill.
 *
 * Gold's inflation and dollar behaviour ARE modelled — through the `gold` shock each
 * scenario states (high_inflation: gold +20; usd_strength: gold -12). And the
 * portfolio's inflation sensitivity is measured by running a standardized inflation
 * scenario (INFLATION_1PP in ../engines/scenario.ts), not by reading a raw
 * `inflation` loading — so a gold holding still registers as inflation protection.
 *
 * Cross-loadings on `inflation`/`usd` remain correct for assets NOT priced by the
 * complex — e.g. Energy sector EQUITIES (SECTOR_FACTORS.Energy), which respond to
 * both the oil price and inflation as distinct effects.
 */
export const COMMODITY_FACTORS: Record<string, FactorSensitivities> = {
  gold:        { gold: 1.0, equityBeta: 0.0, liquidityStress: 0.30 },
  silver:      { gold: 0.85, equityBeta: 0.25 },
  oil:         { oil: 1.0, equityBeta: 0.35 },
  natural_gas: { oil: 0.55, equityBeta: 0.20 },
  copper:      { oil: 0.35, equityBeta: 0.55 },
  agriculture: { inflation: 1.4, equityBeta: 0.15 },
  broad:       { oil: 0.40, gold: 0.25, equityBeta: 0.25 },
};

/**
 * Map a commodity symbol/name onto a COMMODITY_FACTORS bucket. Deliberately
 * conservative: unrecognized → "broad", never a guess at a specific complex.
 */
export function commodityBucket(symbol: string | null, name: string): keyof typeof COMMODITY_FACTORS {
  const s = `${symbol ?? ""} ${name}`.toUpperCase();
  if (/\bGOLD\b|\bGC[=_]?F?\b|\bGLD\b|\bIAU\b|\bXAU\b/.test(s)) return "gold";
  if (/\bSILVER\b|\bSI[=_]?F?\b|\bSLV\b|\bXAG\b/.test(s)) return "silver";
  if (/\bCRUDE\b|\bOIL\b|\bWTI\b|\bBRENT\b|\bCL[=_]?F?\b|\bUSO\b/.test(s)) return "oil";
  if (/\bNAT(URAL)?\s?GAS\b|\bNG[=_]?F?\b|\bUNG\b/.test(s)) return "natural_gas";
  if (/\bCOPPER\b|\bHG[=_]?F?\b|\bCPER\b/.test(s)) return "copper";
  if (/\bCORN\b|\bWHEAT\b|\bSOY\b|\bAGRI/.test(s)) return "agriculture";
  return "broad";
}

/* -------------------------------------------------------------------------- */
/* Credit                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Credit-spread sensitivity by rating bucket, in % price move per 1pp of spread
 * widening. Junk gets crushed; Treasuries RALLY (flight to quality) — which is
 * why this value is positive for `us_government` and is the single most important
 * thing the old -20%-flat model got backwards.
 *
 * ⚠️ SUPERSEDED for portfolio stress testing, and kept only as reference data.
 *
 * A flat number per rating cannot express the thing that actually determines the
 * loss: SPREAD DURATION. A 13-year BBB fund and a 2-year BBB fund share this
 * bucket and reprice by 6.5× different amounts for the same widening. The risk
 * models in ./risk-models.ts therefore derive the loading as
 * `−duration × segment spread beta`, and the rating bucket is used only to place a
 * fund in the right SEGMENT when its Morningstar category is unavailable.
 */
export const CREDIT_SPREAD_BETA: Record<string, number> = {
  us_government: 1.2,
  aaa: 0.3,
  aa: -0.2,
  a: -0.8,
  bbb: -1.8,
  bb: -3.5,
  b: -5.0,
  below_b: -7.0,
  other: -1.5,
};

/* -------------------------------------------------------------------------- */
/* Utilities                                                                   */
/* -------------------------------------------------------------------------- */

/** Merge sensitivity maps left→right; later entries win. Absent = 0. */
export function mergeFactors(...maps: (FactorSensitivities | undefined)[]): FactorSensitivities {
  const out: FactorSensitivities = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) {
      if (v != null && Number.isFinite(v)) out[k as Factor] = v;
    }
  }
  return out;
}
