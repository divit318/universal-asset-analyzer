"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { Button, Field, Input } from "@/app/_components/ui";
import { useFreshQuote } from "@/app/_components/use-fresh-quote";
import { formatCurrency } from "@/lib/format";
import { TICKER_PRICED_ASSET_CLASSES, PORTFOLIO_CLASS_LABEL, detectPortfolioAssetClass, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { WatchlistItem } from "@/lib/types";

type Mode = "amount" | "quantity";

interface BuyResult {
  symbol: string;
  shares: number;
  price: number;
  currency: string;
  assetClass: PortfolioAssetClass;
  totalCost: number;
}

export function BuyModal({ item, onClose, onSuccess }: {
  item: WatchlistItem;
  onClose: () => void;
  onSuccess: (result: BuyResult) => void;
}) {
  const { quote, loading: quoteLoading, error: quoteError, refetch } = useFreshQuote(item.symbol, true);

  const [mode, setMode] = useState<Mode>("amount");
  const [value, setValue] = useState("");
  const [assetClass, setAssetClass] = useState<PortfolioAssetClass>("equity");
  const [assetClassTouched, setAssetClassTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BuyResult | null>(null);
  const submittingRef = useRef(false); // belt-and-suspenders against a double click racing the setState above

  // Auto-detect asset class from the live quote once, unless the user already picked one.
  /* eslint-disable react-hooks/set-state-in-effect -- syncing to an async quote result */
  useEffect(() => {
    if (!quote || assetClassTouched) return;
    setAssetClass(detectPortfolioAssetClass(quote.assetType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const numericValue = parseFloat(value.replace(/,/g, ""));
  const validInput = Number.isFinite(numericValue) && numericValue > 0;
  const price = quote?.price ?? null;

  const estShares = validInput && price ? (mode === "amount" ? numericValue / price : numericValue) : null;
  const estAmount = validInput && price ? (mode === "amount" ? numericValue : numericValue * price) : null;

  async function submit() {
    if (submittingRef.current) return; // rapid double-click / double-submit guard
    if (!validInput || !price) {
      setError(!price ? "Waiting for a live price — try again in a moment." : "Enter a valid amount or quantity.");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        symbol: item.symbol,
        name: item.name,
        assetClass,
      };
      if (mode === "amount") body.amount = numericValue;
      else body.quantity = numericValue;

      const res = await fetch("/api/portfolio/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Purchase failed");

      const buyResult: BuyResult = {
        symbol: json.symbol,
        shares: json.shares,
        price: json.price,
        currency: json.currency,
        assetClass: json.assetClass,
        totalCost: json.totalCost,
      };
      setResult(buyResult);
      onSuccess(buyResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed");
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  if (result) {
    return (
      <Dialog open title="Purchase complete" onClose={onClose} className="max-w-md">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-positive/15 text-positive">
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10l4 4 8-8" />
            </svg>
          </div>
          <p className="text-sm font-semibold">
            Bought {result.shares.toLocaleString(undefined, { maximumFractionDigits: 6 })} sh of {result.symbol}
          </p>
          <p className="text-xs text-muted">
            {formatCurrency(result.totalCost, result.currency)} at {formatCurrency(result.price, result.currency)}/share
          </p>
          <p className="text-xs text-muted">Added to your Portfolio.</p>
          <Button variant="primary" onClick={onClose} className="mt-2 w-full">
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open title={`Buy ${item.symbol}`} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-4">
        {/* Live price */}
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-xs leading-snug text-muted">{item.name}</p>
              <p className="mt-1 font-mono text-sm font-semibold">{item.symbol}</p>
            </div>
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
          </div>
          {quoteError && <p className="mt-2 text-xs text-negative">{quoteError}</p>}
        </div>

        {/* Amount / Quantity toggle */}
        <div>
          <div
            role="group"
            aria-label="Buy by amount or quantity"
            className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-xs font-medium w-fit"
          >
            <button
              type="button"
              onClick={() => { setMode("amount"); setValue(""); }}
              aria-pressed={mode === "amount"}
              className={`rounded-md px-3 py-1.5 transition-colors ${mode === "amount" ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"}`}
            >
              Dollar amount
            </button>
            <button
              type="button"
              onClick={() => { setMode("quantity"); setValue(""); }}
              aria-pressed={mode === "quantity"}
              className={`rounded-md px-3 py-1.5 transition-colors ${mode === "quantity" ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"}`}
            >
              Quantity
            </button>
          </div>
          <Field label={mode === "amount" ? "Amount to invest" : "Number of shares"}>
            <div className="relative">
              {mode === "amount" && (
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
                placeholder={mode === "amount" ? "1,000" : "10"}
                className={mode === "amount" ? "pl-7" : ""}
                onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
              />
            </div>
          </Field>
        </div>

        {/* Asset class */}
        <Field label="Asset class">
          <select
            value={assetClass}
            onChange={(e) => { setAssetClass(e.target.value as PortfolioAssetClass); setAssetClassTouched(true); }}
            className="w-full rounded-control border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
          >
            {TICKER_PRICED_ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>{PORTFOLIO_CLASS_LABEL[c]}</option>
            ))}
          </select>
        </Field>

        {/* Order summary */}
        {validInput && price && (
          <div className="rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-xs">
            <p className="mb-1.5 font-semibold uppercase tracking-widest text-brand/70 text-[10px]">Order summary</p>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted">Shares</span>
              <span className="font-mono">{estShares?.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span className="text-muted">Price / share</span>
              <span className="font-mono">{formatCurrency(price, quote?.currency)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5 border-t border-brand/15 mt-1 pt-1.5">
              <span className="text-muted">Estimated total</span>
              <span className="font-mono font-semibold text-positive">{formatCurrency(estAmount ?? 0, quote?.currency)}</span>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-negative">{error}</p>}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={submitting} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={submitting || quoteLoading || !quote || !validInput}
            className="flex-1"
          >
            {submitting ? "Placing order…" : "Confirm purchase"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
