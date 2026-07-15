/**
 * Analysis-to-action layer — turns "this is attractive and fits your portfolio"
 * into the concrete, sized next step.
 *
 * The IOS fit scorer already produces a suggested allocation % and $ amount, but
 * the user still had to do the arithmetic: how many shares is that, given what I
 * already hold and today's price? This closes that gap — every research verdict
 * can end in an executable order ("Buy 12 shares (~$1,850) to establish a 4.0%
 * position") plus its portfolio impact.
 *
 * Pure and deterministic — no DB, no network.
 */

import type { FitTier } from "./ios/types";

export type PositionActionKind = "initiate" | "add" | "trim" | "exit" | "hold" | "avoid";

export interface PositionAction {
  kind: PositionActionKind;
  price: number;
  currentShares: number;
  currentValue: number;
  currentPct: number; // current weight in the portfolio
  targetPct: number; // suggested target weight
  targetShares: number;
  /** Shares to transact: positive = buy, negative = sell. */
  deltaShares: number;
  /** Cash to deploy (positive) or raise (negative) to reach target. */
  deltaAmount: number;
  /** True when reaching target would over-concentrate the book. */
  concentrationWarning: boolean;
  headline: string;
  detail: string;
}

export interface PositionActionInput {
  symbol: string;
  price: number;
  /** Total portfolio (holdings) value the target % is measured against. */
  portfolioValue: number;
  currentShares: number;
  /** Suggested target weight from the fit scorer (e.g. 4.0 = 4%). */
  targetPct: number;
  fitTier: FitTier;
  isInPortfolio: boolean;
  concentrationWarning: boolean;
}

function fmtShares(n: number): string {
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a < 1) return a.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (a < 100) return a.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return Math.round(a).toLocaleString("en-US");
}

function fmtMoney(n: number): string {
  return `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

/**
 * Produce a sized, portfolio-aware action from a fit suggestion + live price +
 * current holding. `tol` (the no-trade band) prevents churn on tiny deltas.
 */
export function computePositionAction(input: PositionActionInput): PositionAction {
  const { price, portfolioValue, currentShares, targetPct, fitTier, isInPortfolio } = input;

  const currentValue = currentShares * price;
  const currentPct = portfolioValue > 0 ? (currentValue / portfolioValue) * 100 : 0;
  const targetValue = (portfolioValue * targetPct) / 100;
  const targetShares = price > 0 ? targetValue / price : 0;
  const deltaShares = targetShares - currentShares;
  const deltaAmount = deltaShares * price;

  // No-trade band: ignore deltas below the larger of $50 or 0.5% of the book.
  // This dollar floor alone isn't enough — on a small portfolio, $50 can be
  // half the account, which would swallow a real double-digit-percentage-point
  // drift (e.g. 20.9% actual vs. a 9.0% target) and mislabel it "near target".
  // A weight is only "hold" if it's close in BOTH dollar terms and percentage-
  // point terms, so the tighter of the two constraints always wins.
  const tol = Math.max(50, portfolioValue * 0.005);
  const pctGap = currentPct - targetPct;
  const PCT_TOL = 1.5; // percentage points

  let kind: PositionActionKind;
  if (fitTier === "avoid") {
    kind = isInPortfolio ? "exit" : "avoid";
  } else if (!isInPortfolio) {
    // Same fix as below: a meaningful target weight (e.g. 11% suggested on a
    // tiny test portfolio) shouldn't be mislabeled "doesn't fit" just because
    // 11% of a small book happens to fall under the flat $50 floor.
    kind = targetPct > 0 && (deltaAmount > tol || pctGap < -PCT_TOL) ? "initiate" : "avoid";
  } else if (deltaAmount > tol || pctGap < -PCT_TOL) {
    kind = "add";
  } else if (deltaAmount < -tol || pctGap > PCT_TOL) {
    kind = targetShares <= 0 ? "exit" : "trim";
  } else {
    kind = "hold";
  }

  const shares = fmtShares(deltaShares);
  const amt = fmtMoney(deltaAmount);
  let headline: string;
  let detail: string;

  switch (kind) {
    case "initiate":
      headline = `Buy ${shares} share${Math.abs(deltaShares) === 1 ? "" : "s"} (~${amt})`;
      detail = `Establishes a ${targetPct.toFixed(1)}% starter position. Requires ~${amt} of cash.`;
      break;
    case "add":
      headline = `Buy ${shares} more (~${amt})`;
      detail = `Lifts this position from ${currentPct.toFixed(1)}% to the ${targetPct.toFixed(1)}% target.`;
      break;
    case "trim":
      headline = `Sell ${shares} share${Math.abs(deltaShares) === 1 ? "" : "s"} (~${amt})`;
      detail = `Trims from ${currentPct.toFixed(1)}% toward the ${targetPct.toFixed(1)}% target, raising ~${amt}.`;
      break;
    case "exit":
      headline = `Exit — sell ${fmtShares(currentShares)} share${currentShares === 1 ? "" : "s"} (~${fmtMoney(currentValue)})`;
      detail = fitTier === "avoid" ? "Poor portfolio fit — the model would not hold this." : "Target weight is zero.";
      break;
    case "avoid":
      headline = "Skip — doesn't fit the portfolio";
      detail = "The fit model doesn't recommend a position here right now.";
      break;
    case "hold":
    default:
      headline = "Hold — already near target";
      detail = `Current weight ${currentPct.toFixed(1)}% is within range of the ${targetPct.toFixed(1)}% target.`;
      break;
  }

  return {
    kind,
    price,
    currentShares,
    currentValue,
    currentPct,
    targetPct,
    targetShares,
    deltaShares,
    deltaAmount,
    concentrationWarning: input.concentrationWarning && (kind === "initiate" || kind === "add"),
    headline,
    detail,
  };
}
