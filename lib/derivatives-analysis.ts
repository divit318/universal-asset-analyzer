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
import type { OptionContract, OptionsChainData } from "./types";

const RISK_FREE_RATE = 0.0425; // matches lib/portfolio-analytics.ts's default T-bill assumption

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

function closestToPrice(contracts: OptionContract[], price: number): OptionContract | null {
  if (contracts.length === 0) return null;
  return contracts.reduce((best, c) => (Math.abs(c.strike - price) < Math.abs(best.strike - price) ? c : best));
}

function atmIvPercent(calls: OptionContract[], puts: OptionContract[], price: number): { iv: number | null; strike: number | null } {
  const atmCall = closestToPrice(calls, price);
  const atmPut = closestToPrice(puts, price);
  const ivs = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter((v): v is number => v != null && v > 0);
  if (ivs.length === 0) return { iv: null, strike: atmCall?.strike ?? atmPut?.strike ?? null };
  return { iv: (ivs.reduce((s, v) => s + v, 0) / ivs.length) * 100, strike: atmCall?.strike ?? atmPut?.strike ?? null };
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

  const atmCallGreeks =
    atmCall && nearAtm.iv != null
      ? blackScholesGreeks({ spot: price, strike: atmCall.strike, timeToExpiryYears: timeToExpiry, riskFreeRate: RISK_FREE_RATE, volatility: nearAtm.iv / 100, isCall: true })
      : null;
  const atmPutGreeks =
    atmPut && nearAtm.iv != null
      ? blackScholesGreeks({ spot: price, strike: atmPut.strike, timeToExpiryYears: timeToExpiry, riskFreeRate: RISK_FREE_RATE, volatility: nearAtm.iv / 100, isCall: false })
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
