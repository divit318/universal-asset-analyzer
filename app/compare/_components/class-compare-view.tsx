"use client";

import Link from "next/link";
import { useState } from "react";
import type { AssetClassId } from "@/lib/assets/types";
import type { ClassCompareEntry } from "@/lib/compare/types";
import type { PeerBenchmark } from "@/lib/compare/benchmarks";
import {
  classSections,
  compositeScoreSection,
  classKeyFacts,
  classTagAttrs,
  getRawValue,
  type ClassSectionDef,
  type ClassMetricDef,
} from "./class-sections";
import { ClassCompareRadar } from "./class-radar-chart";
import { ClassPerformanceChart } from "./class-performance-chart";
import { CompareScatterChart, type ScatterAxis } from "./scatter-chart";
import { FuturesCurveChart } from "./futures-curve-chart";
import { DilutionChart } from "./dilution-chart";
import { BenchmarkSection } from "./class-benchmark-section";
import { HoldingsOverlapSection } from "./class-holdings-overlap";
import { RiskFlagsSection } from "./class-risk-flags";
import { ClassAiVerdict } from "./class-ai-verdict";
import { useInViewOnce } from "@/app/_components/use-in-view-once";
import { Collapsible } from "./collapsible-section";
import { CountUp } from "@/app/_components/count-up";
import {
  useHoverSymbol,
  useHoverHandlers,
  useSymbolEmphasis,
  emphasisClassName,
  type SymbolEmphasis,
} from "./hover-symbol-context";
import { CHART_SERIES } from "@/app/_components/chart-theme";
import { DataProvenance } from "@/app/_components/data-provenance";

const COLORS = CHART_SERIES;
const COLOR_BG = [
  "bg-purple-500/10 border-purple-500/30",
  "bg-orange-500/10 border-orange-500/30",
  "bg-teal-500/10 border-teal-500/30",
  "bg-pink-500/10 border-pink-500/30",
  "bg-slate-500/10 border-slate-500/30",
];

/* -------------------------------------------------------------------------- */
/* Signature chart — one per class, chosen for how that asset is actually     */
/* evaluated, not a template slot every class fills identically.              */
/* -------------------------------------------------------------------------- */

function SignatureChart({ assetClass, entries }: { assetClass: AssetClassId; entries: ClassCompareEntry[] }) {
  const pct = (v: number) => `${v.toFixed(1)}%`;
  const xRatio = (v: number) => `${v.toFixed(1)}x`;
  const yrs = (v: number) => `${v.toFixed(1)}y`;
  const usd = (v: number) => `$${(v / 1e9).toFixed(1)}B`;

  switch (assetClass) {
    case "etf": {
      const x: ScatterAxis = { key: "expenseRatio", label: "Expense Ratio", format: pct };
      const y: ScatterAxis = { key: "oneYearReturn", label: "1-Year Return", format: pct };
      const size: ScatterAxis = { key: "aum", label: "AUM", format: usd };
      return <CompareScatterChart entries={entries} title="Cost vs. Return" subtitle="Cheaper, higher-returning funds sit toward the top-left; larger bubbles are larger funds." x={x} y={y} size={size} />;
    }
    case "reit": {
      const x: ScatterAxis = { key: "netDebtToEbitda", label: "Net Debt / EBITDA", format: xRatio };
      const y: ScatterAxis = { key: "ffoYield", label: "FFO Yield", format: pct };
      const size: ScatterAxis = { key: "marketCap", label: "Market Cap", format: usd };
      return <CompareScatterChart entries={entries} title="FFO Yield vs. Leverage" subtitle="Yield compensated by a clean balance sheet sits toward the top-left; larger bubbles are larger REITs." x={x} y={y} size={size} />;
    }
    case "bond": {
      const x: ScatterAxis = { key: "duration", label: "Duration", format: yrs };
      const y: ScatterAxis = { key: "yield", label: "Yield", format: pct };
      const size: ScatterAxis = { key: "aum", label: "AUM", format: usd };
      return <CompareScatterChart entries={entries} title="Yield vs. Duration" subtitle="No universal 'better' direction — duration is rate exposure, not quality." x={x} y={y} size={size} />;
    }
    case "forex": {
      const x: ScatterAxis = { key: "volatility", label: "Volatility (ann.)", format: pct };
      const y: ScatterAxis = { key: "carryToVol", label: "Carry / Volatility", format: xRatio };
      return <CompareScatterChart entries={entries} title="Carry vs. Volatility" subtitle="Risk-adjusted carry — the pair actually being paid for the risk sits toward the top-left." x={x} y={y} />;
    }
    case "commodity":
      return <FuturesCurveChart entries={entries} />;
    case "crypto":
      return <DilutionChart entries={entries} />;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Header cards                                                               */
/* -------------------------------------------------------------------------- */

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-right text-xs text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color, opacity: 0.8 }} />
      </div>
      <span className="w-8 text-right font-mono text-xs font-semibold" style={{ color }}>{Math.round(value)}</span>
    </div>
  );
}

/** Compact glance card: identity, price, a short class-specific fact strip, one Overall Score bar (not every axis — the full breakdown lives in the Composite Scores table below), and any risk flags. */
function ClassStockCard({
  entry,
  color,
  colorBg,
  assetClass,
}: {
  entry: ClassCompareEntry;
  color: string;
  colorBg: string;
  assetClass: AssetClassId;
}) {
  // Hooks must run unconditionally — before the error-state early return below.
  const emphasis = useSymbolEmphasis(entry.symbol);
  const hoverHandlers = useHoverHandlers(entry.symbol);

  if (entry.error) {
    return (
      <div className="rounded-xl border border-negative/30 bg-negative/5 p-4">
        <span className="font-mono font-semibold" style={{ color }}>{entry.symbol}</span>
        <p className="mt-1 text-xs text-negative">{entry.error}</p>
      </div>
    );
  }

  const pos = (entry.changePercent ?? 0) >= 0;
  const facts = classKeyFacts(assetClass);
  const tags = classTagAttrs(assetClass)
    .map((attr) => entry.attributes[attr])
    .filter((v): v is string => Boolean(v));

  return (
    <div
      {...hoverHandlers}
      className={`overflow-hidden rounded-xl border p-4 ${colorBg} ${emphasisClassName(emphasis)} ${emphasis === "active" ? "shadow-glow-brand" : ""}`}
    >
      <div className="min-w-0">
        <Link href={`/research?symbol=${entry.symbol}`} className="font-mono text-lg font-bold hover:underline" style={{ color }}>
          {entry.symbol}
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted" title={entry.name}>{entry.name}</p>
      </div>

      {tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((t) => (
            <span key={t} className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{t}</span>
          ))}
        </div>
      )}

      {entry.price != null && (
        <div className="mt-3">
          <div className="font-mono text-xl font-semibold">${entry.price.toFixed(2)}</div>
          {entry.changePercent != null && (
            <div className={`text-xs font-mono ${pos ? "text-positive" : "text-negative"}`}>
              {pos ? "+" : ""}{entry.changePercent.toFixed(2)}%
            </div>
          )}
        </div>
      )}

      {facts.length > 0 && (
        <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
          {facts.map((f) => {
            const v = entry.metrics[f.key];
            return (
              <div key={f.key}>
                <p className="text-[10px] text-muted">{f.label}</p>
                <p className="font-mono text-xs font-semibold text-foreground">{v != null ? f.format(v) : "—"}</p>
              </div>
            );
          })}
        </div>
      )}

      {entry.scores.overall != null && (
        <div className="mt-3">
          <ScoreBar label="Overall" value={entry.scores.overall} color={color} />
        </div>
      )}

      {entry.riskFlags && entry.riskFlags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {entry.riskFlags.map((f) => (
            <span key={f.id} className="rounded-full border border-negative/30 bg-negative/10 px-1.5 py-0.5 text-[10px] text-negative">
              ⚠ {f.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric table — same ▲/▼ best/worst convention as equity's                  */
/* -------------------------------------------------------------------------- */

interface WinnerInfo { bestIdx: number; worstIdx: number }

function findWinners(values: (number | null)[], higherBetter: boolean | null): WinnerInfo | null {
  if (higherBetter == null) return null;
  const valid = values.map((v, i) => ({ v: v!, i })).filter((x) => x.v != null);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
  return { bestIdx: sorted[0].i, worstIdx: sorted[sorted.length - 1].i };
}

/** e.g. "Large Growth ETFs avg 29.4x · 73rd pct" — omitted entirely when no reliable peer benchmark exists for this cell. */
function BenchmarkNote({ benchmark, format }: { benchmark: PeerBenchmark; format: (v: number) => string }) {
  return (
    <p className="mt-0.5 text-label leading-tight text-muted" title={`vs ${benchmark.peerCount} peers`}>
      {benchmark.peerLabel} avg {format(benchmark.peerAverage)} · {benchmark.percentile}th pct
    </p>
  );
}

function MetricLabelCell({ metric }: { metric: ClassMetricDef }) {
  return (
    <td className="relative px-4 py-2.5">
      <span
        aria-hidden
        className="absolute left-0 top-1/2 h-4 w-0.5 origin-center -translate-y-1/2 scale-y-0 rounded-full bg-brand transition-transform duration-200 ease-out group-hover:scale-y-100"
      />
      <span className="text-xs text-foreground transition-transform duration-200 ease-out group-hover:translate-x-1">{metric.label}</span>
      {metric.sub && <p className="text-label text-muted">{metric.sub}</p>}
      {metric.description && (
        <p className="max-h-0 overflow-hidden text-label leading-tight text-muted/80 opacity-0 transition-[max-height,opacity,margin-top] duration-200 ease-out group-hover:mt-1 group-hover:max-h-6 group-hover:opacity-100">
          {metric.description}
        </p>
      )}
    </td>
  );
}

function MetricRow({ metric, entries }: { metric: ClassMetricDef; entries: ClassCompareEntry[] }) {
  const isCategorical = metric.key.startsWith("attr:");
  const raw = entries.map((e) => (e.error ? null : getRawValue(e, metric.key)));
  const winners = isCategorical || metric.unavailableReason ? null : findWinners(raw as (number | null)[], metric.higherBetter);
  const [rowRef, revealed] = useInViewOnce<HTMLTableRowElement>(0.4);

  if (metric.unavailableReason) {
    return (
      <tr className="group bg-surface transition-colors duration-200 ease-out hover:bg-surface-2/60">
        <MetricLabelCell metric={metric} />
        <td colSpan={entries.length} className="px-4 py-2.5 text-right" title={metric.unavailableReason}>
          <span className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-label text-muted">
            Not available — no data provider yet
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr ref={rowRef} className="group bg-surface transition-colors duration-200 ease-out hover:bg-surface-2/60">
      <MetricLabelCell metric={metric} />
      {raw.map((val, i) => {
        const isBest = winners?.bestIdx === i;
        const isWorst = winners?.worstIdx === i;
        const revealClass = !revealed ? "" : isBest ? "animate-winner-positive" : isWorst ? "animate-winner-negative" : "";
        const benchmark = !isCategorical ? entries[i]?.benchmarks?.[metric.key] : undefined;
        return (
          <td key={i} className={`px-4 py-2.5 text-right font-mono text-sm ${revealClass}`}>
            {val == null ? (
              <span className="text-muted">—</span>
            ) : (
              <>
                <span className={revealed ? "" : "text-foreground"}>
                  {revealed && isBest && <span className="mr-1 text-label">▲</span>}
                  {revealed && isWorst && <span className="mr-1 text-label">▼</span>}
                  {isCategorical ? String(val) : <CountUp value={val as number} format={metric.format} />}
                </span>
                {benchmark && <BenchmarkNote benchmark={benchmark} format={metric.format} />}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function MetricSection({ section, entries, open, onToggle }: { section: ClassSectionDef; entries: ClassCompareEntry[]; open: boolean; onToggle: () => void }) {
  const { hovered, setHovered } = useHoverSymbol();
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <button onClick={onToggle} className="flex w-full items-center justify-between bg-surface-2 px-4 py-3 text-left">
        <span className="text-sm font-semibold">{section.title}</span>
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-muted transition-transform duration-200 ease-out ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 3.5l3 3 3-3" />
        </svg>
      </button>
      <Collapsible open={open}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border bg-surface">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-44">Metric</th>
              {entries.map((e, i) => {
                const emphasis: SymbolEmphasis = hovered == null ? "none" : hovered === e.symbol ? "active" : "dimmed";
                return (
                  <th
                    key={e.symbol}
                    onMouseEnter={() => setHovered(e.symbol)}
                    onMouseLeave={() => setHovered(null)}
                    className={`px-4 py-2.5 text-right text-xs font-mono font-bold ${emphasisClassName(emphasis)}`}
                    style={{ color: COLORS[i % COLORS.length] }}
                  >
                    {e.symbol}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.metrics.map((metric) => (
              <MetricRow key={metric.label} metric={metric} entries={entries} />
            ))}
          </tbody>
        </table>
      </Collapsible>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main view                                                                   */
/* -------------------------------------------------------------------------- */

export function ClassCompareView({ assetClass, entries }: { assetClass: AssetClassId; entries: ClassCompareEntry[] }) {
  const composite = compositeScoreSection(entries);
  const sections = composite ? [...classSections(assetClass), composite] : classSections(assetClass);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(sections.map((s) => s.title)));
  const validEntries = entries.filter((e) => !e.error);
  const hasHoldings = validEntries.some((e) => e.topHoldings && e.topHoldings.length > 0);
  const hasRiskFlags = validEntries.some((e) => e.riskFlags && e.riskFlags.length > 0);

  // Canonical color for a symbol — its index among ALL requested symbols,
  // including any that failed to load. Sections below index `colors` by
  // position within `validEntries`, so passing this alignment (rather than
  // the raw COLORS palette) keeps every section's color for a symbol in sync
  // with its header card whenever another compared symbol errored out.
  const colorForSymbol = (symbol: string) => COLORS[entries.findIndex((e) => e.symbol === symbol) % COLORS.length];
  const validColors = validEntries.map((e) => colorForSymbol(e.symbol));

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      return next;
    });
  }

  const universeAsOf = entries.find((e) => !e.error && e.universeAsOf)?.universeAsOf ?? null;

  return (
    <div className="flex flex-col gap-6">
      {universeAsOf && (
        <div className="flex items-center justify-end">
          <DataProvenance source="yahoo" asOf={universeAsOf} ttlHours={12} />
        </div>
      )}

      {entries.some((e) => e.error) && (
        <div className="rounded-lg border border-yellow-500/40 light:border-yellow-700/30 bg-yellow-500/10 px-4 py-3 text-sm">
          <span className="font-semibold text-yellow-400 light:text-yellow-700">⚠ Some symbols couldn&apos;t load: </span>
          {entries.filter((e) => e.error).map((e) => (
            <span key={e.symbol} className="mr-2 font-mono text-yellow-400 light:text-yellow-700">{e.symbol} ({e.error})</span>
          ))}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
        {entries.map((e, i) => (
          <ClassStockCard key={e.symbol} entry={e} color={COLORS[i % COLORS.length]} colorBg={COLOR_BG[i % COLOR_BG.length]} assetClass={assetClass} />
        ))}
      </div>

      {/* Ranked AI verdict — auto-triggered, same prominence as equity's */}
      {validEntries.length >= 2 && (
        <ClassAiVerdict assetClass={assetClass} entries={validEntries} colors={validColors} />
      )}

      {/* Deterministic risk flags — the class's own registry warnings, evaluated per compared symbol */}
      {hasRiskFlags && <RiskFlagsSection entries={validEntries} colors={validColors} assetClass={assetClass} />}

      {/* Historical performance — the primary visualization; users compare performance over time first, regardless of asset class */}
      {validEntries.length >= 1 && (
        <ClassPerformanceChart symbols={validEntries.map((e) => e.symbol)} colors={validColors} />
      )}

      {validEntries.length >= 2 && <ClassCompareRadar entries={validEntries} colorForSymbol={colorForSymbol} />}

      {/* Secondary visualization — the class's own trade-off chart (cost/return, yield/leverage, etc.), demoted below the primary performance view */}
      {validEntries.length >= 2 && <SignatureChart assetClass={assetClass} entries={validEntries} />}

      {/* ETF-specific depth: is the fund tracking its benchmark, and are two funds actually different exposure? */}
      {assetClass === "etf" && validEntries.length >= 1 && (
        <BenchmarkSection entries={validEntries} colors={validColors} />
      )}
      {hasHoldings && validEntries.length >= 2 && (
        <HoldingsOverlapSection entries={validEntries} colors={validColors} />
      )}

      <div className="flex flex-col gap-3">
        {sections.map((section) => (
          <MetricSection
            key={section.title}
            section={section}
            entries={entries}
            open={openSections.has(section.title)}
            onToggle={() => toggleSection(section.title)}
          />
        ))}
      </div>
    </div>
  );
}
