/**
 * Deterministic two-stage DCF — the single source of truth for discounted cash
 * flow valuation in UAA.
 *
 * Pure functions only: no fetch, no database, no React. That is what lets the
 * valuation UI (client) and the Excel export (server) share one implementation
 * instead of maintaining two that silently disagree.
 *
 * Unit convention: cash amounts in whole currency units, every rate in percent
 * (15 means 15%) so assumptions round-trip through text inputs unchanged.
 * Currency is a display concern and deliberately absent from this module.
 */

export const PROJECTION_YEARS = 10;
export const STAGE_ONE_YEARS = 5;

export interface DcfAssumptions {
  /** Trailing free cash flow the projection starts from. */
  baseFcf: number;
  /** FCF growth applied to years 1–5, in percent. */
  growthRate1: number;
  /** FCF growth reached by year 10, in percent. Interpolated from year 6. */
  growthRate2: number;
  /** Perpetuity growth rate after year 10, in percent. */
  terminalGrowth: number;
  /** WACC, in percent. */
  discountRate: number;
  sharesOutstanding: number;
  /** Positive = net debt, negative = net cash. */
  netDebt: number;
}

export type DcfInvalidReason =
  | "non_finite_inputs"
  | "no_shares"
  | "wacc_below_terminal_growth";

export interface FcfYear {
  year: number;
  /** Growth applied in this year, in percent. */
  growthApplied: number;
  fcf: number;
  pv: number;
  cumulativePv: number;
}

export interface DcfResult {
  /** Null when the model is not computable — see `invalidReason`. */
  fairValuePerShare: number | null;
  projection: FcfYear[];
  /** PV of the explicit 10-year forecast period. */
  pvExplicit: number;
  /** Undiscounted Gordon Growth terminal value. */
  terminalValue: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  equityValue: number;
  /** Share of enterprise value coming from the terminal value, 0–1. */
  terminalValueShare: number;
  invalidReason: DcfInvalidReason | null;
}

/**
 * Growth rate applied in a given projection year, in percent.
 *
 * Flat at `growthRate1` through year 5, then a linear fade so that year 10
 * lands exactly on `growthRate2`.
 */
export function growthForYear(
  year: number,
  growthRate1: number,
  growthRate2: number,
): number {
  if (year <= STAGE_ONE_YEARS) return growthRate1;
  const fadeYears = PROJECTION_YEARS - STAGE_ONE_YEARS;
  return growthRate1 + ((growthRate2 - growthRate1) * (year - STAGE_ONE_YEARS)) / fadeYears;
}

/** Why this assumption set cannot be valued, or null when it can. */
export function dcfInvalidReason(a: DcfAssumptions): DcfInvalidReason | null {
  const numbers = [
    a.baseFcf, a.growthRate1, a.growthRate2, a.terminalGrowth,
    a.discountRate, a.sharesOutstanding, a.netDebt,
  ];
  if (!numbers.every((n) => Number.isFinite(n))) return "non_finite_inputs";
  if (a.sharesOutstanding <= 0) return "no_shares";
  // Gordon Growth diverges once growth reaches the discount rate.
  if (a.discountRate <= a.terminalGrowth) return "wacc_below_terminal_growth";
  return null;
}

export const DCF_INVALID_MESSAGE: Record<DcfInvalidReason, string> = {
  non_finite_inputs: "One or more assumptions is not a number.",
  no_shares: "Share count must be greater than zero.",
  wacc_below_terminal_growth:
    "WACC must exceed the terminal growth rate — the Gordon Growth Model breaks down otherwise.",
};

function emptyResult(invalidReason: DcfInvalidReason): DcfResult {
  return {
    fairValuePerShare: null,
    projection: [],
    pvExplicit: 0,
    terminalValue: 0,
    pvTerminalValue: 0,
    enterpriseValue: 0,
    equityValue: 0,
    terminalValueShare: 0,
    invalidReason,
  };
}

/** Year-by-year FCF, discounted. Callers should check `dcfInvalidReason` first. */
export function projectFcf(a: DcfAssumptions): FcfYear[] {
  const wacc = a.discountRate / 100;
  const rows: FcfYear[] = [];
  let fcf = a.baseFcf;
  let cumulativePv = 0;
  for (let year = 1; year <= PROJECTION_YEARS; year++) {
    const growthApplied = growthForYear(year, a.growthRate1, a.growthRate2);
    fcf = fcf * (1 + growthApplied / 100);
    const pv = fcf / Math.pow(1 + wacc, year);
    cumulativePv += pv;
    rows.push({ year, growthApplied, fcf, pv, cumulativePv });
  }
  return rows;
}

/**
 * Value the assumption set.
 *
 * A negative `fairValuePerShare` is returned as-is rather than clamped to zero:
 * it means net debt exceeds enterprise value, which is information the caller
 * should be able to show.
 */
export function runDcf(a: DcfAssumptions): DcfResult {
  const reason = dcfInvalidReason(a);
  if (reason) return emptyResult(reason);

  const wacc = a.discountRate / 100;
  const g = a.terminalGrowth / 100;

  const projection = projectFcf(a);
  const finalYear = projection[projection.length - 1];
  const pvExplicit = finalYear.cumulativePv;

  const terminalValue = (finalYear.fcf * (1 + g)) / (wacc - g);
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc, PROJECTION_YEARS);
  const enterpriseValue = pvExplicit + pvTerminalValue;
  const equityValue = enterpriseValue - a.netDebt;

  return {
    fairValuePerShare: equityValue / a.sharesOutstanding,
    projection,
    pvExplicit,
    terminalValue,
    pvTerminalValue,
    enterpriseValue,
    equityValue,
    terminalValueShare: enterpriseValue !== 0 ? pvTerminalValue / enterpriseValue : 0,
    invalidReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Scenarios                                                                   */
/* -------------------------------------------------------------------------- */

export const SCENARIO_WACC_DELTA_PP = { bull: -1, bear: 2 } as const;

const MIN_GROWTH_DELTA_PP = 2;
const MAX_GROWTH_DELTA_PP = 15;

/**
 * Bull/bear growth spread in percentage points, applied additively.
 *
 * Previously the scenarios multiplied base growth by 1.5 and 0.5, which inverts
 * them for any shrinking business — a company declining 10% got a "bull" case of
 * −15% and a "bear" case of −5% — and collapses all three cases onto one number
 * when growth is exactly zero. Half of |growth| reproduces the old spread
 * exactly in the ordinary positive case (15% → ±7.5pp) while staying correctly
 * ordered at and below zero. The floor keeps zero-growth names from producing
 * three identical scenarios; the cap stops hypergrowth names from projecting an
 * absurd bull case.
 */
export function scenarioGrowthDelta(growthPct: number): number {
  const half = Math.abs(growthPct) * 0.5;
  return Math.min(Math.max(half, MIN_GROWTH_DELTA_PP), MAX_GROWTH_DELTA_PP);
}

export interface DcfScenarios {
  bear: DcfResult;
  base: DcfResult;
  bull: DcfResult;
  bearAssumptions: DcfAssumptions;
  bullAssumptions: DcfAssumptions;
}

export function buildScenarios(base: DcfAssumptions): DcfScenarios {
  const d1 = scenarioGrowthDelta(base.growthRate1);
  const d2 = scenarioGrowthDelta(base.growthRate2);

  const bullAssumptions: DcfAssumptions = {
    ...base,
    growthRate1: base.growthRate1 + d1,
    growthRate2: base.growthRate2 + d2,
    // Never let the bull case cut WACC down to the terminal growth rate.
    discountRate: Math.max(
      base.discountRate + SCENARIO_WACC_DELTA_PP.bull,
      base.terminalGrowth + 0.5,
    ),
  };
  const bearAssumptions: DcfAssumptions = {
    ...base,
    growthRate1: base.growthRate1 - d1,
    growthRate2: base.growthRate2 - d2,
    discountRate: base.discountRate + SCENARIO_WACC_DELTA_PP.bear,
  };

  return {
    bear: runDcf(bearAssumptions),
    base: runDcf(base),
    bull: runDcf(bullAssumptions),
    bearAssumptions,
    bullAssumptions,
  };
}

/** Human-readable delta between a scenario and its base case. */
export function describeScenario(base: DcfAssumptions, scenario: DcfAssumptions): string {
  const dg = scenario.growthRate1 - base.growthRate1;
  const dw = scenario.discountRate - base.discountRate;
  const sign = (n: number) => (n >= 0 ? "+" : "");
  return (
    `Growth ${sign(dg)}${dg.toFixed(1)}pp, WACC ${sign(dw)}${dw.toFixed(1)}pp → ` +
    `${scenario.growthRate1.toFixed(1)}%/${scenario.growthRate2.toFixed(1)}% @ ${scenario.discountRate.toFixed(1)}%`
  );
}

/* -------------------------------------------------------------------------- */
/* Sensitivity                                                                 */
/* -------------------------------------------------------------------------- */

export const TERMINAL_GROWTH_RANGE = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0];

/** Seven integer WACC values centred on the base case. */
export function buildWaccRange(centerWacc: number): number[] {
  const center = Math.round(Math.max(5, Math.min(25, centerWacc)));
  return [-3, -2, -1, 0, 1, 2, 3].map((delta) => center + delta);
}

export interface DcfSensitivity {
  waccRange: number[];
  terminalGrowthRange: number[];
  /** Fair value per share; null where that WACC/TG pair is not computable. */
  table: (number | null)[][];
}

export function buildSensitivity(base: DcfAssumptions): DcfSensitivity {
  const waccRange = buildWaccRange(base.discountRate);
  const table = waccRange.map((discountRate) =>
    TERMINAL_GROWTH_RANGE.map(
      (terminalGrowth) =>
        runDcf({ ...base, discountRate, terminalGrowth }).fairValuePerShare,
    ),
  );
  return { waccRange, terminalGrowthRange: TERMINAL_GROWTH_RANGE, table };
}

/* -------------------------------------------------------------------------- */
/* Derived measures                                                            */
/* -------------------------------------------------------------------------- */

/** Discount of the market price to fair value, in percent. */
export function marginOfSafety(
  fairValuePerShare: number | null,
  price: number | null,
): number | null {
  if (fairValuePerShare == null || fairValuePerShare <= 0) return null;
  if (price == null || price <= 0) return null;
  return ((fairValuePerShare - price) / fairValuePerShare) * 100;
}

/** Return implied by fair value from today's price, in percent. */
export function impliedUpside(
  fairValuePerShare: number | null,
  price: number | null,
): number | null {
  if (fairValuePerShare == null || price == null || price <= 0) return null;
  return ((fairValuePerShare - price) / price) * 100;
}

/**
 * Text tone for a margin of safety: ≥20% is a real discount (the classic
 * value-investing threshold), 0–20% is thin, negative means paying above fair
 * value. Was duplicated verbatim across the valuation page, the valuation
 * register, and the research valuation strip — one place now.
 */
export function marginOfSafetyTone(mos: number | null): string {
  if (mos == null) return "text-muted";
  if (mos >= 20) return "text-positive";
  if (mos >= 0) return "text-yellow-500 light:text-yellow-700";
  return "text-negative";
}

/* -------------------------------------------------------------------------- */
/* Input parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Parse a rate the user typed into an assumption field.
 *
 * An empty field falls back to the default; anything numeric is taken literally,
 * including zero. The previous `parseFloat(value) || fallback` idiom replaced a
 * typed zero with the default, making zero growth or zero terminal growth
 * impossible to express.
 */
export function parseAssumptionPercent(raw: string, fallback: number): number {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True when a typed rate is either empty or a valid number. */
export function isValidPercentInput(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed === "" || Number.isFinite(Number(trimmed));
}

/** Parse "93.7B" / "15.2M" / "500K" / "1.2T" / plain digits into a number. */
export function parseAmount(raw: string): number {
  const clean = raw.trim().replace(/,/g, "");
  if (!clean) return NaN;
  const match = /^([+-]?\d+\.?\d*)([KkMmBbTt]?)$/.exec(clean);
  if (!match) return Number(clean);
  const n = Number(match[1]);
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const suffix = match[2].toUpperCase();
  return suffix ? n * (mult[suffix] ?? 1) : n;
}

/** Inverse of `parseAmount`, for pre-filling the amount fields. */
export function formatAmountShorthand(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return String(n);
}
