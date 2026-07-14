/**
 * Black-Scholes Greeks — pure, deterministic option pricing math. Yahoo's
 * options chain gives implied volatility but not Delta/Gamma/Theta/Vega
 * ("for advanced Greeks... you may need to calculate them separately",
 * per yahoo-finance2's own options module docs) — this computes them from
 * data already on hand (spot, strike, time to expiry, IV) rather than
 * requiring a new external provider, the same "market-data only" approach
 * every other Research Hub asset class uses.
 *
 * Not a full pricing engine (no dividend yield, no American-exercise
 * early-exercise premium) — European-style approximation, standard for a
 * research/education display rather than a trading desk.
 */

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number; // per calendar day
  vega: number; // per 1 percentage-point change in IV (e.g. 28% → 29%)
}

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (~1.5e-7 max error). */
function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BlackScholesInput {
  spot: number;
  strike: number;
  timeToExpiryYears: number;
  riskFreeRate: number; // annual decimal, e.g. 0.0425
  volatility: number; // annual decimal IV, e.g. 0.28
  isCall: boolean;
}

/** Returns null when inputs are too degenerate to price meaningfully (expired, zero vol, non-positive spot/strike). */
export function blackScholesGreeks(input: BlackScholesInput): Greeks | null {
  const { spot, strike, timeToExpiryYears: t, riskFreeRate: r, volatility: sigma, isCall } = input;
  if (spot <= 0 || strike <= 0 || t <= 0 || sigma <= 0) return null;

  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + (sigma * sigma) / 2) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf1 = normalPdf(d1);

  const delta = isCall ? normalCdf(d1) : normalCdf(d1) - 1;
  const gamma = pdf1 / (spot * sigma * sqrtT);
  const vega = (spot * pdf1 * sqrtT) / 100; // per 1 vol point

  const thetaAnnual = isCall
    ? -(spot * pdf1 * sigma) / (2 * sqrtT) - r * strike * Math.exp(-r * t) * normalCdf(d2)
    : -(spot * pdf1 * sigma) / (2 * sqrtT) + r * strike * Math.exp(-r * t) * normalCdf(-d2);
  const theta = thetaAnnual / 365;

  return { delta, gamma, theta, vega };
}
