/**
 * Computed metrics for manual assets (Real Estate / Private Markets /
 * Alternatives / Structured Products) — pure functions over user-entered
 * facts (see lib/types.ts's ManualAsset), the same "no fabricated data"
 * discipline as every market-data engine in the Research Hub, just with
 * user-supplied numbers standing in for a live feed that doesn't exist for
 * these asset classes.
 *
 * No 0-100 score here either, same reasoning as Derivatives/Macro: these
 * are standard financial metrics (cap rate, MOIC, CAGR) an investor
 * interprets themselves, not a manufactured BUY/SELL call on an asset this
 * app has no independent way to verify the value of.
 */

import type {
  ManualAsset,
  PrivateMarketDetails,
  RealEstateDetails,
  StructuredProductDetails,
} from "./types";

function yearsBetween(fromIso: string, toIso: string = new Date().toISOString()): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(ms / (365.25 * 24 * 60 * 60 * 1000), 0);
}

/** (finalValue/initialValue)^(1/years) - 1, as a percent. Null when years is too small to annualize meaningfully. */
function cagrPercent(initialValue: number, finalValue: number, years: number): number | null {
  if (initialValue <= 0 || finalValue < 0 || years < 0.08) return null; // < ~1 month: annualizing is noise, not signal
  return (Math.pow(finalValue / initialValue, 1 / years) - 1) * 100;
}

/* -------------------------------------------------------------------------- */
/* Real Estate                                                                */
/* -------------------------------------------------------------------------- */

export interface RealEstateMetrics {
  noi: number | null; // annual net operating income
  capRatePercent: number | null; // NOI / current value
  rentalYieldPercent: number | null; // gross rental income / current value
  /** Annual mortgage interest, approximated as outstandingMortgage * rate — not a real
   *  amortization schedule (no loan term collected), so cash-on-cash below is
   *  directional, not exact. */
  approxAnnualDebtService: number | null;
  cashOnCashReturnPercent: number | null;
  totalAppreciationPercent: number | null; // price appreciation only, excludes rental income
}

export function computeRealEstateMetrics(asset: ManualAsset & { category: "real_estate" }): RealEstateMetrics {
  const d: RealEstateDetails = asset.details;
  const value = asset.currentValue ?? asset.acquisitionCost;

  const noi = d.annualRentalIncome != null && d.annualExpenses != null ? d.annualRentalIncome - d.annualExpenses : null;
  const capRatePercent = noi != null && value > 0 ? (noi / value) * 100 : null;
  const rentalYieldPercent = d.annualRentalIncome != null && value > 0 ? (d.annualRentalIncome / value) * 100 : null;

  const approxAnnualDebtService =
    d.outstandingMortgage != null && d.mortgageRatePercent != null
      ? d.outstandingMortgage * (d.mortgageRatePercent / 100)
      : null;

  const cashInvested = d.outstandingMortgage != null ? Math.max(asset.acquisitionCost - d.outstandingMortgage, 1) : asset.acquisitionCost;
  const cashOnCashReturnPercent =
    noi != null && approxAnnualDebtService != null && cashInvested > 0
      ? ((noi - approxAnnualDebtService) / cashInvested) * 100
      : null;

  const totalAppreciationPercent = asset.currentValue != null && asset.acquisitionCost > 0
    ? ((asset.currentValue - asset.acquisitionCost) / asset.acquisitionCost) * 100
    : null;

  return { noi, capRatePercent, rentalYieldPercent, approxAnnualDebtService, cashOnCashReturnPercent, totalAppreciationPercent };
}

/* -------------------------------------------------------------------------- */
/* Private Markets                                                            */
/* -------------------------------------------------------------------------- */

export interface PrivateMarketMetrics {
  moic: number | null; // multiple on invested capital
  annualizedReturnPercent: number | null;
  impliedOwnershipValue: number | null; // ownershipPercent * lastRoundValuation, cross-check vs currentValue
}

export function computePrivateMarketMetrics(asset: ManualAsset & { category: "private_market" }): PrivateMarketMetrics {
  const d: PrivateMarketDetails = asset.details;
  const value = asset.currentValue;

  const moic = value != null && asset.acquisitionCost > 0 ? value / asset.acquisitionCost : null;
  const annualizedReturnPercent =
    value != null ? cagrPercent(asset.acquisitionCost, value, yearsBetween(asset.acquisitionDate)) : null;
  const impliedOwnershipValue =
    d.ownershipPercent != null && d.lastRoundValuation != null ? (d.ownershipPercent / 100) * d.lastRoundValuation : null;

  return { moic, annualizedReturnPercent, impliedOwnershipValue };
}

/* -------------------------------------------------------------------------- */
/* Alternatives (art, wine, watches, collectibles, ...)                       */
/* -------------------------------------------------------------------------- */

export interface AlternativeMetrics {
  appreciationPercent: number | null;
  cagrPercent: number | null;
}

// AlternativeDetails (subcategory/condition/provenance) is purely descriptive
// — nothing in it feeds these metrics, unlike the other three categories.
export function computeAlternativeMetrics(asset: ManualAsset & { category: "alternative" }): AlternativeMetrics {
  const value = asset.currentValue;

  const appreciationPercent = value != null && asset.acquisitionCost > 0 ? ((value - asset.acquisitionCost) / asset.acquisitionCost) * 100 : null;
  const cagr = value != null ? cagrPercent(asset.acquisitionCost, value, yearsBetween(asset.acquisitionDate)) : null;

  return { appreciationPercent, cagrPercent: cagr };
}

/* -------------------------------------------------------------------------- */
/* Structured Products                                                        */
/* -------------------------------------------------------------------------- */

export interface StructuredProductMetrics {
  /** Each underlying's current level as % of its level at issuance (100 = unchanged). */
  currentLevelsPercent: Record<string, number>;
  /** The worst-performing underlying's level % — the one that determines
   *  barrier breach in standard multi-underlying ("worst-of") structures. */
  worstOfLevelPercent: number | null;
  distanceToBarrierPercent: number | null; // worstOfLevelPercent - barrierPercent; negative = barrier breached
  yearsToMaturity: number;
  /** Payoff at a range of hypothetical final levels (% of initial), as % of
   *  principal — only computed for the two product types with well-defined,
   *  non-path-dependent payoff formulas. Autocallable/other get an honest
   *  "not modeled" rather than a fabricated simulation of multi-date
   *  observation logic this doesn't implement. */
  payoffScenarios: { finalLevelPercent: number; payoffPercent: number }[] | null;
}

const SCENARIO_LEVELS = [-40, -30, -20, -10, 0, 10, 20, 30, 40]; // % change from initial

function payoffBarrierReverseConvertible(finalLevelPercent: number, barrierPercent: number, couponRatePercent: number, years: number): number {
  const totalCoupon = couponRatePercent * years; // simplified: not compounded, not discounted to present value
  return finalLevelPercent >= barrierPercent ? 100 + totalCoupon : finalLevelPercent + totalCoupon;
}

function payoffPrincipalProtectedNote(finalLevelPercent: number, principalProtectionPercent: number, participationRatePercent: number): number {
  const upside = Math.max(0, finalLevelPercent - 100);
  return principalProtectionPercent + (participationRatePercent / 100) * upside;
}

/** `currentPrices` keyed by underlying symbol — caller fetches these (real quotes), this function stays pure. */
export function computeStructuredProductMetrics(
  asset: ManualAsset & { category: "structured_product" },
  currentPrices: Record<string, number | null>,
): StructuredProductMetrics {
  const d: StructuredProductDetails = asset.details;

  const currentLevelsPercent: Record<string, number> = {};
  for (const symbol of d.underlyingSymbols) {
    const initial = d.initialLevels[symbol];
    const current = currentPrices[symbol];
    if (initial != null && initial > 0 && current != null) {
      currentLevelsPercent[symbol] = (current / initial) * 100;
    }
  }

  const levels = Object.values(currentLevelsPercent);
  const worstOfLevelPercent = levels.length > 0 ? Math.min(...levels) : null;
  const distanceToBarrierPercent =
    worstOfLevelPercent != null && d.barrierPercent != null ? worstOfLevelPercent - d.barrierPercent : null;

  const yearsToMaturity = yearsBetween(new Date().toISOString(), d.maturityDate);

  let payoffScenarios: StructuredProductMetrics["payoffScenarios"] = null;
  if (d.productType === "barrier_reverse_convertible" && d.barrierPercent != null && d.couponRatePercent != null) {
    const totalYears = yearsBetween(asset.acquisitionDate, d.maturityDate);
    payoffScenarios = SCENARIO_LEVELS.map((change) => ({
      finalLevelPercent: 100 + change,
      payoffPercent: payoffBarrierReverseConvertible(100 + change, d.barrierPercent!, d.couponRatePercent!, totalYears),
    }));
  } else if (d.productType === "principal_protected_note" && d.principalProtectionPercent != null && d.participationRatePercent != null) {
    payoffScenarios = SCENARIO_LEVELS.map((change) => ({
      finalLevelPercent: 100 + change,
      payoffPercent: payoffPrincipalProtectedNote(100 + change, d.principalProtectionPercent!, d.participationRatePercent!),
    }));
  }

  return { currentLevelsPercent, worstOfLevelPercent, distanceToBarrierPercent, yearsToMaturity, payoffScenarios };
}
