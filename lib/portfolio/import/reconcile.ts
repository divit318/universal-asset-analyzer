/**
 * Screenshot Import — reconciliation engine.
 *
 * Pure diff between what the screenshots show and what UAA already holds,
 * producing per-security {@link ReconciliationRow}s with the exact write each
 * one would perform. This is a RECONCILIATION, never a replacement:
 *
 *   - A holding not visible in the screenshots is left untouched unless the
 *     user explicitly asserted the screenshots show the complete portfolio —
 *     and even then removal is a separate, default-unchecked row.
 *   - A quantity change on a position with real transaction history is
 *     expressed as ONE balancing lot whose price makes the ledger's aggregate
 *     equal the screenshot's aggregate (see {@link balancingBuyPrice}). The
 *     existing lots — the user's actual DCA history — are never touched.
 *   - An avg-cost change with no quantity change cannot be expressed by
 *     appending (average cost is a weighted mean; with zero new shares there
 *     is nothing to weight), so it becomes an explicit `rebaseline` marked
 *     destructive when it would replace a multi-lot history.
 *
 * No I/O — fully unit-testable.
 */

import type {
  ExtractedPosition,
  ExtractionResult,
  ImportPreview,
  ReconciliationRow,
  ValidationIssue,
} from "./types";
import type { ValidationOutput } from "./validate";

/** What reconcile needs to know about a currently-held position. */
export interface ExistingPosition {
  symbol: string;
  name: string;
  quantity: number;
  avgCost: number;
  /** How many real transactions back this position — >1 means history worth protecting. */
  lotCount: number;
  assetClass: string;
  currency: string;
}

const QTY_EPSILON = 1e-6;
/** Avg-cost display rounding: under 0.5% (or a cent) the screenshot and the ledger agree. */
function costsEqual(a: number, b: number): boolean {
  if (Math.abs(a - b) < 0.01) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && Math.abs(a - b) / scale < 0.005;
}

/**
 * The price p of a single balancing buy of `dQty` shares such that
 *
 *   oldQty·oldAvg + dQty·p = newQty·newAvg
 *
 * i.e. appending one lot at p makes the average-cost aggregation
 * (lib/portfolio-lots.ts) reproduce exactly the screenshot's position —
 * without touching the recorded history. Returns null when the implied price
 * is non-positive or non-finite, which means the screenshot's aggregate
 * cannot be reached by buying (e.g. avg cost FELL more than new shares could
 * explain) and the row must fall back to a rebaseline.
 */
export function balancingBuyPrice(
  oldQty: number,
  oldAvg: number,
  newQty: number,
  newAvg: number,
): number | null {
  const dQty = newQty - oldQty;
  if (dQty <= 0) return null;
  const p = (newQty * newAvg - oldQty * oldAvg) / dQty;
  return Number.isFinite(p) && p > 0 ? p : null;
}

function hasError(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

function round(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

interface ReconcileOptions {
  /** The user's own assertion that the screenshots show the entire portfolio. */
  assumeComplete: boolean;
}

/** Reconcile one extracted position against the (possibly absent) existing one. */
function reconcilePosition(
  pos: ExtractedPosition,
  issues: ValidationIssue[],
  existing: ExistingPosition | undefined,
): ReconciliationRow {
  const rowIssues = [...issues];
  const name = pos.name ?? existing?.name ?? pos.symbol ?? "Unknown";
  const assetClass = existing?.assetClass ?? pos.assetClassGuess ?? "equity";
  const currency = existing?.currency ?? pos.currency ?? "USD";
  const base: Omit<ReconciliationRow, "kind" | "action" | "delta" | "destructive" | "defaultSelected"> = {
    key: pos.symbol ?? `name:${name}`,
    symbol: pos.symbol,
    name,
    assetClass,
    currency,
    extracted: {
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      marketValue: pos.marketValue,
      currentPrice: pos.currentPrice,
      confidence: pos.confidence,
    },
    existing: existing
      ? { quantity: existing.quantity, avgCost: existing.avgCost, lotCount: existing.lotCount }
      : null,
    issues: rowIssues,
  };

  // Unusable extraction — surfaced, never guessed around.
  if (!pos.symbol || pos.quantity === null || pos.quantity <= 0 || hasError(rowIssues)) {
    return { ...base, kind: "conflict", action: "none", delta: null, destructive: false, defaultSelected: false };
  }

  // Derive avg cost from the total when only "cost basis" is displayed.
  let avgCost = pos.avgCost ?? (pos.costBasis !== null ? pos.costBasis / pos.quantity : null);

  /* ---- New holding --------------------------------------------------------- */
  if (!existing) {
    if (avgCost === null || avgCost <= 0) {
      const fallback = pos.currentPrice ?? (pos.marketValue !== null ? pos.marketValue / pos.quantity : null);
      if (fallback === null || fallback <= 0) {
        rowIssues.push({
          severity: "error",
          code: "no-cost-basis",
          message: "Neither a cost basis nor a current price is visible — there is no honest number to record this position at.",
        });
        return { ...base, kind: "conflict", action: "none", delta: null, destructive: false, defaultSelected: false };
      }
      avgCost = fallback;
      rowIssues.push({
        severity: "warning",
        code: "cost-assumed",
        message: "No cost basis is visible — the current price will be recorded as cost, and the position marked accordingly. Edit it later if you know the real cost.",
      });
    }
    return {
      ...base,
      extracted: { ...base.extracted!, avgCost: round(avgCost) },
      kind: "new",
      action: "add",
      delta: null,
      destructive: false,
      // A cost-assumed row still imports by default — the flag travels with
      // the row's issues (code "cost-assumed") into apply-time provenance.
      defaultSelected: true,
      issues: rowIssues,
    };
  }

  /* ---- Existing holding ---------------------------------------------------- */
  const dQty = pos.quantity - existing.quantity;
  const qtyEqual = Math.abs(dQty) < QTY_EPSILON;
  const costKnown = avgCost !== null && avgCost > 0;
  const costEqual = !costKnown || costsEqual(avgCost as number, existing.avgCost);

  if (qtyEqual && costEqual) {
    return { ...base, kind: "unchanged", action: "none", delta: null, destructive: false, defaultSelected: false };
  }

  if (qtyEqual && !costEqual) {
    // Same shares, different basis: only a rebaseline can express it.
    const destructive = existing.lotCount > 1;
    if (destructive) {
      rowIssues.push({
        severity: "warning",
        code: "rebaseline-destructive",
        message: `Matching the screenshot's avg cost (${(avgCost as number).toFixed(2)} vs ${existing.avgCost.toFixed(2)} recorded) requires replacing ${existing.lotCount} recorded transactions with a single opening lot. Your transaction history for this symbol would be lost.`,
      });
    }
    return {
      ...base,
      kind: "cost-change",
      action: "rebaseline",
      delta: null,
      destructive,
      defaultSelected: !destructive,
      issues: rowIssues,
    };
  }

  if (dQty > 0) {
    // Quantity increased: append ONE balancing buy that lands the aggregate
    // exactly on the screenshot — the recorded history stays intact.
    let price =
      costKnown ? balancingBuyPrice(existing.quantity, existing.avgCost, pos.quantity, avgCost as number) : null;
    if (price === null && costKnown) {
      // The screenshot's aggregate can't be reached by buying. Don't guess —
      // offer the honest destructive alternative.
      const destructive = existing.lotCount > 1;
      rowIssues.push({
        severity: "warning",
        code: "irreconcilable-average",
        message: `No purchase price can turn ${existing.quantity} @ ${existing.avgCost.toFixed(2)} into ${pos.quantity} @ ${(avgCost as number).toFixed(2)} — the recorded position disagrees with the screenshot. Applying will rebaseline to the screenshot's numbers${destructive ? `, replacing ${existing.lotCount} recorded transactions` : ""}.`,
      });
      return {
        ...base,
        kind: "conflict",
        action: "rebaseline",
        delta: null,
        destructive,
        defaultSelected: false,
        issues: rowIssues,
      };
    }
    if (price === null) {
      // Avg cost not visible: record the added shares at the current price and say so.
      price = pos.currentPrice ?? existing.avgCost;
      rowIssues.push({
        severity: "warning",
        code: "buy-price-assumed",
        message: "The screenshot doesn't show an avg cost, so the added shares will be recorded at the current price.",
      });
    }
    return {
      ...base,
      kind: "increase",
      action: "append-buy",
      delta: { kind: "buy", quantity: round(dQty), price: round(price) },
      destructive: false,
      defaultSelected: true,
      issues: rowIssues,
    };
  }

  // Quantity decreased: append ONE balancing sell. Under the average-cost
  // method a sell never changes the remaining basis, so any sell price keeps
  // the aggregate consistent — but the price DOES set estimated realized P&L,
  // so use the screenshot's own price and flag when even that is missing.
  let sellPrice = pos.currentPrice;
  if (sellPrice === null || sellPrice <= 0) {
    sellPrice = existing.avgCost;
    rowIssues.push({
      severity: "warning",
      code: "sell-price-assumed",
      message: "No price is visible for the reduction — it will be recorded at your average cost (zero realized P&L). Edit the transaction later if you know the sale price.",
    });
  }
  if (costKnown && !costsEqual(avgCost as number, existing.avgCost)) {
    rowIssues.push({
      severity: "warning",
      code: "cost-drift-after-sell",
      message: `After the reduction the screenshot shows avg cost ${(avgCost as number).toFixed(2)} but the ledger will keep ${existing.avgCost.toFixed(2)} (selling never changes average cost). If the screenshot is right, your recorded history disagrees with the brokerage.`,
    });
  }
  return {
    ...base,
    kind: "decrease",
    action: "append-sell",
    delta: { kind: "sell", quantity: round(-dQty), price: round(sellPrice) },
    destructive: false,
    defaultSelected: true,
    issues: rowIssues,
  };
}

/** Reconcile the full extraction against the current portfolio into an ImportPreview. */
export function reconcile(
  extraction: ExtractionResult,
  validation: ValidationOutput,
  existing: ExistingPosition[],
  opts: ReconcileOptions,
): ImportPreview {
  const existingBySymbol = new Map(existing.map((p) => [p.symbol.toUpperCase(), p]));
  const rows: ReconciliationRow[] = [];
  const seenSymbols = new Set<string>();

  extraction.positions.forEach((pos, i) => {
    const row = reconcilePosition(
      pos,
      validation.positionIssues[i] ?? [],
      pos.symbol ? existingBySymbol.get(pos.symbol) : undefined,
    );
    if (pos.symbol) seenSymbols.add(pos.symbol);
    rows.push(row);
  });

  /* ---- Cash ---------------------------------------------------------------- */
  if (extraction.cash) {
    const symbol = `CASH-${extraction.cash.currency}`;
    const held = existingBySymbol.get(symbol);
    seenSymbols.add(symbol);
    const changed = !held || Math.abs(held.quantity - extraction.cash.amount) >= 0.01;
    rows.push({
      key: symbol,
      symbol,
      name: `${extraction.cash.currency} Cash`,
      assetClass: "cash",
      currency: extraction.cash.currency,
      kind: !held ? "new" : changed ? (extraction.cash.amount > held.quantity ? "increase" : "decrease") : "unchanged",
      action: changed ? "set-cash" : "none",
      extracted: {
        quantity: extraction.cash.amount,
        avgCost: 1,
        marketValue: extraction.cash.amount,
        currentPrice: 1,
        confidence: "high",
      },
      existing: held ? { quantity: held.quantity, avgCost: held.avgCost, lotCount: held.lotCount } : null,
      delta: null,
      destructive: false,
      issues: [],
      defaultSelected: changed,
    });
  }

  /* ---- Holdings not visible in the screenshots ------------------------------ */
  for (const held of existing) {
    const sym = held.symbol.toUpperCase();
    if (seenSymbols.has(sym)) continue;
    // A cash position is invisible on most holdings screenshots even when the
    // account clearly has cash — never propose deleting it off a screenshot.
    const isCash = held.assetClass === "cash" || sym.startsWith("CASH-");
    if (opts.assumeComplete && !isCash) {
      rows.push({
        key: sym,
        symbol: sym,
        name: held.name,
        assetClass: held.assetClass,
        currency: held.currency,
        kind: "missing",
        action: "remove",
        extracted: null,
        existing: { quantity: held.quantity, avgCost: held.avgCost, lotCount: held.lotCount },
        delta: null,
        destructive: true,
        issues: [
          {
            severity: "warning",
            code: "not-in-screenshot",
            message:
              "Not visible in the screenshots. You marked them as your complete portfolio, so applying this row DELETES the position and its transaction history.",
          },
        ],
        // Deletion is never pre-checked — the user opts in per position.
        defaultSelected: false,
      });
    } else {
      rows.push({
        key: sym,
        symbol: sym,
        name: held.name,
        assetClass: held.assetClass,
        currency: held.currency,
        kind: "missing",
        action: "none",
        extracted: null,
        existing: { quantity: held.quantity, avgCost: held.avgCost, lotCount: held.lotCount },
        delta: null,
        destructive: false,
        issues: [
          {
            severity: "info",
            code: "not-in-screenshot",
            message: isCash
              ? "Cash isn't shown on this screenshot — left untouched."
              : "Not visible in the screenshots — left untouched.",
          },
        ],
        defaultSelected: false,
      });
    }
  }

  /* ---- Portfolio-level totals ------------------------------------------------ */
  const values = extraction.positions.map((p) => p.marketValue);
  const extractedSum = values.every((v) => v !== null)
    ? values.reduce((acc: number, v) => acc + (v as number), 0) + (extraction.cash?.amount ?? 0)
    : null;
  const statedTotal = extraction.totalValue;
  const withinTolerance =
    extractedSum !== null && statedTotal !== null && statedTotal > 0
      ? Math.abs(extractedSum - statedTotal) / statedTotal <= 0.03
      : null;

  const changeCount = rows.filter((r) => r.action !== "none").length;
  const needsReviewCount = rows.filter(
    (r) => r.kind === "conflict" || r.issues.some((i) => i.severity === "error"),
  ).length;

  return {
    rows,
    extraction: {
      brokerage: extraction.brokerage,
      totalValue: extraction.totalValue,
      currency: extraction.currency,
      appearsComplete: extraction.appearsComplete,
      completenessReason: extraction.completenessReason,
      warnings: [...extraction.warnings, ...validation.portfolioIssues.map((i) => i.message)],
      model: extraction.model,
    },
    totals: { extractedSum, statedTotal, withinTolerance },
    changeCount,
    needsReviewCount,
  };
}
