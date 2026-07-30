/**
 * The conviction book — the desk's ranked longs and shorts for today.
 *
 * Three things make this not a Screener results table:
 *
 *   1. It is ranked by score × confidence, not score. A high composite the model
 *      does not trust ranks below a moderate one it does, which is the whole
 *      point of carrying a confidence estimate at all.
 *   2. Every row carries its probability band (P10–P90) and P(up), so the reader
 *      sees a distribution rather than a verdict. Screener answers "does this
 *      name pass"; this answers "what is the shape of the outcome".
 *   3. It sizes the position. The Kelly fraction is the bridge from a signal to
 *      an actual trade, and no other module in UAA computes one.
 */

"use client";

import Link from "next/link";
import { useState } from "react";
import { Reveal } from "@/app/_components/reveal";
import { signalTone, SIGNAL_LABEL, WEIGHTED_FACTORS, scoreKey, FACTOR_META, type ConvictionRow } from "@/lib/engine-desk";
import { Derivation, ProbBand, ProbMeter, ZBar, fmtPct, fmtZ } from "./desk-primitives";

type Side = "longs" | "shorts";

export function ConvictionBook({
  longs,
  shorts,
  hasForecasts,
  onInspect,
}: {
  longs: ConvictionRow[];
  shorts: ConvictionRow[];
  hasForecasts: boolean;
  /** Opens the full mathematical working for one name (the scorecard's detail panel). */
  onInspect: (symbol: string) => void;
}) {
  const [side, setSide] = useState<Side>(longs.length === 0 && shorts.length > 0 ? "shorts" : "longs");
  const rows = side === "longs" ? longs : shorts;

  // One shared axis across every band on screen, so band widths are comparable
  // between rows instead of each row self-scaling.
  const bandScale = Math.max(
    0.05,
    ...rows.flatMap((r) => [Math.abs(r.forecast?.p10 ?? 0), Math.abs(r.forecast?.p90 ?? 0)]),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Side switch */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-control border border-border p-0.5">
          {(["longs", "shorts"] as const).map((s) => {
            const count = s === "longs" ? longs.length : shorts.length;
            const active = side === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? s === "longs"
                      ? "bg-positive/15 text-positive"
                      : "bg-negative/15 text-negative"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {s === "longs" ? "Longs" : "Shorts"}
                <span className="ml-1.5 font-mono tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
        <Derivation>
          Ranked by composite × confidence — a strong score the model doesn&apos;t trust ranks below a
          moderate one it does.
        </Derivation>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          The engine has no actionable {side} in this universe today. That is a result, not a gap —
          in a {side === "longs" ? "weak" : "strong"} tape the model is supposed to stay flat.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Column legend — the band axis needs stating once. */}
          <div className="hidden grid-cols-[1fr_5.5rem_1fr_4rem_4.5rem] items-center gap-3 px-3 text-label font-semibold uppercase tracking-widest text-muted/60 lg:grid">
            <span>Name</span>
            <span className="text-right">Composite</span>
            <span className="text-center">
              Return band {hasForecasts ? `(±${(bandScale * 100).toFixed(0)}%, 1m)` : ""}
            </span>
            <span className="text-right">P(up)</span>
            <span className="text-right">Kelly</span>
          </div>

          {rows.map((row, i) => (
            <Reveal key={row.symbol} index={i}>
              <ConvictionRowCard row={row} rank={i + 1} bandScale={bandScale} onInspect={onInspect} />
            </Reveal>
          ))}
        </div>
      )}

      {!hasForecasts && rows.length > 0 && (
        <Derivation>
          Probability bands need the forecast stage — run the engine with forecasts enabled to
          populate P10/P50/P90 and P(up) here.
        </Derivation>
      )}
    </div>
  );
}

function ConvictionRowCard({
  row,
  rank,
  bandScale,
  onInspect,
}: {
  row: ConvictionRow;
  rank: number;
  bandScale: number;
  onInspect: (symbol: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tone = signalTone(row.signal);
  const conviction = (row.composite_score ?? 0) * (row.confidence ?? 0);

  return (
    <div
      className={`overflow-hidden rounded-card border border-border bg-surface transition-[border-color,background-color] duration-200 hover:border-border-strong hover:bg-surface-2/50`}
    >
      <div className="grid items-center gap-3 p-3 lg:grid-cols-[1fr_5.5rem_1fr_4rem_4.5rem]">
        {/* Name + tier */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="w-5 shrink-0 font-mono text-label tabular-nums text-faint">{rank}</span>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2">
              <Link
                href={`/stocks/${row.symbol}`}
                className="font-mono text-sm font-semibold text-brand hover:underline"
              >
                {row.symbol}
              </Link>
              <span className={`rounded border px-1.5 py-0.5 text-label font-semibold uppercase ${tone.chip} ${tone.text}`}>
                {SIGNAL_LABEL[row.signal] ?? row.signal}
              </span>
            </div>
            <span className="truncate text-caption text-muted" title={row.name ?? undefined}>
              {row.name ?? row.sector ?? "—"}
            </span>
          </div>
        </div>

        {/* Composite */}
        <div className="flex flex-col items-end gap-1">
          <span className={`font-mono text-sm font-semibold tabular-nums ${row.composite_score >= 0 ? "text-positive" : "text-negative"}`}>
            {fmtZ(row.composite_score)}
          </span>
          <ZBar value={row.composite_score} width="w-16" showValue={false} />
        </div>

        {/* Probability band */}
        <div className="flex flex-col gap-1">
          <ProbBand
            p10={row.forecast?.p10 ?? null}
            p50={row.forecast?.p50 ?? null}
            p90={row.forecast?.p90 ?? null}
            scale={bandScale}
          />
          {row.forecast && (
            <div className="flex justify-between font-mono text-label tabular-nums text-faint">
              <span>{fmtPct(row.forecast.p10)}</span>
              <span className="text-muted">{fmtPct(row.forecast.p50)}</span>
              <span>{fmtPct(row.forecast.p90)}</span>
            </div>
          )}
        </div>

        {/* P(up) */}
        <span
          className={`text-right font-mono text-sm tabular-nums ${
            row.forecast?.prob_up == null
              ? "text-faint"
              : row.forecast.prob_up > 0.55
                ? "text-positive"
                : row.forecast.prob_up < 0.45
                  ? "text-negative"
                  : "text-warning"
          }`}
        >
          {row.forecast?.prob_up == null ? "—" : `${(row.forecast.prob_up * 100).toFixed(0)}%`}
        </span>

        {/* Kelly + expand */}
        <div className="flex items-center justify-end gap-2">
          <span className="font-mono text-sm tabular-nums" title="Fractional Kelly (0.25×), capped at 15%">
            {(row.kelly_fraction * 100).toFixed(1)}%
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} factor attribution for ${row.symbol}`}
            className="rounded-control p-1 text-faint transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <svg
              width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7"
              className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            >
              <path d="M4 6.5L8 10.5L12 6.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Factor attribution — why this name, not just how much. Uses the shipped
          collapse-grid so the body can size itself without a JS measure pass. */}
      <div className={`collapse-grid ${open ? "is-open" : ""}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-border bg-surface-2/40 p-3">
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {WEIGHTED_FACTORS.map((factor) => {
                const meta = FACTOR_META[factor];
                const value = (row as unknown as Record<string, number>)[scoreKey(factor)] ?? 0;
                return (
                  <div key={factor} className="flex items-center justify-between gap-3" title={meta?.desc}>
                    <span className="text-xs text-muted">{meta?.label ?? factor}</span>
                    <ZBar value={value} width="w-20" />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/70">
                  Model confidence
                </span>
                <ProbMeter prob={row.confidence} height="h-1.5" />
              </div>
              <span className="font-mono text-label tabular-nums text-faint">
                conviction = {fmtZ(conviction, 3)}
              </span>
              <button
                type="button"
                onClick={() => onInspect(row.symbol)}
                className="rounded-control border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground"
              >
                Full working →
              </button>
              {/* The engine ranks and sizes; it does not re-implement the
                  9-agent fundamental workup that /ic-report already owns. */}
              <Link
                href={`/ic-report?symbol=${encodeURIComponent(row.symbol)}`}
                className="text-xs text-brand hover:underline"
              >
                Fundamental deep dive ↗
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
