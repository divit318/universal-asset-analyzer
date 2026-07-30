/**
 * Reverse DCF — what growth rate is the market actually paying for?
 *
 * This is the cheapest genuinely useful thing in valuation: it needs no AI and
 * no opinion about growth. Given everything except growth, it solves for the FCF
 * growth rate that makes the model return today's price.
 *
 * It is *conditional*, and callers must label it as such: the answer depends on
 * the discount rate, terminal growth, share count and net debt handed in. Raise
 * the WACC and the implied growth rises too, though the market has not moved. It
 * is "what would justify this price under these assumptions", never "what the
 * market expects". That single number turns "here is a calculator" into "here is
 * what the market believes, and here is what this business has actually done".
 *
 * It is also what lets a ValuationCase exist for every symbol from first sight,
 * instead of only for the handful the user has run a multi-minute AI pipeline on.
 *
 * Pure: no fetch, no database, no React.
 */

import { runDcf, type DcfAssumptions } from "./dcf";

/**
 * The two-stage model has two growth rates, so solving for "the" implied growth
 * needs a fixed relationship between them. Stage two is held at half of stage
 * one — the same fade the DCF pre-fill has always used — which makes the solved
 * number directly comparable to the assumption the user sees in the field.
 */
export const STAGE_TWO_FADE = 0.5;

/** Search bounds. Outside these, a price-implied growth rate stops being meaningful. */
export const IMPLIED_GROWTH_FLOOR = -50;
export const IMPLIED_GROWTH_CEILING = 100;

const MAX_ITERATIONS = 80;
const RELATIVE_TOLERANCE = 1e-10;

/** Everything the model needs except the growth rates, which are the unknown. */
export interface ReverseDcfInput {
  baseFcf: number;
  terminalGrowth: number;
  discountRate: number;
  sharesOutstanding: number;
  netDebt: number;
  /** The price the market is charging today. */
  price: number;
}

export type ReverseDcfInvalidReason =
  | "non_positive_price"
  | "non_positive_fcf"
  | "assumptions_not_valuable";

export interface ReverseDcfResult {
  /** Y1–5 FCF growth implied by the price, in percent. Null when unsolvable. */
  impliedGrowth: number | null;
  /** The stage-two rate that pairs with it, in percent. */
  impliedGrowthStage2: number | null;
  /**
   * "none" when the solver converged. "below"/"above" mean the price sits
   * outside the search band — the price implies something more extreme than
   * ±the bounds, which is itself the finding.
   */
  bounded: "none" | "below" | "above";
  iterations: number;
  invalidReason: ReverseDcfInvalidReason | null;
}

function unsolvable(invalidReason: ReverseDcfInvalidReason): ReverseDcfResult {
  return {
    impliedGrowth: null,
    impliedGrowthStage2: null,
    bounded: "none",
    iterations: 0,
    invalidReason,
  };
}

/** Assumptions for a candidate growth rate, with stage two faded from it. */
export function assumptionsAtGrowth(input: ReverseDcfInput, growth: number): DcfAssumptions {
  return {
    baseFcf: input.baseFcf,
    growthRate1: growth,
    growthRate2: growth * STAGE_TWO_FADE,
    terminalGrowth: input.terminalGrowth,
    discountRate: input.discountRate,
    sharesOutstanding: input.sharesOutstanding,
    netDebt: input.netDebt,
  };
}

function valueAtGrowth(input: ReverseDcfInput, growth: number): number | null {
  return runDcf(assumptionsAtGrowth(input, growth)).fairValuePerShare;
}

/**
 * Solve for the market-implied growth rate by bisection.
 *
 * Fair value is strictly increasing in growth whenever base FCF is positive,
 * which is what makes bisection valid — and why non-positive FCF is rejected
 * rather than solved: with negative FCF the relationship inverts and "implied
 * growth" has no single meaning.
 */
export function solveImpliedGrowth(input: ReverseDcfInput): ReverseDcfResult {
  if (!Number.isFinite(input.price) || input.price <= 0) return unsolvable("non_positive_price");
  if (!Number.isFinite(input.baseFcf) || input.baseFcf <= 0) return unsolvable("non_positive_fcf");

  // The growth-independent parts must themselves be valuable (WACC > terminal
  // growth, shares > 0) before searching.
  if (runDcf(assumptionsAtGrowth(input, 0)).invalidReason !== null) {
    return unsolvable("assumptions_not_valuable");
  }

  let lo = IMPLIED_GROWTH_FLOOR;
  let hi = IMPLIED_GROWTH_CEILING;
  const valueAtFloor = valueAtGrowth(input, lo);
  const valueAtCeiling = valueAtGrowth(input, hi);
  if (valueAtFloor == null || valueAtCeiling == null) return unsolvable("assumptions_not_valuable");

  // Price below even the collapsing case, or above even the hypergrowth case.
  if (valueAtFloor >= input.price) {
    return {
      impliedGrowth: lo,
      impliedGrowthStage2: lo * STAGE_TWO_FADE,
      bounded: "below",
      iterations: 0,
      invalidReason: null,
    };
  }
  if (valueAtCeiling <= input.price) {
    return {
      impliedGrowth: hi,
      impliedGrowthStage2: hi * STAGE_TWO_FADE,
      bounded: "above",
      iterations: 0,
      invalidReason: null,
    };
  }

  let iterations = 0;
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const mid = (lo + hi) / 2;
    const value = valueAtGrowth(input, mid);
    if (value == null) return unsolvable("assumptions_not_valuable");
    if (Math.abs(value - input.price) / input.price < RELATIVE_TOLERANCE) return {
      impliedGrowth: mid,
      impliedGrowthStage2: mid * STAGE_TWO_FADE,
      bounded: "none",
      iterations,
      invalidReason: null,
    };
    if (value < input.price) lo = mid;
    else hi = mid;
    if (hi - lo < RELATIVE_TOLERANCE) break;
  }

  const solved = (lo + hi) / 2;
  return {
    impliedGrowth: solved,
    impliedGrowthStage2: solved * STAGE_TWO_FADE,
    bounded: "none",
    iterations,
    invalidReason: null,
  };
}

/**
 * The gap between the price-implied growth rate and what the business has
 * delivered, in percentage points. Positive means today's price requires the
 * company to accelerate.
 */
export function impliedGrowthGap(
  impliedGrowth: number | null,
  deliveredGrowth: number | null,
): number | null {
  if (impliedGrowth == null || deliveredGrowth == null) return null;
  if (!Number.isFinite(impliedGrowth) || !Number.isFinite(deliveredGrowth)) return null;
  return impliedGrowth - deliveredGrowth;
}
