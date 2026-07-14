"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { useToast } from "@/app/_components/toast";
import { Button, Input, Field } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_ASSET_CLASSES, PORTFOLIO_CLASS_LABEL } from "@/lib/portfolio/model/types";
import type { PortfolioAssetClass } from "@/lib/portfolio/model/types";
import type { Quote } from "@/lib/types";

const MANUAL_CLASSES: PortfolioAssetClass[] = ["real_estate", "private_market", "alternative", "structured_product"];

/** Placeholder ticker shown per class — also nudges the user toward the right kind of symbol. */
const PLACEHOLDER: Partial<Record<PortfolioAssetClass, string>> = {
  equity: "AAPL",
  etf: "VOO",
  reit: "O",
  bond: "IEF",
  commodity: "GLD",
  crypto: "BTC-USD",
  forex: "EURUSD=X",
};

/**
 * Live-quote lookup, debounced off whatever the user is typing.
 *
 * This is the autofetch this component exists for: as soon as a symbol looks
 * resolvable, we ask /api/quote for it (the same batch-quote endpoint the rest
 * of the app uses — no new data path) and use the result to fill in the fields
 * a user would otherwise have to know or look up by hand: the display name,
 * the trading currency, and today's price as a sane starting point for avg cost.
 */
function useSymbolQuote(symbol: string, enabled: boolean) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const tokenRef = useRef(0);

  useEffect(() => {
    const sym = symbol.trim().toUpperCase();
    /* eslint-disable react-hooks/set-state-in-effect -- syncing local state to
       the (debounced, cancellable) external quote fetch below, not derivable at
       render time. */
    if (!enabled || sym.length < 1) {
      setQuote(null);
      setNotFound(false);
      return;
    }

    const token = ++tokenRef.current;
    setLoading(true);
    setNotFound(false);
    /* eslint-enable react-hooks/set-state-in-effect */

    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quote?symbols=${encodeURIComponent(sym)}`);
        const json = await res.json();
        if (tokenRef.current !== token) return; // a newer keystroke superseded this request
        const q = (json.quotes as Quote[] | undefined)?.[0] ?? null;
        setQuote(q);
        setNotFound(!q);
      } catch {
        if (tokenRef.current === token) {
          setQuote(null);
          setNotFound(true);
        }
      } finally {
        if (tokenRef.current === token) setLoading(false);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [symbol, enabled]);

  return { quote, loading, notFound };
}

/**
 * Add-holding dialog.
 *
 * The seven market-priced classes (equity, etf, reit, bond, commodity, crypto,
 * forex) all resolve through the same ticker-search + live-quote path, so one
 * form serves all of them — the user types a few characters, picks a match (or
 * keeps typing a symbol they already know), and name/currency/price fill in
 * on their own rather than being hand-typed from memory.
 *
 * The four manually-valued classes (real estate, private markets, alternatives,
 * structured products) have no ticker to look up — they stay routed to the
 * Research Hub's dedicated flow, which collects the class-specific details
 * (property type, ownership %, barrier terms, …) that autofetch has no way to
 * supply.
 */
export function AddHoldingDialog({ open, onClose, onSaved }: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [assetClass, setAssetClass] = useState<PortfolioAssetClass>("equity");
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [avgCostTouched, setAvgCostTouched] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [yieldPct, setYieldPct] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCash = assetClass === "cash";
  const isManual = MANUAL_CLASSES.includes(assetClass);
  const isTicker = !isCash && !isManual;

  const { quote, loading: quoteLoading, notFound } = useSymbolQuote(symbol, isTicker);

  // Autofetch: once a quote resolves, fill in whatever the user hasn't already
  // typed themselves. Fields the user DID touch are never overwritten — this
  // is a convenience, not a takeover.
  /* eslint-disable react-hooks/set-state-in-effect -- syncing form fields to an
     external, async quote result; not derivable at render time. */
  useEffect(() => {
    if (!quote) return;
    if (!nameTouched) setName(quote.name);
    if (!currencyTouched) setCurrency(quote.currency);
    // Prefill avg cost with today's price — a reasonable starting point for a
    // position being entered "at market" — but leave it alone the moment the
    // user edits it themselves.
    if (!avgCostTouched) setAvgCost(String(quote.price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function resetFields() {
    setSymbol(""); setName(""); setNameTouched(false);
    setQuantity(""); setAvgCost(""); setAvgCostTouched(false);
    setCurrency("USD"); setCurrencyTouched(false); setYieldPct("");
  }

  function handleClassChange(next: PortfolioAssetClass) {
    setAssetClass(next);
    resetFields();
    setErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);

    try {
      const body: Record<string, unknown> = { assetClass, currency };

      if (isCash) {
        body.amount = Number(quantity);
        if (yieldPct) body.yieldPct = Number(yieldPct);
      } else {
        body.symbol = symbol.trim().toUpperCase();
        body.name = name.trim() || symbol.trim().toUpperCase();
        body.quantity = Number(quantity);
        body.avgCost = Number(avgCost);
      }

      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      toast("Holding added");
      resetFields();
      onSaved();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add holding">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Asset class">
          <select
            value={assetClass}
            onChange={(e) => handleClassChange(e.target.value as PortfolioAssetClass)}
            className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-brand focus:outline-none"
          >
            {PORTFOLIO_ASSET_CLASSES.map((c) => (
              <option key={c} value={c}>{PORTFOLIO_CLASS_LABEL[c]}</option>
            ))}
          </select>
        </Field>

        {isManual ? (
          <div className="rounded-lg border border-border bg-surface/40 p-4">
            <p className="text-xs leading-relaxed text-muted">
              {PORTFOLIO_CLASS_LABEL[assetClass]} holdings are added through the Research
              Hub, which collects the details this class needs (property type, ownership
              percentage, barrier terms, and so on). They appear in this portfolio
              automatically once added there.
            </p>
          </div>
        ) : isCash ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <Input
                  type="number" step="any" min="0" required
                  value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  placeholder="50000"
                />
              </Field>
              <Field label="Currency">
                <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
              </Field>
            </div>
            <Field label="Yield % (optional)">
              <Input
                type="number" step="any" min="0"
                value={yieldPct} onChange={(e) => setYieldPct(e.target.value)}
                placeholder="4.30"
              />
            </Field>
            {/* Idle cash is a scoreable weakness, not a neutral. Say so at entry. */}
            <p className="-mt-1 text-[11px] leading-relaxed text-muted/70">
              Cash is treated as an asset, not a residual: it earns a yield, it is your
              liquidity buffer, and it loses purchasing power to inflation. Recording the
              yield lets the engine judge whether it is working or sitting idle.
            </p>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Symbol">
                <SymbolSearch
                  value={symbol}
                  onChange={(v) => setSymbol(v.toUpperCase())}
                  onSelect={(sym) => setSymbol(sym.toUpperCase())}
                  loading={quoteLoading}
                  placeholder={`Search — e.g. ${PLACEHOLDER[assetClass] ?? "AAPL"}`}
                />
              </Field>
              <Field label="Currency">
                <Input
                  value={currency}
                  onChange={(e) => { setCurrency(e.target.value.toUpperCase()); setCurrencyTouched(true); }}
                />
              </Field>
            </div>

            {/* Live confirmation that the symbol resolved — the whole point of
                autofetch is that the user sees this instead of having to trust
                a ticker they typed from memory. */}
            {symbol.trim() && (
              <p className="-mt-2 text-[11px] leading-relaxed">
                {quoteLoading ? (
                  <span className="text-muted/70">Looking up {symbol.trim().toUpperCase()}…</span>
                ) : quote ? (
                  <span className="text-positive">
                    ✓ {quote.name} · {formatCurrency(quote.price)} {quote.currency}
                    {quote.exchange ? ` · ${quote.exchange}` : ""}
                  </span>
                ) : notFound ? (
                  <span className="text-warning">
                    No live quote found for this symbol — you can still add it, but double-check the ticker.
                  </span>
                ) : null}
              </p>
            )}

            <Field label="Name (optional)">
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
                placeholder={quote?.name ?? "Apple Inc."}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <Input
                  type="number" step="any" min="0" required
                  value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label={quote ? `Avg cost (live: ${formatCurrency(quote.price)})` : "Avg cost"}>
                <Input
                  type="number" step="any" min="0" required
                  value={avgCost}
                  onChange={(e) => { setAvgCost(e.target.value); setAvgCostTouched(true); }}
                  placeholder={quote ? String(quote.price) : "0.00"}
                />
              </Field>
            </div>
            {quote && !avgCostTouched && (
              <p className="-mt-2 text-[11px] text-muted/70">
                Avg cost prefilled with today&apos;s price — edit it if you bought at a different price.
              </p>
            )}
          </>
        )}

        {err && <p className="text-xs text-negative">{err}</p>}

        {!isManual && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : "Add holding"}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
