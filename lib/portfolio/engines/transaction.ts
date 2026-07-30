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
import { applyTargetPlanConserving, evaluate, estimateImpact, type PortfolioEvaluation, type ImpactEstimate } from "./simulate";
import { computeRecommendations } from "./recommend";
import { buildDecisionCards, type DecisionCard } from "./decision";
import { availableBaseCash, CASH_SETTLEMENT_TOLERANCE } from "./optimize";
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
  // Value-conserving, exactly like execution: the selected holdings move to their
  // target weights and the residual is parked in cash. This is what makes the
  // preview match what the executor actually writes — and what lets the "remaining
  // recommendations" panel below reflect a real post-trade portfolio rather than a
  // value-drifted phantom.
  const afterHoldings = applyTargetPlanConserving(
    evaluation.holdings,
    selected.map((t) => ({ holdingId: t.holdingId, targetWeight: t.targetWeight })),
    ctx,
  );
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
  /**
   * Dollars of buying this batch could not pay for from sell proceeds plus the
   * cash balance. Zero in every normal case; nonzero means tracked value grew by
   * that much out of nothing and the caller must say so. See unfundedAmount().
   */
  unfunded: number;
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

/** A leftover worth less than this, in base currency, is not a position. */
const DUST_VALUE_BASE = 1;
/** …and it only counts as a rounding leftover if it is this small a slice of the position. */
const DUST_FRACTION_OF_POSITION = 0.01;

/**
 * True for a holding the ledger can only ever dispose of WHOLE.
 *
 * Manual assets (real estate, private markets, alternatives, structured products)
 * live in `manual_asset`, not in `portfolio_lot`. They have no share ledger and no
 * partial-quantity concept, so the only trade the ledger can represent against one
 * is a full disposal — which is a row deletion, not a lot.
 *
 * Exported because this is the ONE definition of "indivisible", and every write
 * path that offers or accepts a sell has to agree with the engine that enforces
 * it. Three routes previously each decided for themselves: `manage` guarded
 * correctly, `buy`'s funding step did not, and `optimize/execute` validated
 * against the wrong list. A rule that lives in one route's comment is a rule the
 * sibling routes break.
 */
export function isIndivisibleHolding(holdingId: string): boolean {
  return holdingId.startsWith("manual:");
}

/**
 * Does this trade dispose of the WHOLE position?
 *
 * Derived from the numbers, never assumed from the holding's type. The bug this
 * replaces assumed it: `buildLotWrites()` treated the `manual:` id prefix ALONE as
 * a deletion trigger, so a trade's direction and size were never consulted. A
 * "sell $40,000 of an $800,000 home" — which the buy flow's funding step generates
 * verbatim from a REDUCE recommendation — deleted the home and credited its full
 * $800,000 to cash. Total portfolio value was conserved, so no figure on screen
 * moved, while the asset's row, cost basis and acquisition date were simply gone.
 *
 * Uses the same two-part test closeOutIfDust() applies to share quantities, in
 * value terms: the sell must leave under a dollar behind AND under 1% of the
 * position. Both, so a deliberate partial trim can never be widened into a
 * liquidation, while the rounding a real full exit carries (recommend.ts sizes an
 * exit as `Math.round(valueBase)`, up to $0.50 short) still reads as full.
 */
function isFullDisposal(dollarDelta: number, valueBase: number): boolean {
  if (dollarDelta >= 0) return false; // a buy is never a disposal
  const residue = valueBase + dollarDelta; // dollarDelta is negative
  if (residue <= 0) return true; // covers the position, or more
  return residue < DUST_VALUE_BASE && residue < valueBase * DUST_FRACTION_OF_POSITION;
}

/**
 * Round a near-total sell up to the whole position.
 *
 * A trade arrives here denominated in DOLLARS and has to leave in UNITS, and that
 * conversion cannot be exact: the optimizer's dollar figure is derived from a
 * weight, the price is derived from a valuation, and dividing one by the other
 * lands a hair short of the units actually held. The residue is then a holding —
 * it has a row, a weight, a P&L and a quality score — despite being worth cents.
 * That is how the Commodities group came to show 0.0005 GLD at $0.18 after two
 * rebalances that both intended a full exit.
 *
 * Only a sell that already covers ≥99% of the position AND leaves under a dollar
 * behind is snapped, so a deliberate partial trim is never silently turned into a
 * liquidation — the residue has to be small in both absolute and relative terms.
 */
function closeOutIfDust(shares: number, quantity: number, price: number): number {
  const residue = quantity - shares;
  if (residue <= 0) return shares;
  const isDust =
    residue * price < DUST_VALUE_BASE && residue < quantity * DUST_FRACTION_OF_POSITION;
  return isDust ? quantity : shares;
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
    const holding = evaluation.holdings.find((h) => h.id === t.holdingId);

    // Manual assets have no lot ledger, so the only trade the ledger can record
    // against one is a FULL disposal. That is checked against the trade's own
    // numbers — see isFullDisposal(). Anything else is refused through `skipped`
    // rather than silently widened into a deletion: refusing a trade the ledger
    // cannot express is recoverable, deleting a $800k asset the user asked to trim
    // by $40k is not.
    if (isIndivisibleHolding(t.holdingId)) {
      if (!holding || holding.valuation.valueBase <= 0) {
        skipped.push({ holdingId: t.holdingId, reason: "Holding not found or has no value" });
        continue;
      }
      if (!isFullDisposal(t.dollarDelta, holding.valuation.valueBase)) {
        skipped.push({
          holdingId: t.holdingId,
          reason: t.dollarDelta >= 0
            ? `${holding.name} is a manually-valued asset with no share ledger — it cannot be bought into in increments. Update its valuation instead.`
            : `${holding.name} is a manually-valued asset with no share ledger — it cannot be partially sold. Sell the whole position, or update its valuation instead.`,
        });
        continue;
      }
      manualAssetIdsToDelete.push(t.holdingId.slice("manual:".length));
      continue;
    }

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
    const shares = isBuy
      ? rawShares
      : closeOutIfDust(Math.min(rawShares, holding.quantity), holding.quantity, price);
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

/* -------------------------------------------------------------------------- */
/* Cash allocation — depositing new money, then buying against it             */
/* -------------------------------------------------------------------------- */

export interface CashDepositItem {
  symbol: string | null;
  name: string;
  assetClass: PortfolioAssetClass;
  dollarAmount: number;
  reason: string;
}

/**
 * Pure conversion: a Capital Allocation plan -> real ledger writes. Split out
 * from the route the same way buildLotWrites() is split from executeTrades() —
 * this is the part with actual decision logic (price resolution, skip reasons)
 * and is unit-testable without touching the database.
 *
 * Deliberately NOT built on buildLotWrites()/TradeToExecute: those assume every
 * trade targets an EXISTING holding already in `evaluation.holdings` (true for a
 * rebalance, which only ever resizes what's already held). Cash allocation is
 * always additive and can open a brand-new position never held before — the
 * same case app/api/portfolio/buy/route.ts already handles by resolving a live
 * quote directly rather than looking up an existing holding.
 */
export function buildCashDepositLots(
  ctx: MarketContext,
  amount: number,
  items: CashDepositItem[],
): { lots: LotWriteInstruction[]; skipped: { symbol: string | null; reason: string }[] } {
  const base = (ctx.baseCurrency || "USD").toUpperCase();
  const lots: LotWriteInstruction[] = [
    {
      symbol: `CASH-${base}`,
      name: `${base} Cash`,
      shares: amount,
      price: 1,
      kind: "buy",
      assetClass: "cash",
      currency: base,
      meta: { source: "cash_allocation_deposit" },
    },
  ];
  const skipped: { symbol: string | null; reason: string }[] = [];

  for (const item of items) {
    if (!item.symbol) {
      skipped.push({ symbol: null, reason: "No ticker to record the trade against" });
      continue;
    }
    const price = ctx.quotes.get(item.symbol.toUpperCase())?.price ?? null;
    if (price == null || !Number.isFinite(price) || price <= 0) {
      skipped.push({ symbol: item.symbol, reason: "No live price available" });
      continue;
    }
    const shares = item.dollarAmount / price;
    if (!Number.isFinite(shares) || shares <= 0) {
      skipped.push({ symbol: item.symbol, reason: "Computed trade size was zero" });
      continue;
    }
    lots.push({
      symbol: item.symbol,
      name: item.name,
      shares,
      price,
      kind: "buy",
      assetClass: item.assetClass,
      currency: base,
      meta: { reason: item.reason, source: "cash_allocation" },
    });
  }

  return { lots, skipped };
}

/**
 * Signed net cash flow of a batch of ledger writes: a buy consumes cash (+), a
 * sell releases it (−), and exiting a manual asset releases its whole value.
 *
 * Extracted so cashBalancingLot() and unfundedAmount() cannot disagree about what
 * a batch costs — two copies of this loop is exactly how a funding check ends up
 * validating a different number from the one that gets written.
 */
function netCashFlow(evaluation: PortfolioEvaluation, built: BuildLotWritesResult): number {
  let net = 0;
  for (const lot of built.lots) {
    if (lot.assetClass === "cash") continue; // cash is never itself an actionable trade
    net += (lot.kind === "buy" ? 1 : -1) * lot.shares * lot.price;
  }
  for (const id of built.manualAssetIdsToDelete) {
    const h = evaluation.holdings.find((x) => x.id === `manual:${id}`);
    if (h) net -= h.valuation.valueBase;
  }
  return net;
}

/**
 * The cash-balancing entry that makes a batch conserve total portfolio value.
 *
 * A rebalance is not new money: selling one holding to buy another must not change
 * what the portfolio is worth. But the ledger only understands "buy/sell N shares",
 * so on its own a batch of buys inflates tracked value out of nothing and a batch
 * of sells destroys it — the executor's original sin, and the deepest driver of the
 * "execute → immediately more trades, forever" loop (every net sell shrank the pie,
 * every remaining weight drifted up, the next optimizer run proposed the same sells
 * again).
 *
 * So every batch gets ONE balancing cash lot equal to the negative of its net cash
 * flow: net buys draw the shortfall from cash, net sells (and manual-asset exits)
 * park the proceeds in cash. This holds for a FULL plan (nets to ≈0, plug ≈ nothing)
 * and for any PARTIAL selection (plug absorbs the imbalance) alike, which is what
 * makes cash "update correctly after every buy and sell". Pure — no I/O — so it is
 * unit-testable without the database.
 */
export function cashBalancingLot(
  evaluation: PortfolioEvaluation,
  built: BuildLotWritesResult,
  baseCurrency: string,
): LotWriteInstruction | null {
  const base = (baseCurrency || "USD").toUpperCase();
  const plug = -netCashFlow(evaluation, built); // >0 → park proceeds (buy cash); <0 → draw cash to fund buys (sell cash)
  if (Math.abs(plug) < CASH_SETTLEMENT_TOLERANCE) return null;

  const cashLot = (shares: number, kind: "buy" | "sell", reason: string): LotWriteInstruction => ({
    symbol: `CASH-${base}`,
    name: `${base} Cash`,
    shares, // 1 unit of cash == 1 base-currency dollar, so price is always 1
    price: 1,
    kind,
    assetClass: "cash",
    currency: base,
    unit: "currency",
    meta: { reason, balancing: true },
  });

  if (plug > 0) return cashLot(plug, "buy", "Rebalance proceeds parked in cash");

  // Net buy: draw the shortfall from existing base-currency cash, never below zero.
  const draw = Math.min(-plug, availableBaseCash(evaluation.holdings, base));
  if (draw < CASH_SETTLEMENT_TOLERANCE) return null; // no cash to draw on — see unfundedAmount()
  return cashLot(draw, "sell", "Cash drawn to fund rebalance buys");
}

/**
 * Dollars of buying this batch cannot pay for — sell proceeds exhausted AND the
 * cash balance exhausted.
 *
 * cashBalancingLot() caps its draw at the cash that exists, which is correct (it
 * must never fabricate negative cash) but was also SILENT: the excess buys were
 * still written to the ledger, so tracked portfolio value grew out of nothing and
 * nothing anywhere reported it. Callers must surface this. Normally zero — the
 * Optimize tab now blocks on optimize()'s matching `funding.shortfall` before a
 * user can get here — but execution re-prices against live data, so the check has
 * to exist on this side of the wire too.
 */
export function unfundedAmount(
  evaluation: PortfolioEvaluation,
  built: BuildLotWritesResult,
  baseCurrency: string,
): number {
  const base = (baseCurrency || "USD").toUpperCase();
  return Math.max(0, netCashFlow(evaluation, built) - availableBaseCash(evaluation.holdings, base));
}

/**
 * Execute a batch of trades against the REAL portfolio. Snapshots the current
 * state first (for undo), then writes every trade PLUS the cash-balancing entry as
 * one atomic unit — either all of it lands or none of it does. The balancing entry
 * is what guarantees total value is conserved, so re-running the optimizer on the
 * result proposes no further trades.
 */
export function executeTrades(
  evaluation: PortfolioEvaluation,
  trades: TradeToExecute[],
  objective: Objective,
  baseCurrency = "USD",
): ExecuteResult {
  const snapshotId = snapshotPortfolio("pre-execution", objective, summaryOf(evaluation));
  const built = buildLotWrites(evaluation, trades, { objective, snapshotId });

  const plug = cashBalancingLot(evaluation, built, baseCurrency);
  const lots = plug ? [...built.lots, plug] : built.lots;

  executeTradeBatch(lots, built.manualAssetIdsToDelete);

  // executedCount counts the trades the USER selected — the balancing cash lot is
  // internal bookkeeping, not one of them.
  return {
    snapshotId,
    executedCount: built.lots.length + built.manualAssetIdsToDelete.length,
    skipped: built.skipped,
    unfunded: unfundedAmount(evaluation, built, baseCurrency),
  };
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
export { addUniversalLot, executeTradeBatch };
export type { PortfolioSnapshot, PortfolioSnapshotSummary };
