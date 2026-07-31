/**
 * The full scorecard — every scored name, every factor column, sortable.
 *
 * Deliberately the *last* data section rather than the first. It is the complete
 * record and the right tool for interrogating a specific name, but it answers
 * "what does the model think about everything" only by making the reader do the
 * ranking themselves. The sections above already did that work, so this is
 * demoted to a reference table and rendered lazily — it is also the heaviest thing
 * on the page (a row per name, each with bars) and must not compete with first
 * paint.
 */

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/app/_components/ui";
import { signalTone, SIGNAL_LABEL, SIGNAL_ORDER, type ScorecardRow } from "@/lib/engine-desk";
import { DetailPanel } from "./detail-panel";
import { Derivation, ZBar, fmtPct } from "./desk-primitives";

const COLUMNS: [keyof ScorecardRow, string, string][] = [
  ["composite_score", "Composite", "IC-weighted sum of every factor z below"],
  ["momentum_score", "Mom", "12-1 month momentum z"],
  ["quality_score", "Qual", "QMJ quality composite z"],
  ["value_score", "Val", "Yield-space value composite z"],
  ["low_vol_score", "LowVol", "Negative realised vol z"],
  ["revision_score", "Rev", "Earnings revision momentum z"],
  ["regime_score", "Regime", "Probability-weighted expected return"],
  ["forecast_score", "Fcst", "Quantile-model P(up), rescaled to [-1,1]"],
  ["mc_upside", "MC", "Upside to Monte Carlo median"],
  ["kelly_fraction", "Kelly", "Fractional Kelly position size"],
];

export function ScorecardTable({
  rows,
  signalFilter,
  onSignalFilterChange,
  expanded,
  onExpandedChange,
}: {
  rows: ScorecardRow[];
  signalFilter: string;
  onSignalFilterChange: (s: string) => void;
  /** Lifted so the conviction book's "full working" action can open a row here. */
  expanded: string | null;
  onExpandedChange: (symbol: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [sortCol, setSortCol] = useState<keyof ScorecardRow>("composite_score");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const out = rows.filter((r) => {
      if (signalFilter !== "ALL" && r.signal !== signalFilter) return false;
      if (q && !r.symbol.includes(q) && !(r.name ?? "").toUpperCase().includes(q)) return false;
      return true;
    });
    // Sorted on a copy — the caller's array is shared with other sections.
    return out.sort((a, b) => {
      const av = typeof a[sortCol] === "number" ? (a[sortCol] as number) : 0;
      const bv = typeof b[sortCol] === "number" ? (b[sortCol] as number) : 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
  }, [rows, query, signalFilter, sortCol, sortDir]);

  function toggleSort(col: keyof ScorecardRow) {
    if (sortCol === col) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by symbol or name…"
          className="w-56"
          aria-label="Filter scorecard"
        />
        <div className="flex flex-wrap gap-1">
          {(["ALL", ...SIGNAL_ORDER] as const).map((s) => {
            const active = signalFilter === s;
            const tone = s === "ALL" ? null : signalTone(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => onSignalFilterChange(s)}
                aria-pressed={active}
                className={`rounded-control border px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? s === "ALL"
                      ? "border-brand bg-brand/10 text-brand"
                      : `${tone!.chip} ${tone!.text}`
                    : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                {s === "ALL" ? "All" : SIGNAL_LABEL[s] ?? s}
              </button>
            );
          })}
        </div>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-label uppercase tracking-widest text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-semibold">Symbol</th>
              {COLUMNS.map(([col, label, hint]) => (
                <th key={col} scope="col" className="px-3 py-2.5 text-right font-semibold" title={hint}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col)}
                    className="transition-colors hover:text-foreground"
                  >
                    {label}
                    {sortCol === col ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-3 py-2.5 font-semibold">Signal</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold" title="Model confidence in this call">
                Conf
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((row) => {
              const tone = signalTone(row.signal);
              const isOpen = expanded === row.symbol;
              return (
                <tr
                  key={row.symbol}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                  onClick={() => onExpandedChange(isOpen ? null : row.symbol)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onExpandedChange(isOpen ? null : row.symbol);
                    }
                  }}
                  className={`cursor-pointer transition-colors ${isOpen ? "bg-surface-2" : "bg-surface hover:bg-surface-2/70"}`}
                >
                  <td className="px-4 py-2">
                    <div className="flex flex-col">
                      <Link
                        href={`/stocks/${row.symbol}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-mono text-xs font-semibold text-brand hover:underline"
                      >
                        {row.symbol}
                      </Link>
                      {row.name && (
                        <span className="max-w-[10rem] truncate text-label text-faint">{row.name}</span>
                      )}
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <ZBar value={row.composite_score} width="w-14" />
                    </div>
                  </td>

                  {COLUMNS.slice(1).map(([col]) => {
                    const v = (row[col] as number) ?? 0;
                    const isPct = col === "mc_upside" || col === "kelly_fraction";
                    return (
                      <td
                        key={col}
                        className={`px-3 py-2 text-right font-mono text-xs tabular-nums ${
                          isPct ? (v >= 0 ? "text-positive" : "text-negative") : "text-muted"
                        }`}
                      >
                        {isPct
                          ? col === "kelly_fraction"
                            ? `${(v * 100).toFixed(1)}%`
                            : fmtPct(v)
                          : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`}
                      </td>
                    );
                  })}

                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold ${tone.text}`}>
                      {SIGNAL_LABEL[row.signal] ?? row.signal}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-muted">
                    {(row.confidence * 100).toFixed(0)}%
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="px-4 py-8 text-center text-sm text-muted">
                  No names match this filter.
                </td>
              </tr>
            )}

            {/* Detail renders as its own row so the table layout is untouched. */}
            {expanded && filtered.some((r) => r.symbol === expanded) && (
              <tr>
                <td colSpan={COLUMNS.length + 3} className="bg-surface-2/30 p-2">
                  <DetailPanel symbol={expanded} onClose={() => onExpandedChange(null)} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Derivation>
        Every factor column is a cross-sectional z-score computed within sector, so values are
        comparable across names but always relative to this universe — never an absolute rating. Click
        any row for the full working.
      </Derivation>
    </div>
  );
}
