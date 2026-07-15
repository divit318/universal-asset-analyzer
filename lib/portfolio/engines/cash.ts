/**
 * New Cash Allocation Engine.
 *
 * The old `computeCashAllocation()` could only route new cash into positions the
 * user ALREADY OWNED (or, failing that, the top-composite names among them). If
 * your portfolio was 100% tech stocks, its advice on a $50k inflow was: buy more
 * tech stocks. It could not say "hold it", "buy bonds", or "you have no inflation
 * hedge" — not because it judged otherwise, but because it had no vocabulary for
 * an asset it didn't already hold.
 *
 * This engine allocates across the ENTIRE investable universe — existing holdings,
 * every candidate exposure, and cash itself — by greedy marginal improvement: at
 * each step it asks the real engines which tranche does the most good, and puts the
 * money there. "Keep it in cash" is a legitimate outcome and will win when it
 * genuinely should.
 */

import { CANDIDATES, candidateToRaw } from "./candidates";
import { applyChange, evaluate, simulate, type PortfolioEvaluation, type PortfolioChange } from "./simulate";
import { normalizeHoldings } from "../model/holding";
import type { Holding, MarketContext, RawHolding } from "../model/types";
import { PORTFOLIO_CLASS_LABEL } from "../model/types";

export interface CashAllocationItem {
  symbol: string | null;
  name: string;
  assetClass: string;
  dollarAmount: number;
  shareCount: number | null;
  /** Weight this position will have AFTER the cash is deployed. */
  resultingWeight: number;
  reason: string;
  /** Health-score improvement attributable to this tranche. */
  healthDelta: number;
}

export interface CashAllocationPlan {
  cashAmount: number;
  items: CashAllocationItem[];
  /** Amount deliberately left in cash. */
  heldAsCash: number;
  /** Total measured health improvement from the whole plan. */
  totalHealthDelta: number;
  summary: string;
}

/** Cash held as cash — the option the old engine could not represent. */
function cashRaw(amount: number): RawHolding {
  return {
    id: "candidate:cash",
    assetClass: "cash",
    symbol: null,
    name: "Cash",
    currency: "USD",
    quantity: amount,
    unit: "currency",
    costBasis: amount,
    acquiredAt: new Date().toISOString(),
    manualValue: null,
    manualValueAsOf: null,
    // Assume a competitive money-market yield rather than 0% — leaving cash idle at
    // 0% is a choice the user can make, but it isn't the honest default for
    // "cash you have just decided to hold".
    meta: { candidate: true, yieldPct: 4.3, vehicle: "Money market / T-bills" },
  };
}

interface Option {
  key: string;
  label: string;
  symbol: string | null;
  assetClass: string;
  reason: string;
  build: (amount: number) => Holding | null;
}

function buildOptions(evaluation: PortfolioEvaluation, ctx: MarketContext): Option[] {
  const options: Option[] = [];

  // 1. Every candidate exposure.
  for (const c of CANDIDATES) {
    options.push({
      key: `cand:${c.symbol}`,
      label: c.name,
      symbol: c.symbol,
      assetClass: c.assetClass,
      reason: c.rationale,
      build: (amount) => {
        const price = ctx.quotes.get(c.symbol.toUpperCase())?.price ?? null;
        const { holdings } = normalizeHoldings([candidateToRaw(c, amount, price)], ctx);
        return holdings[0] ?? null;
      },
    });
  }

  // 2. Adding to existing holdings — but only ones we can actually justify. A
  //    high score at low confidence is not a reason to buy more of something.
  for (const h of evaluation.holdings) {
    if (h.liquidity === "illiquid") continue;  // can't "add $5k" to a house
    if (!h.score || h.score.score < 55 || h.score.confidence < 45) continue;

    options.push({
      key: `add:${h.id}`,
      label: h.name,
      symbol: h.symbol,
      assetClass: h.assetClass,
      reason: `Existing holding scoring ${h.score.score}/100 at ${h.score.confidence}% confidence. ${h.score.why[0] ?? ""}`.trim(),
      // Resizing happens in applyChange(), so the tranche amount isn't needed here.
      build: () => h,
    });
  }

  // 3. Hold it as cash.
  options.push({
    key: "cash",
    label: "Cash",
    symbol: null,
    assetClass: "cash",
    reason: "Holding cash is the right answer when nothing else improves the portfolio — it preserves optionality and funds the next opportunity.",
    build: (amount) => {
      const { holdings } = normalizeHoldings([cashRaw(amount)], ctx);
      return holdings[0] ?? null;
    },
  });

  return options;
}

/**
 * Greedy marginal allocation.
 *
 * Deploy the cash in tranches; at each step, simulate every option and take the one
 * that improves the portfolio most. This naturally produces DIVERSIFIED advice
 * without any rule telling it to diversify: once a tranche of bonds has fixed the
 * duration gap, the next tranche of bonds helps less than something else, so the
 * engine moves on. Diminishing returns fall out of the simulation rather than being
 * imposed by a heuristic.
 */
export function computeCashAllocation(
  evaluation: PortfolioEvaluation,
  cashAmount: number,
  ctx: MarketContext,
  tranches = 5,
): CashAllocationPlan {
  if (cashAmount <= 0) {
    return { cashAmount, items: [], heldAsCash: 0, totalHealthDelta: 0, summary: "No cash to allocate." };
  }

  const options = buildOptions(evaluation, ctx);
  const trancheSize = cashAmount / tranches;

  const allocated = new Map<string, { option: Option; amount: number; healthDelta: number }>();
  let current = evaluation;
  let totalDelta = 0;

  for (let t = 0; t < tranches; t++) {
    let best: { option: Option; delta: number; change: PortfolioChange } | null = null;

    for (const opt of options) {
      const holding = opt.build(trancheSize);
      if (!holding) continue;

      const change: PortfolioChange = { kind: "buy", holding, amount: trancheSize };
      const { impact } = simulate(current, [change], ctx);

      if (!best || impact.healthDelta > best.delta) {
        best = { option: opt, delta: impact.healthDelta, change };
      }
    }

    if (!best) break;

    const prev = allocated.get(best.option.key);
    allocated.set(best.option.key, {
      option: best.option,
      amount: (prev?.amount ?? 0) + trancheSize,
      healthDelta: (prev?.healthDelta ?? 0) + best.delta,
    });
    totalDelta += best.delta;

    // Commit the tranche so the next iteration sees diminishing returns.
    current = evaluate(applyChange(current.holdings, best.change), ctx);
  }

  const finalTotal = current.totalValue;
  const items: CashAllocationItem[] = [];
  let heldAsCash = 0;

  for (const { option, amount, healthDelta } of allocated.values()) {
    if (option.key === "cash") {
      heldAsCash = Math.round(amount);
      continue;
    }
    const price = option.symbol ? ctx.quotes.get(option.symbol.toUpperCase())?.price ?? null : null;
    const resulting = current.holdings.find(
      (h) => h.symbol === option.symbol || h.id === option.key.replace(/^add:/, ""),
    );

    items.push({
      symbol: option.symbol,
      name: option.label,
      assetClass: PORTFOLIO_CLASS_LABEL[option.assetClass as keyof typeof PORTFOLIO_CLASS_LABEL] ?? option.assetClass,
      dollarAmount: Math.round(amount),
      shareCount: price != null && price > 0 ? Math.floor(amount / price) : null,
      resultingWeight: resulting
        ? Math.round((resulting.valuation.valueBase / Math.max(finalTotal, 1)) * 1000) / 10
        : Math.round((amount / Math.max(finalTotal, 1)) * 1000) / 10,
      reason: option.reason,
      healthDelta: Math.round(healthDelta * 10) / 10,
    });
  }

  items.sort((a, b) => b.dollarAmount - a.dollarAmount);

  const summary =
    items.length === 0
      ? `The portfolio is already well-balanced. Holding the full $${cashAmount.toLocaleString()} in cash is the honest recommendation — no available exposure measurably improves it.`
      : `Deploying $${(cashAmount - heldAsCash).toLocaleString()} across ${items.length} ${items.length === 1 ? "position" : "positions"}` +
        (heldAsCash > 0 ? `, holding $${heldAsCash.toLocaleString()} in cash` : "") +
        `. Projected health improvement: ${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)} points.`;

  return {
    cashAmount,
    items,
    heldAsCash,
    totalHealthDelta: Math.round(totalDelta * 10) / 10,
    summary,
  };
}
