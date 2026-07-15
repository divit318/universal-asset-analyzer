/**
 * The Transaction Engine — turns selected Optimize-tab trades into real,
 * reversible portfolio mutations.
 *
 * Architecture (matches the spec exactly):
 *
 *   Current Holdings
 *     -> Generated Trade Instructions   (optimize.ts's TargetWeight[], filtered to a selection)
 *     -> Transaction Engine             (this file)
 *     -> Transaction Ledger             (lib/db.ts's portfolio_lot — already existed; addUniversalLot
 *                                         APPENDS instead of replacing, so trade history and
 *                                         average-cost/realized-P&L stay correct via the existing
 *                                         lib/portfolio-lots.ts aggregation — no new math)
 *     -> Updated Holdings               (listRawHoldings() next read reflects it automatically)
 *     -> Portfolio Recalculation        (the caller re-runs evaluate()/buildPortfolioReport())
 *     -> Recommendation Refresh         (computeRecommendations() re-run against the new state
 *                                         naturally excludes whatever was just implemented)
 *
 * PREVIEW reuses the exact same substrate optimize.ts already uses internally for its own
 * impact numbers: a `{ kind: "target", holdingId, targetWeight }` PortfolioChange per selected
 * trade, run through simulate.ts's applyChanges()/evaluate()/estimateImpact(). Nothing here
 * duplicates that math — it is exposed for an arbitrary SUBSET of trades (and, for partial
 * implementation, an interpolated target weight) rather than only the full plan.
 *
 * EXECUTION is the one genuinely new piece: converting a trade's dollar delta into a real
 * ledger transaction (shares at the current price), because "target weight" is a simulation
 * concept — the ledger only understands buy/sell N units at a price.
 */

import {
  addUniversalLot,
  executeTradeBatch,
  snapshotPortfolio,
  restoreSnapshot,
  getSnapshot,
  listSnapshots,
  type PortfolioSnapshotSummary,
  type PortfolioSnapshot,
} from "../../db";
import { applyChanges, evaluate, estimateImpact, type PortfolioChange, type PortfolioEvaluation, type ImpactEstimate } from "./simulate";
import { computeRecommendations } from "./recommend";
import { buildDecisionCards, type DecisionCard } from "./decision";
import type { PortfolioAssetClass, MarketContext } from "../model/types";
import type { Objective } from "./optimize";

/* -------------------------------------------------------------------------- */
/* Preview — no writes                                                        */
/* -------------------------------------------------------------------------- */

export interface SelectedTarget {
  holdingId: string;
  /** The weight this holding should move to. For a partial implementation this
   *  is already interpolated between current and full-target weight — the
   *  caller (API route) computes that, this function only simulates it. */
  targetWeight: number;
}

export interface PreviewResult {
  after: PortfolioEvaluation;
  impact: ImpactEstimate;
  decisions: DecisionCard[];
}

/** Simulate a selected subset of trades WITHOUT writing anything. */
export function previewTrades(
  evaluation: PortfolioEvaluation,
  ctx: MarketContext,
  selected: SelectedTarget[],
): PreviewResult {
  const changes: PortfolioChange[] = selected.map((t) => ({
    kind: "target",
    holdingId: t.holdingId,
    targetWeight: t.targetWeight,
  }));

  const afterHoldings = applyChanges(evaluation.holdings, changes);
  const after = evaluate(afterHoldings, ctx);
  const impact = estimateImpact(evaluation, after);

  // Re-running recommendations against the HYPOTHETICAL state is what lets the
  // preview show "remaining recommendations" (Feature 8) before anything is
  // actually implemented — the same engine, just fed a different portfolio.
  const recs = computeRecommendations(after, ctx);
  const decisions = buildDecisionCards(recs, after);

  return { after, impact, decisions };
}

/* -------------------------------------------------------------------------- */
/* Execute — real, atomic, reversible writes                                  */
/* -------------------------------------------------------------------------- */

export interface TradeToExecute {
  holdingId: string;
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  /** Positive = buy, negative = sell. Already scaled by any partial-implementation percentage. */
  dollarDelta: number;
  reason: string;
  recommendationId?: string | null;
}

export interface ExecuteResult {
  /** The snapshot taken immediately before any write — pass this to undoTransaction() to revert. */
  snapshotId: string;
  executedCount: number;
  /** Trades that couldn't be executed (holding vanished, zero/invalid price, etc.) — never silently dropped. */
  skipped: { holdingId: string; reason: string }[];
}

export function summaryOf(evaluation: PortfolioEvaluation): PortfolioSnapshotSummary {
  return {
    totalValue: evaluation.totalValue,
    totalCost: evaluation.holdings.reduce((s, h) => s + h.costBasisBase, 0),
    health: evaluation.health.total,
    healthGrade: evaluation.health.grade,
    volatility: evaluation.risk.annualizedVolatility,
    topAssetClassWeight: evaluation.risk.topAssetClassWeight,
    allocation: evaluation.allocation.byAssetClass.slices.map((s) => ({ assetClass: s.key, weight: s.weight })),
  };
}

export interface LotWriteInstruction {
  symbol: string;
  name: string;
  shares: number;
  price: number;
  kind: "buy" | "sell";
  assetClass: PortfolioAssetClass;
  currency?: string;
  unit?: string;
  meta?: Record<string, unknown> | null;
}

export interface BuildLotWritesResult {
  lots: LotWriteInstruction[];
  manualAssetIdsToDelete: string[];
  skipped: { holdingId: string; reason: string }[];
}

/**
 * Pure conversion: TradeToExecute[] -> real ledger writes. Split out from
 * executeTrades() so this — the part with actual decision logic (sell-cap,
 * cash-symbol synthesis, manual-asset full-exit handling, skip reasons) — is
 * unit-testable without touching the database. No DB, no I/O.
 */
export function buildLotWrites(
  evaluation: PortfolioEvaluation,
  trades: TradeToExecute[],
  meta: { objective: Objective; snapshotId?: string | null },
): BuildLotWritesResult {
  const lots: LotWriteInstruction[] = [];
  const manualAssetIdsToDelete: string[] = [];
  const skipped: { holdingId: string; reason: string }[] = [];

  for (const t of trades) {
    // Manual assets (real estate, private markets, alternatives, structured
    // products) have no lot ledger and no partial-quantity concept — a stake
    // is a single indivisible unit, so any trade against one is a full exit.
    if (t.holdingId.startsWith("manual:")) {
      manualAssetIdsToDelete.push(t.holdingId.slice("manual:".length));
      continue;
    }

    const holding = evaluation.holdings.find((h) => h.id === t.holdingId);
    if (!holding || holding.valuation.valueBase <= 0 || holding.quantity <= 0) {
      skipped.push({ holdingId: t.holdingId, reason: "Holding not found or has no value" });
      continue;
    }

    const price = holding.valuation.valueBase / holding.quantity;
    if (!Number.isFinite(price) || price <= 0) {
      skipped.push({ holdingId: t.holdingId, reason: "No valid price to trade at" });
      continue;
    }

    const ledgerSymbol = holding.assetClass === "cash" ? `CASH-${holding.currency}` : t.symbol;
    if (!ledgerSymbol) {
      skipped.push({ holdingId: t.holdingId, reason: "No ticker to record the trade against" });
      continue;
    }

    const isBuy = t.dollarDelta > 0;
    const rawShares = Math.abs(t.dollarDelta) / price;
    // A sell can never exceed what's actually held — price drift between when
    // the trade was proposed and now could otherwise push a "full exit" negative.
    const shares = isBuy ? rawShares : Math.min(rawShares, holding.quantity);
    if (shares <= 0) {
      skipped.push({ holdingId: t.holdingId, reason: "Computed trade size was zero" });
      continue;
    }

    lots.push({
      symbol: ledgerSymbol,
      name: t.name,
      shares,
      price,
      kind: isBuy ? "buy" : "sell",
      assetClass: t.assetClass,
      currency: holding.currency,
      unit: holding.unit,
      meta: { reason: t.reason, objective: meta.objective, recommendationId: t.recommendationId ?? null, snapshotId: meta.snapshotId ?? null },
    });
  }

  return { lots, manualAssetIdsToDelete, skipped };
}

/**
 * Execute a batch of trades against the REAL portfolio. Snapshots the current
 * state first (for undo), then writes every trade as one atomic unit — either
 * all of it lands or none of it does.
 */
export function executeTrades(
  evaluation: PortfolioEvaluation,
  trades: TradeToExecute[],
  objective: Objective,
): ExecuteResult {
  const snapshotId = snapshotPortfolio("pre-execution", objective, summaryOf(evaluation));
  const { lots, manualAssetIdsToDelete, skipped } = buildLotWrites(evaluation, trades, { objective, snapshotId });

  executeTradeBatch(lots, manualAssetIdsToDelete);

  return { snapshotId, executedCount: lots.length + manualAssetIdsToDelete.length, skipped };
}

/** Record a labeled snapshot without executing anything — used for the "after" side of Feature 10. */
export function captureSnapshot(evaluation: PortfolioEvaluation, label: string, objective: Objective | null): string {
  return snapshotPortfolio(label, objective, summaryOf(evaluation));
}

/** Undo — restore the portfolio to exactly how it was right before a transaction. */
export function undoTransaction(snapshotId: string): boolean {
  return restoreSnapshot(snapshotId);
}

export function getPortfolioSnapshot(id: string): PortfolioSnapshot | null {
  return getSnapshot(id);
}

export function listPortfolioSnapshots(limit?: number): PortfolioSnapshot[] {
  return listSnapshots(limit);
}

/** A single trade lot, exposed for callers that need to build one directly (e.g. tests). */
export { addUniversalLot };
export type { PortfolioSnapshot, PortfolioSnapshotSummary };
