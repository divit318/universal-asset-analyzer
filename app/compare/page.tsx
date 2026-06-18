"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CompareEntry } from "@/app/api/compare/route";
import { SymbolSearch } from "@/app/research/_components/symbol-search";
import { CompareRadar } from "./_components/radar-chart";
import { CompareChart } from "./_components/compare-chart";
import { formatCurrency, formatMarketCap, formatPercent } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MAX = 5;
const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f43f5e", "#a855f7"];
const COLOR_BG = [
  "bg-blue-500/10 border-blue-500/30",
  "bg-amber-400/10 border-amber-400/30",
  "bg-emerald-500/10 border-emerald-500/30",
  "bg-rose-500/10 border-rose-500/30",
  "bg-purple-500/10 border-purple-500/30",
];

/* -------------------------------------------------------------------------- */
/* Metric definitions                                                          */
/* -------------------------------------------------------------------------- */

interface MetricDef {
  label: string;
  sub?: string;
  getValue: (e: CompareEntry) => number | null;
  format: (v: number) => string;
  higherBetter: boolean | null;
}

interface SectionDef {
  title: string;
  metrics: MetricDef[];
}

function bucketPct(score: NonNullable<CompareEntry["score"]>, name: string): number {
  const b = score.buckets.find((bk) => bk.name === name);
  return b ? Math.round((b.points / b.max) * 100) : 50;
}

const pctSigned = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const pctAbs = (v: number) => `${v.toFixed(1)}%`;
const xRatio = (v: number) => `${v.toFixed(1)}x`;
const integer = (v: number) => Math.round(v).toString();
const score100 = (v: number) => `${Math.round(v)}`;

const SECTIONS: SectionDef[] = [
  {
    title: "Valuation",
    metrics: [
      { label: "Forward P/E", sub: "lower = cheaper", getValue: (e) => e.snapshot?.forwardPE ?? null, format: xRatio, higherBetter: false },
      { label: "Trailing P/E", getValue: (e) => e.snapshot?.trailingPE ?? null, format: xRatio, higherBetter: false },
      { label: "PEG Ratio", sub: "P/E ÷ growth", getValue: (e) => e.snapshot?.pegRatio ?? null, format: xRatio, higherBetter: false },
      { label: "Price / Book", getValue: (e) => e.snapshot?.priceToBook ?? null, format: xRatio, higherBetter: false },
      { label: "FCF Yield", sub: "higher = more value", getValue: (e) => e.fcfYieldPct ?? null, format: pctAbs, higherBetter: true },
      { label: "Analyst Target Upside", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Growth",
    metrics: [
      { label: "Revenue Growth YoY", getValue: (e) => e.snapshot?.revenueGrowth != null ? e.snapshot.revenueGrowth * 100 : null, format: pctSigned, higherBetter: true },
      { label: "Earnings Growth YoY", getValue: (e) => e.snapshot?.earningsGrowth != null ? e.snapshot.earningsGrowth * 100 : null, format: pctSigned, higherBetter: true },
      { label: "Revenue CAGR 3Y", getValue: (e) => e.statements?.revenueCagr != null ? e.statements.revenueCagr * 100 : null, format: pctSigned, higherBetter: true },
      { label: "FCF CAGR 3Y", getValue: (e) => e.statements?.fcfCagr != null ? e.statements.fcfCagr * 100 : null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Quality",
    metrics: [
      { label: "Return on Equity", getValue: (e) => e.snapshot?.returnOnEquity != null ? e.snapshot.returnOnEquity * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Return on Assets", getValue: (e) => e.snapshot?.returnOnAssets != null ? e.snapshot.returnOnAssets * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Gross Margin", getValue: (e) => e.snapshot?.grossMargins != null ? e.snapshot.grossMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Operating Margin", getValue: (e) => e.snapshot?.operatingMargins != null ? e.snapshot.operatingMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "Net Profit Margin", getValue: (e) => e.snapshot?.profitMargins != null ? e.snapshot.profitMargins * 100 : null, format: pctAbs, higherBetter: true },
      { label: "EBITDA Margin", getValue: (e) => e.snapshot?.ebitdaMargins != null ? e.snapshot.ebitdaMargins * 100 : null, format: pctAbs, higherBetter: true },
    ],
  },
  {
    title: "Financial Health",
    metrics: [
      { label: "Debt / Equity", sub: "lower = safer", getValue: (e) => e.snapshot?.debtToEquity ?? null, format: xRatio, higherBetter: false },
      { label: "Net Debt / EBITDA", getValue: (e) => e.netDebtToEbitda ?? null, format: xRatio, higherBetter: false },
      { label: "Current Ratio", sub: "higher = more liquid", getValue: (e) => e.snapshot?.currentRatio ?? null, format: xRatio, higherBetter: true },
      { label: "Quick Ratio", getValue: (e) => e.snapshot?.quickRatio ?? null, format: xRatio, higherBetter: true },
      { label: "Dividend Yield", getValue: (e) => e.snapshot?.dividendYield != null ? e.snapshot.dividendYield * 100 : null, format: pctAbs, higherBetter: true },
    ],
  },
  {
    title: "Momentum",
    metrics: [
      { label: "1-Year Return", getValue: (e) => e.oneYearReturn ?? null, format: pctSigned, higherBetter: true },
      { label: "3-Month Return", getValue: (e) => e.momentum?.return3m ?? null, format: pctSigned, higherBetter: true },
      { label: "vs SMA 200", sub: "% above/below", getValue: (e) => e.momentum?.vsSma200 ?? null, format: pctSigned, higherBetter: true },
      { label: "vs SMA 50", getValue: (e) => e.momentum?.vsSma50 ?? null, format: pctSigned, higherBetter: true },
      { label: "From 52W High", sub: "0 = at the high", getValue: (e) => e.momentum?.pctFrom52WkHigh ?? null, format: pctSigned, higherBetter: true },
    ],
  },
  {
    title: "Analyst Consensus",
    metrics: [
      { label: "Target Upside %", getValue: (e) => e.analyst?.upsidePercent ?? null, format: pctSigned, higherBetter: true },
      { label: "# Analysts", getValue: (e) => e.analyst?.numberOfOpinions ?? null, format: integer, higherBetter: null },
      { label: "Strong Buy + Buy", getValue: (e) => e.analyst ? e.analyst.strongBuy + e.analyst.buy : null, format: integer, higherBetter: true },
      { label: "Hold", getValue: (e) => e.analyst?.hold ?? null, format: integer, higherBetter: null },
      { label: "Sell + Strong Sell", getValue: (e) => e.analyst ? e.analyst.sell + e.analyst.strongSell : null, format: integer, higherBetter: false },
      {
        label: "Avg EPS Surprise",
        getValue: (e) => {
          const s = e.analyst?.epsSurprises;
          if (!s || s.length === 0) return null;
          return s.reduce((a, b) => a + b, 0) / s.length;
        },
        format: pctSigned,
        higherBetter: true,
      },
      {
        label: "EPS Revisions (30d)",
        sub: "up − down",
        getValue: (e) => {
          const up = e.analyst?.epsRevisionsUp30d;
          const down = e.analyst?.epsRevisionsDown30d;
          if (up == null && down == null) return null;
          return (up ?? 0) - (down ?? 0);
        },
        format: (v) => (v >= 0 ? `+${Math.round(v)}` : String(Math.round(v))),
        higherBetter: true,
      },
    ],
  },
  {
    title: "Composite Scores",
    metrics: [
      { label: "Overall Score", getValue: (e) => e.score?.composite ?? null, format: score100, higherBetter: true },
      { label: "Fundamental Score", getValue: (e) => e.score?.total ?? null, format: score100, higherBetter: true },
      { label: "Valuation Score", getValue: (e) => (e.score ? bucketPct(e.score, "Valuation") : null), format: score100, higherBetter: true },
      { label: "Growth Score", getValue: (e) => (e.score ? bucketPct(e.score, "Growth") : null), format: score100, higherBetter: true },
      { label: "Quality Score", getValue: (e) => (e.score ? bucketPct(e.score, "Quality") : null), format: score100, higherBetter: true },
      { label: "Financial Health Score", getValue: (e) => (e.score ? bucketPct(e.score, "Financial Health") : null), format: score100, higherBetter: true },
      { label: "Momentum Signal", getValue: (e) => e.score?.signals.momentum ?? null, format: score100, higherBetter: true },
      { label: "Analyst Signal", getValue: (e) => e.score?.signals.analysts ?? null, format: score100, higherBetter: true },
      { label: "Confidence", getValue: (e) => e.score?.confidence ?? null, format: score100, higherBetter: true },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function recLabel(key: string | null | undefined): string {
  if (!key) return "—";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function recColor(key: string | null | undefined): string {
  if (!key) return "text-muted bg-surface-2";
  const k = key.toLowerCase();
  if (k === "strong_buy") return "text-green-400 bg-green-400/15";
  if (k === "buy") return "text-green-400 bg-green-400/10";
  if (k === "hold") return "text-amber-400 bg-amber-400/10";
  if (k === "sell") return "text-rose-400 bg-rose-400/10";
  if (k === "strong_sell") return "text-rose-400 bg-rose-400/15";
  return "text-muted bg-surface-2";
}

interface WinnerInfo {
  bestIdx: number;
  worstIdx: number;
}

function findWinners(values: (number | null)[], higherBetter: boolean | null): WinnerInfo | null {
  if (higherBetter == null) return null;
  const valid = values.map((v, i) => ({ v: v!, i })).filter((x) => x.v != null);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
  return { bestIdx: sorted[0].i, worstIdx: sorted[sorted.length - 1].i };
}

/* -------------------------------------------------------------------------- */
/* Main page                                                                   */
/* -------------------------------------------------------------------------- */

export default function ComparePage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["Valuation", "Growth", "Quality", "Financial Health"]),
  );

  // Read initial symbols from URL on mount.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const syms = params
      .get("symbols")
      ?.split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean) ?? [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (syms.length > 0) setSymbols(syms);
  }, []);

  const fetchCompare = useCallback(async (syms: string[]) => {
    if (syms.length === 0) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/compare?symbols=${syms.join(",")}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Compare failed");
      setEntries((json.entries as CompareEntry[]).sort(
        (a, b) => syms.indexOf(a.symbol) - syms.indexOf(b.symbol),
      ));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  // Sync URL and fetch whenever symbols change.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (symbols.length > 0) url.searchParams.set("symbols", symbols.join(","));
    else url.searchParams.delete("symbols");
    window.history.replaceState({}, "", url.toString());
    // fetchCompare only sets state after an await, so this is safe to call here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCompare(symbols);
  }, [symbols, fetchCompare]);

  function addSymbol(sym: string) {
    const upper = sym.trim().toUpperCase();
    if (!upper || symbols.includes(upper) || symbols.length >= MAX) return;
    setSymbols((prev) => [...prev, upper]);
    setInput("");
  }

  function removeSymbol(sym: string) {
    setSymbols((prev) => prev.filter((s) => s !== sym));
    setEntries((prev) => prev.filter((e) => e.symbol !== sym));
  }

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function copyUrl() {
    void navigator.clipboard.writeText(window.location.href);
  }

  const validEntries = entries.filter((e) => !e.error);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Comparer</h1>
          <p className="text-sm text-muted">
            Side-by-side fundamentals for up to {MAX} stocks. Green = best on that metric, red = worst.
          </p>
        </div>
        {symbols.length > 0 && (
          <button
            onClick={copyUrl}
            className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-surface-2"
          >
            Copy link ↗
          </button>
        )}
      </div>

      {/* Symbol input row */}
      <div className="flex gap-2">
        <SymbolSearch
          value={input}
          onChange={setInput}
          onSelect={addSymbol}
          loading={loading}
        />
        <button
          onClick={() => addSymbol(input)}
          disabled={!input.trim() || symbols.length >= MAX}
          className="shrink-0 rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Add
        </button>
      </div>

      {/* Active symbol chips */}
      {symbols.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {symbols.map((sym, i) => (
            <span
              key={sym}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-mono font-semibold ${COLOR_BG[i % COLOR_BG.length]}`}
              style={{ color: COLORS[i % COLORS.length] }}
            >
              {sym}
              <button
                onClick={() => removeSymbol(sym)}
                className="ml-0.5 opacity-60 hover:opacity-100"
                aria-label={`Remove ${sym}`}
              >
                ✕
              </button>
            </span>
          ))}
          {symbols.length < MAX && (
            <span className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted">
              + add up to {MAX - symbols.length} more
            </span>
          )}
        </div>
      )}

      {/* Error */}
      {fetchError && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {fetchError}
        </div>
      )}

      {/* Loading skeleton or empty state */}
      {loading && (
        <div className="py-8 text-center text-sm text-muted">Loading comparison data…</div>
      )}

      {!loading && symbols.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-12 text-center">
          <p className="text-lg font-medium">Add stocks to compare</p>
          <p className="mt-1 text-sm text-muted">Try AAPL, MSFT, GOOGL to start.</p>
          <div className="mt-4 flex justify-center gap-2 flex-wrap">
            {[["AAPL", "MSFT", "GOOGL"], ["NVDA", "AMD", "INTC"], ["JPM", "BAC", "GS"]].map((group) => (
              <button
                key={group.join()}
                onClick={() => group.forEach((s) => addSymbol(s))}
                className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
              >
                {group.join(" · ")}
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <>
          {/* Stock header cards */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
          >
            {entries.map((e, i) => (
              <StockCard key={e.symbol} entry={e} color={COLORS[i % COLORS.length]} colorBg={COLOR_BG[i % COLOR_BG.length]} />
            ))}
          </div>

          {/* Performance chart */}
          {validEntries.length >= 2 && (
            <CompareChart
              symbols={validEntries.map((e) => e.symbol)}
              colors={validEntries.map((_, i) => COLORS[i % COLORS.length])}
              marketCaps={Object.fromEntries(validEntries.map((e) => [e.symbol, e.quote?.marketCap]))}
              entries={validEntries}
            />
          )}

          {/* Radar chart */}
          {validEntries.length >= 2 && <CompareRadar entries={validEntries} />}

          {/* Metric table */}
          <div className="flex flex-col gap-3">
            {SECTIONS.map((section) => (
              <MetricSection
                key={section.title}
                section={section}
                entries={entries}
                open={openSections.has(section.title)}
                onToggle={() => toggleSection(section.title)}
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Stock header card                                                           */
/* -------------------------------------------------------------------------- */

function StockCard({ entry, color, colorBg }: { entry: CompareEntry; color: string; colorBg: string }) {
  if (entry.error) {
    return (
      <div className="rounded-xl border border-negative/30 bg-negative/5 p-4">
        <span className="font-mono font-semibold" style={{ color }}>{entry.symbol}</span>
        <p className="mt-1 text-xs text-negative">{entry.error}</p>
      </div>
    );
  }

  const { quote, score, analyst } = entry;
  const pos = (quote?.changePercent ?? 0) >= 0;

  return (
    <div className={`rounded-xl border p-4 ${colorBg}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/research?symbol=${entry.symbol}`}
            className="font-mono text-lg font-bold hover:underline"
            style={{ color }}
          >
            {entry.symbol}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">{entry.name}</p>
        </div>
        {analyst?.recommendationKey && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${recColor(analyst.recommendationKey)}`}>
            {recLabel(analyst.recommendationKey)}
          </span>
        )}
      </div>

      {quote && (
        <div className="mt-3">
          <div className="font-mono text-xl font-semibold">
            {formatCurrency(quote.price, quote.currency)}
          </div>
          <div className={`text-xs font-mono ${pos ? "text-green-400" : "text-rose-400"}`}>
            {formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
          </div>
          <div className="mt-1 text-xs text-muted">
            {formatMarketCap(quote.marketCap)}
          </div>
        </div>
      )}

      {score && (
        <div className="mt-3 space-y-1.5">
          <ScoreBar label="Overall" value={score.composite} color={color} />
          <ScoreBar label="Quality" value={entry.score ? bucketPct(entry.score, "Quality") : null} color={color} />
          <ScoreBar label="Growth" value={entry.score ? bucketPct(entry.score, "Growth") : null} color={color} />
          <ScoreBar label="Health" value={entry.score ? bucketPct(entry.score, "Financial Health") : null} color={color} />
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-right text-xs text-muted">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: color, opacity: 0.8 }}
        />
      </div>
      <span className="w-8 text-right font-mono text-xs font-semibold" style={{ color }}>
        {Math.round(value)}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Metric table section                                                        */
/* -------------------------------------------------------------------------- */

function MetricSection({
  section,
  entries,
  open,
  onToggle,
}: {
  section: SectionDef;
  entries: CompareEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {/* Section header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-surface-2 px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold">{section.title}</span>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-t border-border bg-surface">
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-44">Metric</th>
              {entries.map((e, i) => (
                <th
                  key={e.symbol}
                  className="px-4 py-2.5 text-right text-xs font-mono font-bold"
                  style={{ color: COLORS[i % COLORS.length] }}
                >
                  {e.symbol}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {section.metrics.map((metric) => (
              <MetricRow key={metric.label} metric={metric} entries={entries} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MetricRow({ metric, entries }: { metric: MetricDef; entries: CompareEntry[] }) {
  const values = entries.map((e) => (e.error ? null : metric.getValue(e)));
  const winners = findWinners(values, metric.higherBetter);

  return (
    <tr className="bg-surface">
      <td className="px-4 py-2.5">
        <span className="text-xs text-foreground">{metric.label}</span>
        {metric.sub && <p className="text-[10px] text-muted">{metric.sub}</p>}
      </td>
      {values.map((val, i) => {
        const isBest = winners?.bestIdx === i;
        const isWorst = winners?.worstIdx === i;


        let cellBg = "";
        if (isBest) cellBg = "bg-green-500/8";
        else if (isWorst) cellBg = "bg-rose-500/8";

        let textColor = "";
        if (val != null && (metric.label.includes("Return") || metric.label.includes("Growth") || metric.label.includes("Upside") || metric.label.includes("vs SMA") || metric.label.includes("From 52"))) {
          textColor = val >= 0 ? "text-green-400" : "text-rose-400";
        }

        return (
          <td key={i} className={`px-4 py-2.5 text-right font-mono text-sm ${cellBg}`}>
            {val == null ? (
              <span className="text-muted">—</span>
            ) : (
              <span className={textColor}>
                {isBest && <span className="mr-1 text-[10px]">▲</span>}
                {isWorst && <span className="mr-1 text-[10px]">▼</span>}
                {metric.format(val)}
                {section_is_scores(metric) && (
                  <span className="ml-1 text-[10px] text-muted">/100</span>
                )}
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function section_is_scores(metric: MetricDef): boolean {
  return metric.format === score100;
}
