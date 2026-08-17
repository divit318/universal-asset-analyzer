/**
 * Decision → executable action resolution for the Decision Center.
 *
 * Every recommendation already carries the exact `PortfolioChange` the engine
 * simulated (`recommendation.change` — "so the UI can re-simulate or execute
 * it", per engines/recommend.ts). This module is the missing half of that
 * contract: it maps the change onto the ONE write path that already exists for
 * it, so the Decision Center can offer a real next step instead of narrating.
 *
 *   buy of a symbol not held   → POST /api/portfolio/buy        (BuyDecisionDialog)
 *   buy of a held symbol       → POST /api/portfolio/manage     (ManageHoldingModal, buy)
 *   partial sell               → POST /api/portfolio/manage     (ManageHoldingModal, sell)
 *   full exit                  → POST /api/portfolio/manage     (ManageHoldingModal, sell all)
 *   target-weight change       → the Optimize tab (its executor owns target plans)
 *
 * No trade math lives here — sizing came from the engine, execution goes
 * through the same Transaction Engine every other write path uses. The one
 * rule this file enforces itself is the ledger's own: a manually-valued asset
 * (`manual:` id — the same prefix test ManageHoldingModal and
 * engines/transaction.ts's isIndivisibleHolding apply) has no share ledger, so
 * a PARTIAL trim of one is advice the ledger cannot execute, and we say so
 * rather than offering a button that would be refused.
 *
 * Pure and side-effect free — exported for tests.
 */

import type { DecisionCard } from "@/lib/portfolio/engines/decision";
import type { Holding } from "@/lib/portfolio/model/types";

export type DecisionExecution =
  /** Open a brand-new position: the gap-fill ADD path. */
  | { kind: "buy_new"; symbol: string; name: string; amount: number }
  /** Add to a position already in the book. */
  | { kind: "buy_existing"; holding: Holding; amount: number }
  /** Sell part or all of an existing holding. `full` = dispose of the whole position. */
  | { kind: "sell"; holding: Holding; amount: number; full: boolean }
  /** A trim of a manually-valued asset — real advice, but no partial-sell trade exists for it. */
  | { kind: "manual_partial"; holding: Holding }
  /** A target-weight change — executed by the Optimize tab's plan executor. */
  | { kind: "rebalance" }
  /**
   * A discovery card: an opportunity to INVESTIGATE, deliberately not a trade
   * button. The primary step is the research page; buying (if the research
   * convinces) goes through the normal buy flow from there.
   */
  | { kind: "investigate"; symbol: string }
  /** The holding this decision concerns is no longer in the book. */
  | { kind: "stale" };

/** Mirrors the value-terms dust test in engines/transaction.ts's isFullDisposal. */
function coversWholePosition(amount: number, valueBase: number): boolean {
  const residue = valueBase - amount;
  if (residue <= 0) return true;
  return residue < 1 && residue < valueBase * 0.01;
}

export function resolveDecisionExecution(
  decision: DecisionCard,
  holdings: Holding[],
): DecisionExecution {
  const rec = decision.recommendation;
  const change = rec.change;

  // Discovery proposals are research opportunities, never one-click trades —
  // the action type decides this BEFORE the change shape is consulted, so a
  // simulated buy inside a discovery card cannot leak a "Buy" button.
  if (rec.action === "INVESTIGATE") {
    return rec.symbol ? { kind: "investigate", symbol: rec.symbol } : { kind: "stale" };
  }

  switch (change.kind) {
    case "buy": {
      const symbol = (change.holding.symbol ?? rec.symbol)?.toUpperCase() ?? null;
      // A candidate the book already holds is a top-up, not an opening buy —
      // route it through the existing-holding path so avg cost keeps averaging.
      const held = symbol
        ? holdings.find((h) => h.symbol?.toUpperCase() === symbol && !h.id.startsWith("manual:"))
        : undefined;
      if (held) return { kind: "buy_existing", holding: held, amount: rec.amount };
      if (!symbol) return { kind: "stale" };
      return { kind: "buy_new", symbol, name: change.holding.name, amount: rec.amount };
    }

    case "sell": {
      const holding = holdings.find((h) => h.id === change.holdingId);
      if (!holding) return { kind: "stale" };
      const full = rec.action === "SELL" || coversWholePosition(rec.amount, holding.valuation.valueBase);
      if (holding.id.startsWith("manual:") && !full) return { kind: "manual_partial", holding };
      return { kind: "sell", holding, amount: rec.amount, full };
    }

    case "target":
      return { kind: "rebalance" };
  }
}

/** The primary button's label — one verb, the subject, the size. */
export function executionLabel(exec: DecisionExecution): string | null {
  switch (exec.kind) {
    case "buy_new":
      return `Buy ${exec.symbol}`;
    case "buy_existing":
      return `Buy more ${exec.holding.symbol ?? exec.holding.name}`;
    case "sell":
      return exec.full
        ? `Sell all ${exec.holding.symbol ?? exec.holding.name}`
        : `Sell ${exec.holding.symbol ?? exec.holding.name}`;
    case "rebalance":
      return "Open in Optimize";
    case "investigate":
      return `Research ${exec.symbol}`;
    case "manual_partial":
    case "stale":
      return null;
  }
}
