/**
 * Cost of capital — one CAPM implementation for the whole app.
 *
 * Mirrors `compute_wacc` in engine/models/monte_carlo.py so the deterministic
 * DCF and the 50k-path Monte Carlo discount at the same rate; tests/valuation.test.ts
 * pins that parity. Before this module, /api/dcf assumed a fixed 70/30 capital
 * structure, used the risk-free rate as the cost of debt, ignored the tax shield
 * and clamped to [8%, 16%] — which put it hundreds of basis points away from the
 * engine on any levered name, and made the two "fair values" incomparable.
 */

import { detectMarket } from "@/lib/market";

export type WaccRegion = "US" | "IN";

interface RegionParams {
  riskFree: number;
  erp: number;
  costOfDebt: number;
  taxRate: number;
}

/**
 * Damodaran 2025 inputs. India carries a higher 10Y GOI yield and ERP.
 *
 * India's pre-tax cost of debt is the GOI 10Y plus a ~200bp large-cap credit
 * spread — it was previously 5%, i.e. BELOW India's own risk-free rate, which
 * understated WACC for every levered Indian name. Static estimates by design
 * (no reliable free live GOI/credit-spread feed); revisit with the vintage.
 * Mirrored by engine/models/monte_carlo.py — tests/valuation.test.ts pins parity.
 */
const REGION_PARAMS: Record<WaccRegion, RegionParams> = {
  US: { riskFree: 0.044, erp: 0.055, costOfDebt: 0.05, taxRate: 0.21 },
  IN: { riskFree: 0.065, erp: 0.060, costOfDebt: 0.085, taxRate: 0.2517 },
};

export const WACC_FLOOR = 0.04;
export const WACC_CEILING = 0.20;

const DEFAULT_BETA = 1.0;
const DEFAULT_DEBT_TO_EQUITY = 0.3;
const MAX_DEBT_WEIGHT = 0.60;
/** Matches the shrinkage clamp the engine applies when it estimates beta. */
const BETA_FLOOR = 0.1;
const BETA_CEILING = 4.0;

export interface WaccInputs {
  beta?: number | null;
  /** Debt/equity as a ratio (1.45), not a percentage (145). */
  debtToEquity?: number | null;
  region?: WaccRegion;
}

export interface WaccBreakdown {
  /** WACC as a fraction. */
  wacc: number;
  /** WACC in percent to one decimal — what the assumption fields show. */
  waccPercent: number;
  costOfEquity: number;
  debtWeight: number;
  beta: number;
  riskFree: number;
  erp: number;
  region: WaccRegion;
  /** True when the raw result hit the [4%, 20%] guard rails. */
  clamped: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Debt share of the capital structure implied by D/E.
 *
 * Uses |D/E| where the engine uses the signed ratio: a negative D/E (negative
 * book equity) would otherwise produce a negative debt weight and push WACC
 * above the cost of equity, which is backwards. The two agree for all
 * non-negative D/E, which is the domain the parity test covers.
 */
export function debtWeightFromRatio(debtToEquity: number | null | undefined): number {
  const de =
    debtToEquity != null && Number.isFinite(debtToEquity)
      ? Math.abs(debtToEquity)
      : DEFAULT_DEBT_TO_EQUITY;
  return Math.min(de / (1 + de), MAX_DEBT_WEIGHT);
}

export function computeWacc(inputs: WaccInputs = {}): WaccBreakdown {
  const region = inputs.region ?? "US";
  const p = REGION_PARAMS[region];

  const beta =
    inputs.beta != null && Number.isFinite(inputs.beta)
      ? clamp(inputs.beta, BETA_FLOOR, BETA_CEILING)
      : DEFAULT_BETA;
  const debtWeight = debtWeightFromRatio(inputs.debtToEquity);
  const costOfEquity = p.riskFree + beta * p.erp;

  const raw =
    (1 - debtWeight) * costOfEquity + debtWeight * p.costOfDebt * (1 - p.taxRate);
  const wacc = clamp(raw, WACC_FLOOR, WACC_CEILING);

  return {
    wacc,
    waccPercent: Math.round(wacc * 1000) / 10,
    costOfEquity,
    debtWeight,
    beta,
    riskFree: p.riskFree,
    erp: p.erp,
    region,
    clamped: wacc !== raw,
  };
}

/** Which set of market parameters applies to a listing. */
export function waccRegionFor(symbol: string, currency?: string | null): WaccRegion {
  const market = detectMarket({
    symbol,
    currency: currency ?? "",
    exchange: null,
    assetType: null,
  });
  return market === "IN" ? "IN" : "US";
}

/**
 * Yahoo reports `financialData.debtToEquity` as a percentage (145 for 1.45x).
 * Convert before handing it to `computeWacc`.
 */
export function debtToEquityFromYahoo(raw: number | null | undefined): number | null {
  return raw != null && Number.isFinite(raw) ? raw / 100 : null;
}
