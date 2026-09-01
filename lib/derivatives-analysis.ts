/**
 * Derivatives (options chain) analysis — a market-positioning lens on an
 * equity/fund underlying, not a "should I buy this" score. Unlike the
 * crypto/commodity/forex engines, this deliberately doesn't produce a 0-100
 * composite: implied volatility, open-interest positioning, and Greeks
 * describe what the options market is pricing, not a directional call on
 * the underlying — forcing that into a ScoreResult would manufacture a
 * verdict the data doesn't actually support.
 *
 * Pure function over lib/yahoo.ts's getOptionsChain() output — all figures
 * trace back to real Yahoo chain data plus deterministic Black-Scholes
 * Greeks (lib/black-scholes.ts), nothing invented.
 */

import type { Greeks } from "./black-scholes";
import { blackScholesGreeks } from "./black-scholes";
import { riskFreeRate } from "./benchmarks";
import { detectMarket } from "./market";
import type { OptionContract, OptionsChainData } from "./types";

/** US fallback rate (~3M T-bill), matching lib/portfolio-analytics.ts's default
 *  assumption. Only the fallback — the Greeks below price with the market-aware
 *  rate from {@link riskFreeRateForUnderlying}: an NSE option (RELIANCE.NS)
 *  discounted at the US T-bill rate misprices every rate-sensitive Greek. */
const RISK_FREE_RATE = 0.0425;

/**
 * Risk-free rate for an options underlying, derived from its listing market.
 * The chain payload carries only the underlying's symbol (no currency/exchange
 * — see OptionsChainData), so region detection rides on the symbol suffix via
 * lib/market.ts, and lib/benchmarks.ts owns the per-region rates (US ~3M
 * T-bill 4.25%; IN ~10Y GOI 6.5%, the same figure the valuation layer uses).
 */
export function riskFreeRateForUnderlying(symbol: string | null | undefined): number {
  if (!symbol) return RISK_FREE_RATE;
  const region = detectMarket({ symbol, currency: "", exchange: null, assetType: null });
  return riskFreeRate(region);
}

export interface DerivativesSummary {
  underlyingSymbol: string;
  underlyingPrice: number;
  nearestExpiration: string | null;
  farExpiration: string | null;
  /** Percent, e.g. 28.4 = 28.4% — averaged from the ATM call+put IV. */
  atmIV: number | null;
  atmIVFar: number | null;
  /** near > far = "backwardation" (near-term richer, often event/fear-driven); near < far = "contango" (typical upward-sloping curve). */
  termStructure: "backwardation" | "contango" | "flat" | null;
  putCallOIRatio: number | null;
  topCallStrikes: { strike: number; openInterest: number }[];
  topPutStrikes: { strike: number; openInterest: number }[];
  atmStrike: number | null;
  atmCallGreeks: Greeks | null;
  atmPutGreeks: Greeks | null;
  expirationDates: string[];
}

/**
 * Plausible implied-volatility band for a listed equity/ETF option, in decimal
 * terms (8% – 400% annualized). Yahoo's chain data is frequently stale or
 * placeholder off-hours: illiquid contracts come back with bid=ask=0 and IVs
 * like 0.0156 or 0.0625 (binary fractions, i.e. solver garbage, not markets).
 * Averaging those produced "ATM IV 2.3%" on screen — impossible for any
 * single name. A contract outside this band is treated as having NO usable IV.
 */
const MIN_PLAUSIBLE_IV = 0.08;
const MAX_PLAUSIBLE_IV = 4.0;

function usableIv(c: OptionContract | null): number | null {
  const iv = c?.impliedVolatility;
  if (iv == null || iv < MIN_PLAUSIBLE_IV || iv > MAX_PLAUSIBLE_IV) return null;
  // A quoted market is the difference between a solver artifact and a price.
  if ((c?.bid ?? 0) <= 0 && (c?.ask ?? 0) <= 0) return null;
  return iv;
}

function closestToPrice(contracts: OptionContract[], price: number): OptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) => (Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best));
}

/** Nearest-the-money contract that carries a USABLE IV (see usableIv). */
function closestWithIv(contracts: OptionContract[], price: number): OptionContract | null {
  const candidates = contracts.filter((c) => usableIv(c) != null);
  return closestToPrice(candidates, price);
}

function atmIvPercent(calls: OptionContract[], puts: OptionContract[], price: number): { iv: number | null; strike: number | null } {
  const atmCall = closestWithIv(calls, price);
  const atmPut = closestWithIv(puts, price);
  const ivs = [usableIv(atmCall), usableIv(atmPut)].filter((v): v is number => v != null);
  const strike = atmCall?.strike ?? atmPut?.strike ?? closestToPrice(calls, price)?.strike ?? closestToPrice(puts, price)?.strike ?? null;
  if (ivs.length === 0) return { iv: null, strike };
  return { iv: (ivs.reduce((s, v) => s + v, 0) / ivs.length) * 100, strike };
}

function topByOpenInterest(contracts: OptionContract[], n = 5): { strike: number; openInterest: number }[] {
  return contracts
    .filter((c) => c.openInterest != null && c.openInterest > 0)
    .sort((a, b) => (b.openInterest ?? 0) - (a.openInterest ?? 0))
    .slice(0, n)
    .map((c) => ({ strike: c.strike, openInterest: c.openInterest! }));
}

function yearsUntil(isoDate: string): number {
  const ms = new Date(isoDate).getTime() - Date.now();
  return Math.max(ms / (365.25 * 24 * 60 * 60 * 1000), 0);
}

/**
 * Every field the Options Chain card renders must be present and plausible,
 * or the card does not render at all. A half-populated options panel ("ATM IV
 * 2.3%", zeroed put greeks, "Not available" strike lists) destroys trust in
 * every other number on the page — hiding is the honest degradation when the
 * provider's chain data is stale or placeholder.
 */
export function isDerivativesSummaryComplete(s: DerivativesSummary | null): s is DerivativesSummary {
  if (!s) return false;
  return (
    s.atmIV != null &&
    s.atmIVFar != null &&
    s.termStructure != null &&
    s.putCallOIRatio != null &&
    s.topCallStrikes.length > 0 &&
    s.topPutStrikes.length > 0 &&
    s.atmStrike != null &&
    s.atmCallGreeks != null &&
    s.atmPutGreeks != null
  );
}

export function computeDerivativesSummary(chain: OptionsChainData): DerivativesSummary {
  const near = chain.chains[0] ?? null;
  const far = chain.chains[1] ?? null;
  const price = chain.underlyingPrice;

  const nearAtm = near ? atmIvPercent(near.calls, near.puts, price) : { iv: null, strike: null };
  const farAtm = far ? atmIvPercent(far.calls, far.puts, price) : { iv: null, strike: null };

  let termStructure: DerivativesSummary["termStructure"] = null;
  if (nearAtm.iv != null && farAtm.iv != null) {
    const diff = nearAtm.iv - farAtm.iv;
    termStructure = diff > 1 ? "backwardation" : diff < -1 ? "contango" : "flat";
  }

  const nearCallOI = near ? near.calls.reduce((s, c) => s + (c.openInterest ?? 0), 0) : 0;
  const nearPutOI = near ? near.puts.reduce((s, c) => s + (c.openInterest ?? 0), 0) : 0;
  const putCallOIRatio = nearCallOI > 0 ? nearPutOI / nearCallOI : null;

  const atmCall = near ? closestToPrice(near.calls, price) : null;
  const atmPut = near ? closestToPrice(near.puts, price) : null;
  const timeToExpiry = near ? yearsUntil(near.expirationDate) : 0;
  const rate = riskFreeRateForUnderlying(chain.underlyingSymbol);

  const atmCallGreeks =
    atmCall && nearAtm.iv != null
      ? blackScholesGreeks({ spot: price, strike: atmCall.strike, timeToExpiryYears: timeToExpiry, riskFreeRate: rate, volatility: nearAtm.iv / 100, isCall: true })
      : null;
  const atmPutGreeks =
    atmPut && nearAtm.iv != null
      ? blackScholesGreeks({ spot: price, strike: atmPut.strike, timeToExpiryYears: timeToExpiry, riskFreeRate: rate, volatility: nearAtm.iv / 100, isCall: false })
      : null;

  return {
    underlyingSymbol: chain.underlyingSymbol,
    underlyingPrice: price,
    nearestExpiration: near?.expirationDate ?? null,
    farExpiration: far?.expirationDate ?? null,
    atmIV: nearAtm.iv,
    atmIVFar: farAtm.iv,
    termStructure,
    putCallOIRatio,
    topCallStrikes: near ? topByOpenInterest(near.calls) : [],
    topPutStrikes: near ? topByOpenInterest(near.puts) : [],
    atmStrike: nearAtm.strike,
    atmCallGreeks,
    atmPutGreeks,
    expirationDates: chain.expirationDates,
  };
}
