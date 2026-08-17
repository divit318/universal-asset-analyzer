"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { Badge, Button, Input, Field } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import { PORTFOLIO_CLASS_LABEL, type PortfolioAssetClass } from "@/lib/portfolio/model/types";
import { availableCash } from "@/lib/portfolio/simulator/edit";
import type { SwapImpact } from "@/app/api/portfolio/simulator/swap/route";
import type { SimHolding, Simulation } from "@/lib/portfolio/simulator/types";
import type { SymbolSuggestion } from "@/lib/types";
import { StateRow } from "../universal/impact-display";

/* ─────────────────────────── Adjust quantity ───────────────────────────── */

export function AdjustDialog({
  holding,
  livePrice,
  currency,
  cash,
  saving,
  onApply,
  onClose,
}: {
  holding: SimHolding;
  /** Live price in the mandate currency, from the current evaluation. */
  livePrice: number | null;
  currency: string;
  cash: number;
  saving: boolean;
  onApply: (quantity: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(String(holding.quantity));
  const n = Number(qty);
  const valid = Number.isFinite(n) && n >= 0 && n !== holding.quantity;
  const delta = livePrice != null && Number.isFinite(n) ? (n - holding.quantity) * livePrice : null;

  return (
    <Dialog open onClose={saving ? () => {} : onClose} title={`Adjust ${holding.symbol}`} className="max-w-sm">
      <div className="flex flex-col gap-4">
        <Field label={`Quantity (currently ${holding.quantity.toLocaleString("en-US")})`}>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        {delta !== null && delta !== 0 && (
          <p className="text-[11px] leading-relaxed text-muted">
            {delta > 0 ? (
              <>
                Buys {formatCurrency(delta, currency)} from the cash sleeve
                ({formatCurrency(cash, currency)} available{delta > cash ? " — will be capped" : ""}).
              </>
            ) : (
              <>Frees {formatCurrency(-delta, currency)} back into the cash sleeve.</>
            )}
          </p>
        )}
        {n === 0 && <p className="text-[11px] text-warning">Quantity 0 removes the position entirely.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => onApply(n)} disabled={!valid || saving}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────── Remove ────────────────────────────────────── */

export function RemoveDialog({
  holding,
  liveValue,
  currency,
  saving,
  onApply,
  onClose,
}: {
  holding: SimHolding;
  liveValue: number | null;
  currency: string;
  saving: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onClose={saving ? () => {} : onClose} title={`Remove ${holding.symbol}`} className="max-w-sm">
      <div className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted">
          Removes <strong className="text-foreground">{holding.name}</strong> from this hypothetical
          portfolio{liveValue != null && <> and returns {formatCurrency(liveValue, currency)} to the cash sleeve</>}.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={onApply} disabled={saving}>
            {saving ? "Removing…" : "Remove"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────── Add holding ───────────────────────────────── */

const ADDABLE_CLASSES: PortfolioAssetClass[] = ["equity", "etf", "reit", "bond", "commodity", "crypto"];

function classFromSuggestionType(type: string | null): PortfolioAssetClass {
  switch (type?.toLowerCase()) {
    case "etf": return "etf";
    case "cryptocurrency": return "crypto";
    default: return "equity";
  }
}

export function AddDialog({
  sim,
  saving,
  onApply,
  onClose,
}: {
  sim: Simulation;
  saving: boolean;
  onApply: (input: { symbol: string; assetClass: PortfolioAssetClass; quantity: number }) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [picked, setPicked] = useState<SymbolSuggestion | null>(null);
  const [assetClass, setAssetClass] = useState<PortfolioAssetClass>("equity");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cash = availableCash(sim.holdings);
  const held = new Set(sim.holdings.map((h) => h.symbol).filter(Boolean));

  // Typeahead against the app's existing search proxy. Visibility is derived
  // at render (hidden once picked / query cleared) rather than cleared here —
  // setState inside an effect is the cascade the lint rule exists to stop.
  useEffect(() => {
    if (picked || query.trim().length < 1) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        setSuggestions(((json.results ?? []) as SymbolSuggestion[]).slice(0, 6));
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, picked]);

  const pick = useCallback(async (s: SymbolSuggestion) => {
    setPicked(s);
    setQuery(s.symbol);
    setSuggestions([]);
    setAssetClass(classFromSuggestionType(s.type));
    setPrice(null);
    try {
      const res = await fetch(`/api/quote?symbols=${encodeURIComponent(s.symbol)}`);
      const json = await res.json();
      const q = (json.quotes ?? [])[0];
      if (q?.price) setPrice(q.price as number);
    } catch {
      /* price preview is best-effort; the server re-prices on apply */
    }
  }, []);

  const n = Number(qty);
  const valid = picked !== null && Number.isFinite(n) && n > 0 && !held.has(picked.symbol);

  return (
    <Dialog open onClose={saving ? () => {} : onClose} title="Add holding" className="max-w-md">
      <div className="flex flex-col gap-4">
        <Field label="Search any ticker">
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPicked(null);
              }}
              placeholder="Symbol or company name…"
              autoFocus
            />
            {suggestions.length > 0 && !picked && query.trim().length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
                {suggestions.map((s) => {
                  const already = held.has(s.symbol);
                  return (
                    <li key={s.symbol}>
                      <button
                        onClick={() => !already && void pick(s)}
                        disabled={already}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-surface-2 disabled:opacity-50"
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="font-semibold text-foreground">{s.symbol}</span>
                          <span className="truncate text-muted">{s.name}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted/70">
                          {already ? "already held" : s.type ?? ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Field>

        {picked && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted">Asset class</span>
              <div className="flex flex-wrap gap-1.5">
                {ADDABLE_CLASSES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setAssetClass(c)}
                    aria-pressed={assetClass === c}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      assetClass === c
                        ? "border-brand bg-brand/10 font-semibold text-foreground"
                        : "border-border text-muted hover:border-brand/40 hover:text-foreground"
                    }`}
                  >
                    {PORTFOLIO_CLASS_LABEL[c] ?? c}
                  </button>
                ))}
              </div>
            </div>

            <Field
              label="Quantity"
              hint={
                price != null
                  ? `≈ ${formatCurrency(price)} each · cash sleeve holds ${formatCurrency(cash, sim.profile.currency)}${
                      Number.isFinite(n) && n > 0 ? ` · cost ≈ ${formatCurrency(n * price)}` : ""
                    }`
                  : `Cash sleeve holds ${formatCurrency(cash, sim.profile.currency)} — the buy is funded from it`
              }
            >
              <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="10" />
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!valid || saving}
            onClick={() => picked && onApply({ symbol: picked.symbol, assetClass, quantity: n })}
          >
            {saving ? "Adding…" : "Add holding"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ─────────────────────────── Swap ──────────────────────────────────────── */

interface SwapAlternative {
  symbol: string;
  name: string;
  why: string;
  holdings: SimHolding[];
  impact: SwapImpact;
}

export function SwapDialog({
  sim,
  holding,
  saving,
  onApply,
  onClose,
}: {
  sim: Simulation;
  holding: SimHolding;
  saving: boolean;
  /** Confirm one alternative: the previewed holdings become the book. */
  onApply: (alt: { symbol: string; holdings: SimHolding[] }) => void;
  onClose: () => void;
}) {
  const [alternatives, setAlternatives] = useState<SwapAlternative[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setAlternatives(null);
    try {
      const res = await fetch("/api/portfolio/simulator/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sim.id, symbol: holding.symbol }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Swap suggestions failed");
      setAlternatives(json.alternatives as SwapAlternative[]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Swap suggestions failed");
    }
  }, [sim.id, holding.symbol]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
    return () => {
      startedRef.current = false;
      abortRef.current?.abort();
    };
  }, [load]);

  return (
    <Dialog open onClose={saving ? () => {} : onClose} title={`Swap ${holding.symbol}`} className="max-w-lg">
      <div className="flex flex-col gap-4">
        {!alternatives && !error && (
          <p className="animate-pulse text-xs text-muted">
            The AI is proposing alternatives and measuring each one&apos;s impact on the whole book
            — up to a couple of minutes on a busy model…
          </p>
        )}

        {error && (
          <div className="flex flex-col gap-2 rounded-lg border border-negative/25 bg-negative/5 p-3">
            <p className="text-xs text-negative">{error}</p>
            <Button size="xs" variant="secondary" onClick={load} className="self-start">Retry</Button>
          </div>
        )}

        {alternatives && (
          <ul className="flex flex-col gap-2">
            {alternatives.map((a) => {
              const active = selected === a.symbol;
              return (
                <li key={a.symbol}>
                  <button
                    onClick={() => setSelected(active ? null : a.symbol)}
                    aria-pressed={active}
                    className={`flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                      active ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">{a.symbol}</span>
                      <span className="min-w-0 truncate text-xs text-muted">{a.name}</span>
                      <Badge variant="neutral">{PORTFOLIO_CLASS_LABEL[holding.assetClass] ?? holding.assetClass}</Badge>
                    </span>
                    {a.why && <span className="text-[11px] leading-relaxed text-muted">{a.why}</span>}
                    {/* The Decisions tab's "expected portfolio state" — measured, not guessed.
                        The alignment row hides itself (StateRow renders nothing on null)
                        when either side of the book is unscorable. */}
                    <span className="flex flex-col divide-y divide-border/40 rounded-lg border border-border/60 bg-surface/40 px-3 py-1">
                      <StateRow label="Portfolio alignment" before={a.impact.alignmentBefore} after={a.impact.alignmentAfter} decimals={0} />
                      <StateRow
                        label="Annualized volatility"
                        before={a.impact.volatilityBefore}
                        after={a.impact.volatilityAfter}
                        suffix="%"
                        higherIsBetter={false}
                      />
                      <StateRow label="Annual income" before={a.impact.incomeBefore} after={a.impact.incomeAfter} decimals={0} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!selected || saving}
            onClick={() => {
              const alt = alternatives?.find((a) => a.symbol === selected);
              if (alt) onApply({ symbol: alt.symbol, holdings: alt.holdings });
            }}
          >
            {saving ? "Swapping…" : selected ? `Swap to ${selected}` : "Pick an alternative"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
