"use client";

import { useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { Button, Field, Input } from "@/app/_components/ui";
import { useFreshQuote } from "@/app/_components/use-fresh-quote";
import { formatCurrency } from "@/lib/format";

/**
 * Execute an ADD decision from the Decision Center: open the recommended
 * position, at the recommended size, without re-typing anything the engine
 * already knows.
 *
 * The write path is POST /api/portfolio/buy — the same route the Watchlist's
 * purchase flow uses — with the decision's context carried into the ledger's
 * lot meta (`source: "decision_center"`, the recommendation id, the decision
 * title as the reason). Funding is explicit and truthful: when the tracked
 * base-currency cash balance covers the amount, the default is to draw it via
 * the route's own `sellFirst` mechanism (cash down, position up — total value
 * conserved, exactly like the simulation that produced the card's impact
 * numbers assumes nothing new arrived). When it doesn't cover, we SAY the buy
 * will be recorded as new capital rather than fabricating negative cash.
 */

export interface BuyDecisionContext {
  symbol: string;
  name: string;
  /** The engine's recommended size — prefilled, editable. */
  amount: number;
  /** One-line "what and why" repeated inside the dialog so context travels. */
  title: string;
  recommendationId: string;
  /** Largest base-currency cash holding, for the fund-from-cash option. */
  cashHolding: { id: string; valueBase: number } | null;
}

interface BuyResult {
  shares: number;
  price: number;
  currency: string;
  totalCost: number;
  snapshotId: string | null;
}

export function BuyDecisionDialog({ context, onClose, onExecuted }: {
  context: BuyDecisionContext;
  onClose: () => void;
  /** Called after the ledger changed (execution AND undo) so the report refetches. */
  onExecuted: () => void;
}) {
  const { quote, loading: quoteLoading, error: quoteError, refetch } = useFreshQuote(context.symbol, true);

  const [value, setValue] = useState(String(context.amount));
  const [drawFromCash, setDrawFromCash] = useState(
    context.cashHolding != null && context.cashHolding.valueBase >= context.amount,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const [undone, setUndone] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const submittingRef = useRef(false);

  const amount = parseFloat(value.replace(/,/g, ""));
  const validAmount = Number.isFinite(amount) && amount > 0;
  const price = quote?.price ?? null;
  const estShares = validAmount && price ? amount / price : null;

  const cash = context.cashHolding;
  const cashCovers = cash != null && validAmount && cash.valueBase >= amount;
  // The checkbox only ever offers what the route can honour: a full draw.
  const effectiveDraw = drawFromCash && cashCovers;

  async function submit() {
    if (submittingRef.current || !validAmount || price == null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/portfolio/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: context.symbol,
          name: context.name,
          amount,
          sellFirst: effectiveDraw && cash
            ? [{ holdingId: cash.id, amount, reason: `Funding decision: ${context.title}` }]
            : undefined,
          meta: {
            source: "decision_center",
            recommendationId: context.recommendationId,
            reason: context.title,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Purchase failed");
      setResult({
        shares: json.shares,
        price: json.price,
        currency: json.currency,
        totalCost: json.totalCost,
        snapshotId: json.snapshotId ?? json.fundingSnapshotId ?? null,
      });
      onExecuted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

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
      onExecuted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }

  /* ── Success / reverted ── */
  if (result) {
    return (
      <Dialog open title={undone ? "Trade reverted" : "Decision executed"} onClose={onClose} className="max-w-md">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className={`flex h-12 w-12 items-center justify-center rounded-full ${undone ? "bg-surface-2 text-muted" : "bg-positive/15 text-positive"}`}>
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {undone ? <path d="M4 8h8a4 4 0 1 1 0 8H6M7 5L4 8l3 3" /> : <path d="M4 10l4 4 8-8" />}
            </svg>
          </div>
          {undone ? (
            <p className="text-sm font-semibold">
              Purchase of {context.symbol} reverted — the ledger is exactly as it was before.
            </p>
          ) : (
            <>
              <p className="text-sm font-semibold">
                Bought {result.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })} sh of {context.symbol} at {formatCurrency(result.price, result.currency)}
              </p>
              <p className="text-xs text-muted">
                {formatCurrency(result.totalCost, result.currency)} total
                {effectiveDraw ? " · funded from portfolio cash" : " · recorded as new capital"}
              </p>
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

  return (
    <Dialog open title={`Buy ${context.symbol}`} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-4">
        {/* The decision travels with the trade — never re-stated by the user. */}
        <div className="rounded-lg border border-brand/25 bg-brand/[0.05] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-brand/80">Executing decision</p>
          <p className="mt-1 text-xs leading-relaxed text-foreground">{context.title}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs leading-snug text-muted">{context.name}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{context.symbol}</p>
            </div>
            <div className="shrink-0 whitespace-nowrap text-right">
              {quoteLoading ? (
                <span className="animate-pulse text-xs text-muted">Fetching live price…</span>
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
          </div>
          {quoteError && <p className="mt-2 text-xs text-negative">{quoteError}</p>}
        </div>

        <Field label="Amount to invest">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <Input
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="pl-7"
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            />
          </div>
        </Field>

        {/* Funding — explicit, never implied. */}
        {cash && cashCovers ? (
          <label className="flex items-start gap-2 rounded-lg border border-border bg-surface/40 px-3 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={drawFromCash}
              onChange={(e) => setDrawFromCash(e.target.checked)}
              className="mt-0.5 accent-brand"
            />
            <span className="leading-relaxed text-muted">
              <strong className="text-foreground">Fund from portfolio cash</strong> ({formatCurrency(cash.valueBase)} available).
              Unchecked, the purchase is recorded as new capital instead.
            </span>
          </label>
        ) : (
          <p className="rounded-lg border border-border bg-surface/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
            {cash && cash.valueBase > 0
              ? `Tracked cash (${formatCurrency(cash.valueBase)}) doesn't cover this amount, so the purchase will be recorded as new capital — UAA never fabricates a negative cash balance.`
              : "No tracked cash to draw on — the purchase will be recorded as new capital added to the portfolio."}
          </p>
        )}

        {/* Order summary */}
        {validAmount && price != null && (
          <div className="rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-xs">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-brand/70">Order summary</p>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted">Shares bought</span>
              <span className="font-mono">{estShares?.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted">Price / share</span>
              <span className="font-mono">{formatCurrency(price, quote?.currency)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between border-t border-border/40 py-0.5 pt-1.5">
              <span className="text-muted">Estimated total</span>
              <span className="font-mono font-semibold text-positive">+{formatCurrency(amount, quote?.currency)}</span>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-negative" role="alert">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={submitting || !validAmount || price == null}
            className="flex-1"
          >
            {submitting ? "Placing order…" : "Confirm purchase"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
