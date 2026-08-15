"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Badge, Button } from "@/app/_components/ui";
import { formatCurrency } from "@/lib/format";
import type { PortfolioAllocation } from "@/lib/portfolio/engines/allocation";
import type { AlignmentReport } from "@/lib/portfolio/alignment/engine";
import type { UniversalRisk } from "@/lib/portfolio/engines/risk";
import type { ScenarioResult } from "@/lib/portfolio/engines/scenario";
import type { UniversalPortfolioReport } from "@/lib/portfolio/report";
import type { SimEvaluation } from "@/lib/portfolio/simulator/evaluate";
import type { Simulation } from "@/lib/portfolio/simulator/types";

/** Everything a side needs to be compared, whatever it came from. Both the
 * real report and a sim evaluation flow through the same engines, so this is
 * a field selection, not a translation. */
interface CompareSide {
  name: string;
  kind: "real" | "simulation";
  currency: string;
  totalValue: number;
  annualIncome: number;
  incomeYieldPct: number;
  allocation: PortfolioAllocation;
  alignment: AlignmentReport;
  risk: UniversalRisk;
  scenarios: ScenarioResult[];
}

export type CompareTarget = { kind: "real" } | { kind: "simulation"; id: string };

/**
 * Side-by-side comparison: a simulation vs the real portfolio, or vs another
 * simulation. Deltas are toned ONLY where one direction is unambiguously
 * better (alignment up, volatility down); scale numbers like total value get a
 * neutral delta — a bigger book is not a better book.
 */
export function ComparePanel({
  sim,
  simulations,
  realPortfolioHasHoldings,
}: {
  sim: Simulation;
  simulations: Simulation[];
  realPortfolioHasHoldings: boolean;
}) {
  // Memoized so `load` keeps a stable identity across re-renders — the effect
  // below cleans up (aborting the in-flight fetch) whenever `load` changes.
  const otherSims = useMemo(
    () => simulations.filter((s) => s.id !== sim.id && s.holdings.length > 0),
    [simulations, sim.id],
  );
  const [target, setTarget] = useState<CompareTarget>(
    realPortfolioHasHoldings ? { kind: "real" } : { kind: "simulation", id: otherSims[0]?.id ?? "" },
  );
  const [left, setLeft] = useState<CompareSide | null>(null);
  const [right, setRight] = useState<CompareSide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setLeft(null);
    setRight(null);
    try {
      const simSide = async (s: Simulation): Promise<CompareSide> => {
        const res = await fetch("/api/portfolio/simulator/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: s.id }),
          signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Failed to evaluate ${s.name}`);
        const ev = json.evaluation as SimEvaluation;
        return {
          name: s.name,
          kind: "simulation",
          currency: s.profile.currency,
          totalValue: ev.totalValue,
          annualIncome: ev.annualIncome,
          incomeYieldPct: ev.incomeYieldPct,
          allocation: ev.allocation,
          alignment: ev.alignment,
          risk: ev.risk,
          scenarios: ev.scenarios,
        };
      };
      const realSide = async (): Promise<CompareSide> => {
        const res = await fetch("/api/portfolio/report?objective=maximize_sharpe", { signal: controller.signal });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load your real portfolio");
        const r = json as UniversalPortfolioReport;
        return {
          name: "Your real portfolio",
          kind: "real",
          currency: r.baseCurrency,
          totalValue: r.totalValue,
          annualIncome: r.annualIncome,
          incomeYieldPct: r.incomeYieldPct,
          allocation: r.allocation,
          alignment: r.alignment,
          risk: r.risk,
          scenarios: r.scenarios,
        };
      };

      const other = target.kind === "real" ? realSide() : simSide(otherSims.find((s) => s.id === target.id)!);
      const [a, b] = await Promise.all([simSide(sim), other]);
      setLeft(a);
      setRight(b);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Comparison failed");
    }
  }, [sim, target, otherSims]);

  // The cleanup aborts AND resets the guard — StrictMode's dev double-mount
  // runs effect → cleanup → effect, and a guard that stays latched leaves the
  // aborted first request as the only one ever made (the dead-interview bug
  // intake-chat already hit).
  const startedRef = useRef<string>("");
  useEffect(() => {
    const key = `${sim.id}|${JSON.stringify(target)}`;
    if (startedRef.current === key) return;
    startedRef.current = key;
    void load();
    return () => {
      startedRef.current = "";
      abortRef.current?.abort();
    };
  }, [load, sim.id, target]);

  const noTarget = !realPortfolioHasHoldings && otherSims.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── What to compare against ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted">Compare against:</span>
        {realPortfolioHasHoldings && (
          <TargetChip
            active={target.kind === "real"}
            onClick={() => setTarget({ kind: "real" })}
            label="Your real portfolio"
          />
        )}
        {otherSims.map((s) => (
          <TargetChip
            key={s.id}
            active={target.kind === "simulation" && target.id === s.id}
            onClick={() => setTarget({ kind: "simulation", id: s.id })}
            label={s.name}
          />
        ))}
      </div>

      {noTarget && (
        <Card className="p-6 text-center">
          <p className="text-xs text-muted">
            Nothing to compare against yet — your real portfolio is empty and no other saved
            simulation has holdings.
          </p>
        </Card>
      )}

      {error && (
        <Card className="flex items-center justify-between gap-3 border-negative/25 bg-negative/5 p-4">
          <p className="text-xs text-negative">{error}</p>
          <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
        </Card>
      )}

      {!noTarget && !error && (!left || !right) && (
        <Card className="p-5">
          <p className="animate-pulse text-xs text-muted">Pricing and scoring both books…</p>
        </Card>
      )}

      {left && right && <CompareBody a={left} b={right} />}
    </div>
  );
}

function TargetChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`max-w-[16rem] truncate rounded-lg border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-brand bg-brand/10 font-semibold text-foreground"
          : "border-border text-muted hover:border-brand/40 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/* ─────────────────────────── the comparison body ───────────────────────── */

function CompareBody({ a, b }: { a: CompareSide; b: CompareSide }) {
  const sameCurrency = a.currency === b.currency;
  const money = (v: number, side: CompareSide) => formatCurrency(v, side.currency);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header: who is who ── */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <SideHeader side={a} align="left" />
        <span className="text-xs font-semibold text-muted">vs</span>
        <SideHeader side={b} align="right" />
      </div>

      {!sameCurrency && (
        <p className="rounded-lg border border-warning/25 bg-warning/[0.04] px-3 py-2 text-[11px] leading-relaxed text-muted">
          The books are denominated in different currencies ({a.currency} vs {b.currency}) — money
          amounts are shown in each book&apos;s own currency and their deltas are omitted.
        </p>
      )}

      {/* ── Headline ── */}
      <CompareSection title="Headline">
        {/* Skipped entirely when either side is unscorable: a delta between a
            score and a non-score is unknown, not zero. */}
        {a.alignment.scoreExact != null && b.alignment.scoreExact != null && (
          <CompareRow label="Alignment score" a={a.alignment.scoreExact} b={b.alignment.scoreExact} format={(v) => String(Math.round(v))} higherBetter />
        )}
        <CompareRow
          label="Total value"
          a={sameCurrency ? a.totalValue : null}
          b={sameCurrency ? b.totalValue : null}
          textA={money(a.totalValue, a)}
          textB={money(b.totalValue, b)}
          format={(v) => formatCurrency(v, a.currency)}
          higherBetter={null}
        />
        <CompareRow
          label="Annual income"
          a={sameCurrency ? a.annualIncome : null}
          b={sameCurrency ? b.annualIncome : null}
          textA={money(a.annualIncome, a)}
          textB={money(b.annualIncome, b)}
          format={(v) => formatCurrency(v, a.currency)}
          higherBetter
        />
        <CompareRow label="Income yield" a={a.incomeYieldPct} b={b.incomeYieldPct} format={(v) => `${v.toFixed(2)}%`} higherBetter />
      </CompareSection>

      {/* ── Risk ── */}
      <CompareSection title="Risk">
        <CompareRow label="Annualized volatility" a={a.risk.annualizedVolatility} b={b.risk.annualizedVolatility} format={(v) => `${v.toFixed(1)}%`} higherBetter={false} />
        <CompareRow label={`Beta vs ${a.risk.benchmarkLabel ?? "benchmark"}`} a={a.risk.beta} b={b.risk.beta} format={(v) => v.toFixed(2)} higherBetter={null} />
        <CompareRow label="Sharpe ratio" a={a.risk.sharpeRatio} b={b.risk.sharpeRatio} format={(v) => v.toFixed(2)} higherBetter />
        <CompareRow label="Max drawdown" a={a.risk.maxDrawdown} b={b.risk.maxDrawdown} format={(v) => `${v.toFixed(1)}%`} higherBetter={false} />
        <CompareRow label="1-day VaR (95%)" a={a.risk.var95Pct} b={b.risk.var95Pct} format={(v) => `${v.toFixed(2)}%`} higherBetter={false} />
        <CompareRow label="Illiquid share" a={a.risk.illiquidPct} b={b.risk.illiquidPct} format={(v) => `${v.toFixed(1)}%`} higherBetter={false} />
        <CompareRow label="Top holding weight" a={a.risk.topHoldingWeight} b={b.risk.topHoldingWeight} format={(v) => `${v.toFixed(1)}%`} higherBetter={false} />
        <CompareRow label="Foreign currency" a={a.risk.foreignCurrencyPct} b={b.risk.foreignCurrencyPct} format={(v) => `${v.toFixed(1)}%`} higherBetter={null} />
      </CompareSection>

      {/* ── Allocation mix ── */}
      <CompareSection title="Asset allocation">
        <AllocationCompare a={a} b={b} />
      </CompareSection>

      {/* ── Stress tests ── */}
      <CompareSection title="Stress tests — projected portfolio impact">
        <ScenarioCompare a={a} b={b} />
      </CompareSection>
    </div>
  );
}

function SideHeader({ side, align }: { side: CompareSide; align: "left" | "right" }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${align === "right" ? "items-end text-right" : ""}`}>
      <div className={`flex min-w-0 items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{side.name}</span>
        <Badge variant={side.kind === "real" ? "brand" : "neutral"}>
          {side.kind === "real" ? "Real" : "Simulation"}
        </Badge>
      </div>
      {/* Null-safe: an unscorable book reads "—", never a fabricated midpoint. */}
      <span className="flex items-baseline gap-1.5" title={side.alignment.summary}>
        <span className="text-[10px] uppercase tracking-widest text-muted">Alignment</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {side.alignment.score ?? "—"}
        </span>
        {side.alignment.score != null && <span className="font-mono text-[10px] text-muted/50">/100</span>}
      </span>
    </div>
  );
}

function CompareSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <h3 className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      <div className="flex flex-col divide-y divide-border/40">{children}</div>
    </Card>
  );
}

/** One metric across both books. Delta is toned only when `higherBetter` is a
 * boolean; null values render as "—" and produce no delta at all. */
function CompareRow({
  label,
  a,
  b,
  format = (v: number) => String(v),
  higherBetter = null,
  textA,
  textB,
}: {
  label: string;
  a: number | null;
  b: number | null;
  format?: (v: number) => string;
  higherBetter?: boolean | null;
  /** Pre-formatted display overrides (e.g. cross-currency money). */
  textA?: string;
  textB?: string;
}) {
  const delta = a != null && b != null ? a - b : null;
  let tone = "text-muted";
  if (delta !== null && higherBetter !== null && Math.abs(delta) > 1e-9) {
    tone = delta > 0 === higherBetter ? "text-positive" : "text-negative";
  }
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 py-1.5 text-xs">
      <span className="font-mono tabular-nums text-foreground">{textA ?? (a != null ? format(a) : "—")}</span>
      <span className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-muted">{label}</span>
        {delta !== null && Math.abs(delta) > 1e-9 && (
          <span className={`font-mono text-[10px] tabular-nums ${tone}`}>
            {delta > 0 ? "▲" : "▼"} {format(Math.abs(delta))}
          </span>
        )}
      </span>
      <span className="text-right font-mono tabular-nums text-foreground">{textB ?? (b != null ? format(b) : "—")}</span>
    </div>
  );
}

/** Paired horizontal bars per asset class, aligned to a shared scale. */
function AllocationCompare({ a, b }: { a: CompareSide; b: CompareSide }) {
  const keys = new Map<string, string>();
  for (const s of a.allocation.byAssetClass.slices) keys.set(s.key, s.label);
  for (const s of b.allocation.byAssetClass.slices) if (!keys.has(s.key)) keys.set(s.key, s.label);
  const weightOf = (side: CompareSide, key: string) =>
    side.allocation.byAssetClass.slices.find((s) => s.key === key)?.weight ?? 0;
  const rows = [...keys.entries()]
    .map(([key, label]) => ({ key, label, wa: weightOf(a, key), wb: weightOf(b, key) }))
    .sort((x, y) => Math.max(y.wa, y.wb) - Math.max(x.wa, x.wb));
  const max = Math.max(...rows.map((r) => Math.max(r.wa, r.wb)), 1);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[1fr_7rem_1fr] items-center gap-3">
          {/* left bar grows leftwards so the two books mirror each other */}
          <div className="flex items-center justify-end gap-2">
            <span className="font-mono text-[11px] tabular-nums text-foreground">{r.wa.toFixed(1)}%</span>
            <div className="h-1.5 w-full max-w-full overflow-hidden rounded-full bg-surface-2" dir="rtl">
              <div className="h-full rounded-full bg-brand/60" style={{ width: `${(r.wa / max) * 100}%` }} />
            </div>
          </div>
          <span className="text-center text-[11px] text-muted">{r.label}</span>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent-strong/60" style={{ width: `${(r.wb / max) * 100}%` }} />
            </div>
            <span className="font-mono text-[11px] tabular-nums text-foreground">{r.wb.toFixed(1)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The scenarios where the two books genuinely diverge, worst divergence first. */
function ScenarioCompare({ a, b }: { a: CompareSide; b: CompareSide }) {
  const byId = new Map(b.scenarios.map((s) => [s.id, s]));
  const rows = a.scenarios
    .map((s) => ({ id: s.id, name: s.name, ia: s.portfolioImpactPct, ib: byId.get(s.id)?.portfolioImpactPct ?? null }))
    .sort((x, y) => Math.abs((y.ia ?? 0) - (y.ib ?? 0)) - Math.abs((x.ia ?? 0) - (x.ib ?? 0)))
    .slice(0, 8);

  return (
    <div className="flex flex-col divide-y divide-border/40">
      {rows.map((r) => (
        <CompareRow
          key={r.id}
          label={r.name}
          a={r.ia}
          b={r.ib}
          format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}
          higherBetter
        />
      ))}
      <p className="pt-2 text-[10px] leading-relaxed text-muted/70">
        Showing the 8 scenarios where the two books diverge most. A less negative number means the
        book loses less in that scenario.
      </p>
    </div>
  );
}
