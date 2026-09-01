"use client";

import { useRef, useState, type ReactNode } from "react";
import { Dialog, ConfirmDialog } from "@/app/_components/dialog";
import { Button, Field, Input } from "@/app/_components/ui";
import { useFreshQuote } from "@/app/_components/use-fresh-quote";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import type { Holding } from "@/lib/portfolio/model/types";

export type TxMode = "buy" | "sell" | "sell_all";
type InputMode = "amount" | "quantity";

interface ManageResult {
  action: "buy" | "sell";
  dollarDelta: number;
  removed: boolean;
  remainingQuantity: number;
  remainingValue: number;
  snapshotId: string | null;
  /** Base-currency cash the executor actually drew to fund a buy. */
  cashDrawn: number;
  /** Buy dollars cash could NOT cover — recorded as new capital, and said out loud. */
  unfunded: number;
}

/**
 * Buy more / sell part / sell all of ONE existing holding, from the Holdings
 * table. Every write goes through POST /api/portfolio/manage, which is a
 * thin wrapper around the same Transaction Engine (lib/portfolio/engines/
 * transaction.ts) the Optimize tab's execute route uses — no parallel
 * buy/sell math lives here.
 *
 * The Decision Center reuses this modal to EXECUTE its trim/exit/top-up
 * recommendations: `initialTxMode`/`initialAmount` preload the trade the
 * engine sized, and `context` carries the decision's one-line "what and why"
 * into the dialog — the user confirms a prefilled order instead of
 * reconstructing it.
 */
export function ManageHoldingModal({ holding, onClose, onSuccess, initialTxMode, initialAmount, context }: {
  holding: Holding;
  onClose: () => void;
  onSuccess: () => void;
  /** Preselect Buy / Sell / Sell all (e.g. from a Decision Center card). */
  initialTxMode?: TxMode;
  /** Prefill the dollar amount — the engine's recommended trade size. */
  initialAmount?: number;
  /** Rendered above the form: the decision being executed, so context travels. */
  context?: ReactNode;
}) {
  const isManual = holding.id.startsWith("manual:");
  const isCash = holding.assetClass === "cash";
  const isTicker = !isManual && !isCash;

  const { quote, loading: quoteLoading, error: quoteError, refetch } = useFreshQuote(
    isTicker ? holding.symbol : null,
    isTicker,
  );

  const [txMode, setTxMode] = useState<TxMode>(initialTxMode ?? (isManual ? "sell_all" : "buy"));
  const [inputMode, setInputMode] = useState<InputMode>("amount");
  const [value, setValue] = useState(
    initialAmount != null && initialAmount > 0 && initialTxMode !== "sell_all"
      ? String(Math.round(initialAmount))
      : "",
  );
  const [confirmingSellAll, setConfirmingSellAll] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ManageResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const submittingRef = useRef(false); // belt-and-suspenders against a double click racing the setState above

  // Live price for ticker-priced holdings; cash is always 1:1; manual assets
  // have no price concept (self-reported valuation, sell-all only).
  const price = isTicker ? quote?.price ?? null : isCash ? 1 : null;
  const priceReady = isManual || price != null;
  const avgCost = holding.quantity > 0 ? holding.costBasisBase / holding.quantity : null;

  const numericValue = parseFloat(value.replace(/,/g, ""));
  const validInput = Number.isFinite(numericValue) && numericValue > 0;

  const estAmount =
    txMode === "sell_all"
      ? holding.valuation.valueBase
      : validInput && price
      ? (inputMode === "amount" ? numericValue : numericValue * price)
      : null;
  const estShares =
    txMode === "sell_all"
      ? holding.quantity
      : validInput && price
      ? (inputMode === "amount" ? numericValue / price : numericValue)
      : null;

  function switchMode(next: TxMode) {
    setTxMode(next);
    setValue("");
    setError(null);
  }

  async function submit(full = false) {
    if (submittingRef.current) return; // rapid double-click / double-submit guard
    if (!full && (!validInput || !priceReady)) {
      setError(!priceReady ? "Waiting for a live price — try again in a moment." : "Enter a valid amount or quantity.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        holdingId: holding.id,
        action: txMode === "buy" ? "buy" : "sell",
      };
      if (full) body.full = true;
      else if (inputMode === "amount") body.amount = numericValue;
      else body.quantity = numericValue;

      const res = await fetch("/api/portfolio/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Transaction failed");

      setResult({
        action: json.action,
        dollarDelta: json.dollarDelta,
        removed: json.removed,
        remainingQuantity: json.remainingQuantity,
        remainingValue: json.remainingValue,
        snapshotId: json.snapshotId ?? null,
        cashDrawn: typeof json.cashDrawn === "number" ? json.cashDrawn : 0,
        unfunded: typeof json.unfunded === "number" ? json.unfunded : 0,
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  // Every manage write snapshots the ledger first (the route returns the id),
  // so a mis-click is reversible from right here — same undo endpoint the
  // Optimize and Cash flows already use.
  async function undo() {
    if (!result?.snapshotId || undoing) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/optimize/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: result.snapshotId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Undo failed");
      setUndone(true);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }

  const title = holding.symbol ? `Manage ${holding.symbol}` : `Manage ${holding.name}`;

  /* ── Success screen ── */
  if (result) {
    return (
      <Dialog open title={undone ? "Transaction reverted" : "Transaction complete"} onClose={onClose} className="max-w-md">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${undone ? "bg-surface-2 text-muted" : "bg-positive/15 text-positive"}`}>
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {undone ? <path d="M4 8h8a4 4 0 1 1 0 8H6M7 5L4 8l3 3" /> : <path d="M4 10l4 4 8-8" />}
            </svg>
          </div>
          {undone ? (
            <p className="text-sm font-semibold">
              Reverted — {holding.symbol ?? holding.name} is exactly as it was before this transaction.
            </p>
          ) : result.removed ? (
            <>
              <p className="text-sm font-semibold">
                Sold entire position — {holding.symbol ?? holding.name} removed from your portfolio.
              </p>
              <p className="text-xs text-muted">Transaction history is preserved.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">
                {result.action === "buy" ? "Bought" : "Sold"} {formatCurrency(Math.abs(result.dollarDelta))} of {holding.symbol ?? holding.name}
              </p>
              <p className="text-xs text-muted">
                Remaining: {result.remainingQuantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} {holding.unit} · {formatCurrency(result.remainingValue)}
              </p>
              {/* Where the money went/came from — never implied. */}
              {result.action === "buy" && !isCash && (
                <p className="text-xs text-muted" role="status">
                  {result.unfunded > 0.5
                    ? `${formatCurrency(result.cashDrawn)} drawn from tracked cash · ${formatCurrency(result.unfunded)} recorded as new capital (cash didn't cover the full amount).`
                    : result.cashDrawn > 0.5
                      ? "Paid from tracked cash — the cash balance was reduced by this amount."
                      : "Recorded as new capital — no tracked cash to draw on."}
                </p>
              )}
              {result.action === "sell" && !isCash && (
                <p className="text-xs text-muted" role="status">
                  Proceeds credited to tracked cash.
                </p>
              )}
            </>
          )}
          {error && <p className="text-xs text-negative" role="alert">{error}</p>}
          <div className="mt-2 flex w-full gap-2">
            {!undone && result.snapshotId && (
              <Button variant="secondary" onClick={() => void undo()} disabled={undoing} className="flex-1">
                {undoing ? "Reverting…" : "Undo"}
              </Button>
            )}
            <Button variant="primary" onClick={onClose} className="flex-1">
              Done
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  /* ── Manual-asset simplified view: full exit only ── */
  if (isManual) {
    return (
      <Dialog open title={title} onClose={onClose} className="max-w-md">
        <div className="flex flex-col gap-4">
          {context}
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
            <p className="text-xs text-muted">{PORTFOLIO_CLASS_LABEL[holding.assetClass]}</p>
            <p className="font-mono text-sm font-semibold">{holding.name}</p>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted">Current value</span>
              <span className="font-mono font-semibold">{formatCurrency(holding.valuation.valueBase)}</span>
            </div>
            {holding.unrealizedPL != null && (
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted">Unrealized P&amp;L</span>
                <span className={`font-mono font-semibold ${holding.unrealizedPL >= 0 ? "text-positive" : "text-negative"}`}>
                  {formatCurrency(holding.unrealizedPL)} ({holding.unrealizedPct?.toFixed(1)}%)
                </span>
              </div>
            )}
          </div>

          <p className="text-xs leading-relaxed text-muted">
            {PORTFOLIO_CLASS_LABEL[holding.assetClass]} holdings have no live market price or partial-quantity
            concept — a stake is a single indivisible unit. Edit its value or details in the Research Hub, or
            remove it from your portfolio entirely below.
          </p>

          {error && <p className="text-xs text-negative">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => setConfirmingSellAll(true)}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? "Removing…" : "Remove from portfolio"}
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmingSellAll}
          onClose={() => setConfirmingSellAll(false)}
          onConfirm={() => void submit(true)}
          title="Remove this position?"
          message={`This removes ${holding.name} (${formatCurrency(holding.valuation.valueBase)}) from your portfolio. Its transaction history is kept.`}
          confirmLabel="Remove"
          danger
        />
      </Dialog>
    );
  }

  /* ── Standard buy/sell view (ticker-priced + cash) ── */
  return (
    <Dialog open title={title} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-4">
        {context}
        {/* Position summary */}
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs leading-snug text-muted">{holding.name}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{holding.symbol ?? PORTFOLIO_CLASS_LABEL[holding.assetClass]}</p>
            </div>
            {isTicker && (
              <div className="shrink-0 whitespace-nowrap text-right">
                {quoteLoading ? (
                  <span className="text-xs text-muted animate-pulse">Fetching live price…</span>
                ) : quote ? (
                  <>
                    <p className="font-mono text-lg font-bold">{formatCurrency(quote.price, quote.currency)}</p>
                    <p className={`text-xs ${quote.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
                      {quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}% today
                    </p>
                  </>
                ) : (
                  <button onClick={refetch} className="text-xs text-negative underline underline-offset-2">
                    Retry price
                  </button>
                )}
              </div>
            )}
          </div>
          {quoteError && <p className="mt-2 text-xs text-negative">{quoteError}</p>}

          {/* Single-column rows, not a 2-up grid — a long "quantity + unit" value
              (e.g. "554.0649 shares") has nowhere to wrap to in a half-width
              column and breaks mid-value. Matches the Order Summary pattern
              below and the Watchlist Buy modal's own summary box. */}
          <div className="mt-3 flex flex-col gap-1 border-t border-border/60 pt-3 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-muted">Quantity</span>
              <span className="truncate font-mono text-foreground">
                {holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} {holding.unit}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-muted">Weight</span>
              <span className="font-mono text-foreground">{holding.weight.toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-muted">Avg cost</span>
              <span className="font-mono text-foreground">{avgCost != null ? formatCurrency(avgCost) : "—"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-muted">Market value</span>
              <span className="font-mono text-foreground">{formatCurrency(holding.valuation.valueBase)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-muted">Unrealized P&amp;L</span>
              <span className={`font-mono font-semibold ${
                holding.unrealizedPL == null ? "text-muted" : holding.unrealizedPL >= 0 ? "text-positive" : "text-negative"
              }`}>
                {holding.unrealizedPL == null ? "—" : `${formatCurrency(holding.unrealizedPL)} (${holding.unrealizedPct?.toFixed(1)}%)`}
              </span>
            </div>
          </div>
        </div>

        {/* Buy / Sell / Sell all selector — distinct visual hierarchy per action */}
        <div role="group" aria-label="Transaction type" className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={() => switchMode("buy")}
            aria-pressed={txMode === "buy"}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
              txMode === "buy" ? "border-brand bg-brand/10 text-brand" : "border-border text-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            Buy more
          </button>
          <button
            type="button"
            onClick={() => switchMode("sell")}
            aria-pressed={txMode === "sell"}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
              txMode === "sell" ? "border-warning bg-warning/10 text-warning" : "border-border text-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            Sell
          </button>
          <button
            type="button"
            onClick={() => switchMode("sell_all")}
            aria-pressed={txMode === "sell_all"}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
              txMode === "sell_all" ? "border-negative bg-negative/10 text-negative" : "border-border text-muted hover:border-border-strong hover:text-foreground"
            }`}
          >
            Sell all
          </button>
        </div>

        {txMode === "sell_all" ? (
          /* ── Sell all: no form, just a clear summary + confirm gate ── */
          <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3 text-xs">
            <p className="mb-1.5 font-semibold uppercase tracking-widest text-negative/80 text-[10px]">Full liquidation</p>
            <p className="leading-relaxed text-foreground/85">
              This sells all {holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} {holding.unit} of{" "}
              {holding.symbol ?? holding.name} (~{formatCurrency(holding.valuation.valueBase)}) and removes it from your portfolio.
            </p>
          </div>
        ) : (
          <>
            {/* Amount / Quantity toggle */}
            <div>
              {!isCash && (
                <div
                  role="group"
                  aria-label="Trade by amount or quantity"
                  className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-xs font-medium w-fit"
                >
                  <button
                    type="button"
                    onClick={() => { setInputMode("amount"); setValue(""); }}
                    aria-pressed={inputMode === "amount"}
                    className={`rounded-md px-3 py-1.5 transition-colors ${inputMode === "amount" ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"}`}
                  >
                    Dollar amount
                  </button>
                  <button
                    type="button"
                    onClick={() => { setInputMode("quantity"); setValue(""); }}
                    aria-pressed={inputMode === "quantity"}
                    className={`rounded-md px-3 py-1.5 transition-colors ${inputMode === "quantity" ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"}`}
                  >
                    Quantity
                  </button>
                </div>
              )}
              <Field label={inputMode === "amount" || isCash ? (txMode === "buy" ? "Amount to add" : "Amount to sell") : "Number of shares"}>
                <div className="relative">
                  {(inputMode === "amount" || isCash) && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
                  )}
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    inputMode="decimal"
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={inputMode === "amount" || isCash ? "1,000" : "10"}
                    className={inputMode === "amount" || isCash ? "pl-7" : ""}
                    onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
                  />
                </div>
              </Field>
            </div>

            {/* Order summary */}
            {validInput && priceReady && (
              <div className={`rounded-lg border px-4 py-3 text-xs ${
                txMode === "buy" ? "border-brand/20 bg-brand/5" : "border-warning/20 bg-warning/5"
              }`}>
                <p className={`mb-1.5 font-semibold uppercase tracking-widest text-[10px] ${txMode === "buy" ? "text-brand/70" : "text-warning/80"}`}>
                  Order summary
                </p>
                {!isCash && (
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-muted">{txMode === "buy" ? "Shares bought" : "Shares sold"}</span>
                    <span className="font-mono">{estShares?.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                  </div>
                )}
                {!isCash && (
                  <div className="flex items-center justify-between py-0.5">
                    <span className="text-muted">Price / share</span>
                    <span className="font-mono">{formatCurrency(price, quote?.currency)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-0.5 border-t border-border/40 mt-1 pt-1.5">
                  <span className="text-muted">Estimated total</span>
                  <span className={`font-mono font-semibold ${txMode === "buy" ? "text-positive" : "text-negative"}`}>
                    {txMode === "buy" ? "+" : "−"}{formatCurrency(estAmount ?? 0, quote?.currency)}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs text-negative">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
          {txMode === "sell_all" ? (
            <Button
              variant="destructive"
              onClick={() => setConfirmingSellAll(true)}
              disabled={submitting}
              className="flex-1"
            >
              {submitting ? "Selling…" : "Review & sell all"}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void submit()}
              disabled={submitting || !priceReady || !validInput}
              className="flex-1"
            >
              {submitting ? "Placing order…" : txMode === "buy" ? "Confirm purchase" : "Confirm sale"}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingSellAll}
        onClose={() => setConfirmingSellAll(false)}
        onConfirm={() => void submit(true)}
        title="Sell entire position?"
        message={`This sells all ${holding.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${holding.unit} of ${holding.symbol ?? holding.name} (~${formatCurrency(holding.valuation.valueBase)}) and removes it from your portfolio. This cannot be undone from here.`}
        confirmLabel="Sell all"
        danger
      />
    </Dialog>
  );
}
