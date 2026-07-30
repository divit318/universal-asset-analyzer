"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "@/app/_components/dialog";
import { Badge, Button, Input, Field } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { PortfolioMeta } from "@/lib/db";
import type { SimEvaluation } from "@/lib/portfolio/simulator/evaluate";
import type { Simulation } from "@/lib/portfolio/simulator/types";

interface TradeRow {
  key: string; // symbol or "CASH"
  symbol: string | null;
  name: string;
  quantity: number;
  value: number | null;
  reason: string | null;
  selected: boolean;
}

type Destination = { kind: "new"; name: string } | { kind: "existing"; portfolioId: number };

/**
 * Promote a simulation to real holdings — never a silent copy. Step 1 is the
 * reviewable trade list (the Optimize tab's BUY-rows-with-reasons pattern,
 * selectable per row); step 2 picks where the positions land: a brand-new
 * named portfolio, or merged into an existing one (overlaps net into a single
 * position via the lot ledger — duplicates are structurally impossible).
 */
export function PromoteDialog({
  sim,
  onPromoted,
  onClose,
}: {
  sim: Simulation;
  onPromoted: (sim: Simulation, portfolioName: string) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<TradeRow[] | null>(null);
  const [portfolios, setPortfolios] = useState<PortfolioMeta[] | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [dest, setDest] = useState<Destination>({ kind: "new", name: sim.name });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const startedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    try {
      const [evalRes, listRes] = await Promise.all([
        fetch("/api/portfolio/simulator/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: sim.id }),
          signal: controller.signal,
        }),
        fetch("/api/portfolio/portfolios", { signal: controller.signal }),
      ]);
      const evalJson = await evalRes.json();
      if (!evalRes.ok) throw new Error(evalJson.error ?? "Failed to price the trade list");
      const listJson = await listRes.json();
      if (!listRes.ok) throw new Error(listJson.error ?? "Failed to load portfolios");

      const ev = evalJson.evaluation as SimEvaluation;
      const liveBySymbol = new Map(ev.holdings.map((h) => [h.symbol ?? "CASH", h]));
      setRows(
        sim.holdings.map((h) => {
          const key = h.symbol ?? "CASH";
          return {
            key,
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            value: liveBySymbol.get(key)?.valuation.valueBase ?? null,
            reason: h.rationale,
            selected: true,
          };
        }),
      );
      setPortfolios(listJson.portfolios as PortfolioMeta[]);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to prepare the promotion");
    }
  }, [sim]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
    return () => {
      startedRef.current = false;
      abortRef.current?.abort();
    };
  }, [load]);

  const selected = rows?.filter((r) => r.selected) ?? [];
  const total = selected.reduce((s, r) => s + (r.value ?? 0), 0);
  const destValid =
    dest.kind === "new" ? dest.name.trim().length > 0 && dest.name.trim().length <= 80 : dest.portfolioId > 0;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/simulator/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sim.id,
          destination:
            dest.kind === "new"
              ? { kind: "new", name: dest.name.trim() }
              : { kind: "existing", portfolioId: dest.portfolioId },
          symbols: selected.map((r) => r.key),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Promotion failed");
      onPromoted(json.simulation as Simulation, (json.portfolio as PortfolioMeta).name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Promotion failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onClose={submitting ? () => {} : onClose}
      title={step === 1 ? "Review the trade list" : "Where should these positions live?"}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        {error && (
          <div className="flex flex-col gap-2 rounded-lg border border-negative/25 bg-negative/5 p-3">
            <p className="text-xs text-negative">{error}</p>
            {!rows && (
              <Button size="xs" variant="secondary" onClick={load} className="self-start">
                Retry
              </Button>
            )}
          </div>
        )}

        {!rows && !error && (
          <p className="animate-pulse text-xs text-muted">Pricing the trade list against live quotes…</p>
        )}

        {rows && step === 1 && (
          <>
            <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-lg border border-border/60 bg-surface/30 px-3 py-2">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-0.5 border-b border-border/30 py-1.5 last:border-b-0">
                  <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() =>
                          setRows((rs) => rs!.map((x) => (x.key === r.key ? { ...x, selected: !x.selected } : x)))
                        }
                        className="accent-brand"
                      />
                      <Badge variant="positive">BUY</Badge>
                      <span className="font-semibold text-foreground">{r.key}</span>
                      <span className="min-w-0 truncate text-muted">{r.name}</span>
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-muted">
                      {r.symbol ? `${r.quantity.toLocaleString("en-US")} × ` : ""}
                      {r.value != null ? formatCurrency(r.value, sim.profile.currency) : "—"}
                    </span>
                  </label>
                  {r.reason && <p className="pl-6 text-[10px] leading-relaxed text-muted/80">{r.reason}</p>}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">
                {selected.length} of {rows.length} trades selected
              </span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {formatCurrency(total, sim.profile.currency)}
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              Positions are written at the live price at execution time. The simulation itself stays
              saved and comparable — promoting copies it into reality, it does not consume it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button variant="primary" size="sm" disabled={selected.length === 0} onClick={() => setStep(2)}>
                Choose destination →
              </Button>
            </div>
          </>
        )}

        {rows && step === 2 && (
          <>
            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="promote-dest"
                  checked={dest.kind === "new"}
                  onChange={() => setDest({ kind: "new", name: dest.kind === "new" ? dest.name : sim.name })}
                  className="mt-0.5 accent-brand"
                />
                <span className="flex w-full flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">As a new, separate portfolio</span>
                  {dest.kind === "new" && (
                    <Field label="Portfolio name">
                      <Input
                        value={dest.name}
                        onChange={(e) => setDest({ kind: "new", name: e.target.value })}
                        maxLength={80}
                        autoFocus
                      />
                    </Field>
                  )}
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="promote-dest"
                  checked={dest.kind === "existing"}
                  onChange={() => setDest({ kind: "existing", portfolioId: portfolios?.[0]?.id ?? 1 })}
                  className="mt-0.5 accent-brand"
                />
                <span className="flex w-full flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Merged into an existing portfolio</span>
                  <span className="text-[10px] leading-relaxed text-muted">
                    Overlapping tickers are netted into a single position, never duplicated.
                  </span>
                  {dest.kind === "existing" && (
                    <span className="flex flex-wrap gap-1.5">
                      {(portfolios ?? []).map((pf) => (
                        <button
                          key={pf.id}
                          type="button"
                          aria-pressed={dest.portfolioId === pf.id}
                          onClick={() => setDest({ kind: "existing", portfolioId: pf.id })}
                          className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                            dest.portfolioId === pf.id
                              ? "border-brand bg-brand/10 font-semibold text-foreground"
                              : "border-border text-muted hover:border-brand/40 hover:text-foreground"
                          }`}
                        >
                          {pf.name}
                        </button>
                      ))}
                    </span>
                  )}
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={submitting}>
                ← Back to trades
              </Button>
              <Button variant="primary" size="sm" disabled={!destValid || submitting} onClick={submit}>
                {submitting
                  ? "Executing…"
                  : `Execute ${selected.length} trade${selected.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
