"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { CompareEntry } from "@/app/api/compare/route";
import { downloadBlob } from "@/lib/download";
import { SymbolSearch } from "@/app/_components/symbol-search";
import { CompareRadar } from "./_components/radar-chart";
import { CompareChart } from "./_components/compare-chart";
import { formatCurrency, formatMarketCap, formatPercent } from "@/lib/format";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const MAX = 5;
const COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#f43f5e", "#a855f7"];
const COLOR_BG = [
  "bg-blue-500/10 border-blue-500/30",
  "bg-warning/10 border-warning/30",
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
  if (k === "strong_buy") return "text-positive bg-positive/15";
  if (k === "buy") return "text-positive bg-positive/10";
  if (k === "hold") return "text-warning bg-warning/10";
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

interface AiComparison {
  winner?: string;
  summary?: string;
  rationale?: string;
  error?: string;
  executiveSummary?: string;
  conditionsForChange?: string;
  confidenceScore?: number;
  capitalAllocation?: string;
  competitivePositioning?: string;
  riskComparison?: string;
}

interface CategoryWinner {
  category: string;
  symbol: string;
  color: string;
}

/** Aggregate metric-level winners within a section into one category winner — no AI, purely derived from already-rendered data. */
function computeCategoryWinners(sections: SectionDef[], entries: CompareEntry[], colors: string[]): CategoryWinner[] {
  const out: CategoryWinner[] = [];
  for (const section of sections) {
    const winCounts = entries.map(() => 0);
    for (const metric of section.metrics) {
      if (metric.higherBetter == null) continue;
      const values = entries.map((e) => (e.error ? null : metric.getValue(e)));
      const w = findWinners(values, metric.higherBetter);
      if (w) winCounts[w.bestIdx]++;
    }
    const maxWins = Math.max(...winCounts);
    if (maxWins === 0) continue;
    const idx = winCounts.indexOf(maxWins);
    out.push({ category: section.title, symbol: entries[idx].symbol, color: colors[idx % colors.length] });
  }
  return out;
}

export default function ComparePage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [market, setMarket] = useState<"US" | "IN">("US");
  const [entries, setEntries] = useState<CompareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["Portfolio Fit", "Valuation", "Growth", "Quality", "Financial Health", "Momentum", "Analyst Consensus", "Composite Scores"]),
  );
  const [aiResult, setAiResult] = useState<AiComparison | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiAutoTriggered = useRef<string>("");

  // Always-current snapshot for save-on-unmount
  const _s = useRef({ symbols, market, entries, aiResult });
  _s.current = { symbols, market, entries, aiResult };

  // Dynamic page title
  useEffect(() => {
    if (symbols.length > 0) {
      document.title = `${symbols.join(" vs ")} · Compare · UAA`;
    } else {
      document.title = "Compare · UAA";
    }
    return () => { document.title = "Universal Asset Analyzer"; };
  }, [symbols]);

  // URL deep-link or session restore on mount.
  // URL params (?symbols=A,B,C or ?a=TICKER) take priority over session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const singleTicker = params.get("a")?.trim().toUpperCase();
    const urlSyms = singleTicker
      ? [singleTicker]
      : (params.get("symbols")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) ?? []);

    if (urlSyms.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSymbols(urlSyms);
    } else {
      // No URL params — restore from session (cleared on tab close)
      try {
        const raw = sessionStorage.getItem("uaa_compare_state");
        if (raw) {
          const st = JSON.parse(raw) as { symbols?: string[]; market?: "US" | "IN"; entries?: CompareEntry[]; aiResult?: AiComparison };
          if (st.symbols?.length) setSymbols(st.symbols);
          if (st.market) setMarket(st.market);
          if (st.entries?.length) setEntries(st.entries);
          if (st.aiResult) setAiResult(st.aiResult);
        }
      } catch { /* ignore corrupt storage */ }
    }
  }, []);

  // Save to session immediately when comparison data loads (survives navigation and reload)
  useEffect(() => {
    if (!entries.length) return;
    try { sessionStorage.setItem("uaa_compare_state", JSON.stringify(_s.current)); } catch { /* ignore */ }
  }, [entries, aiResult]);

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

  // Reset auto-trigger when the symbol list changes
  useEffect(() => {
    aiAutoTriggered.current = "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAiResult(null);
  }, [symbols]);

  // Auto-trigger AI head-to-head when at least 2 valid entries load for the first time
  useEffect(() => {
    const valid = entries.filter((e) => !e.error);
    if (valid.length < 2 || aiLoading || loading) return;
    const key = [valid[0].symbol, valid[1].symbol].sort().join("-");
    if (aiAutoTriggered.current === key) return;
    aiAutoTriggered.current = key;
    void fetchAiVerdict(valid[0].symbol, valid[1].symbol);
  }, [entries, aiLoading, loading]);

  async function fetchAiVerdict(symA: string, symB: string) {
    setAiLoading(true);
    setAiResult(null);
    try {
      const res  = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbolA: symA, symbolB: symB }),
      });
      const json = await res.json() as AiComparison & {
        verdict?: string; analysis?: string; winnerRationale?: string;
        sections?: { verdict?: string; capitalAllocation?: string; competitivePositioning?: string; riskComparison?: string };
      };
      // API returns various shapes — normalise
      setAiResult({
        winner:   json.winner   ?? undefined,
        summary:  json.summary  ?? json.sections?.verdict ?? json.verdict  ?? undefined,
        rationale: json.rationale ?? json.winnerRationale ?? json.analysis ?? undefined,
        error:    !res.ok ? (json.error ?? "AI analysis failed") : undefined,
        executiveSummary: json.executiveSummary ?? undefined,
        conditionsForChange: json.conditionsForChange ?? undefined,
        confidenceScore: json.confidenceScore ?? undefined,
        capitalAllocation: json.capitalAllocation ?? json.sections?.capitalAllocation ?? undefined,
        competitivePositioning: json.competitivePositioning ?? json.sections?.competitivePositioning ?? undefined,
        riskComparison: json.riskComparison ?? json.sections?.riskComparison ?? undefined,
      });
    } catch (err) {
      setAiResult({ error: err instanceof Error ? err.message : "AI analysis failed" });
    } finally {
      setAiLoading(false);
    }
  }

  function addSymbol(sym: string) {
    const upper = sym.trim().toUpperCase();
    if (!upper || symbols.length >= MAX) return;
    const withSuffix = market === "IN" && !upper.endsWith(".NS") && !upper.endsWith(".BO")
      ? `${upper}.NS` : upper;
    if (symbols.includes(withSuffix)) return;
    setSymbols((prev) => [...prev, withSuffix]);
    setInput("");
    setAiResult(null);
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

  // IOS — portfolio fit per entry
  const ios = useIOSSafe();
  const fitScores = useMemo<PortfolioFitAnalysis[]>(() => {
    if (!ios || !ios.profileReady) return [];
    return validEntries.map((e) =>
      ios.getPortfolioFit({
        symbol: e.symbol,
        sector: e.snapshot?.sector ?? null,
        marketCap: e.quote?.marketCap ?? null,
        scoreResult: e.score ?? null,
        dividendYield: e.snapshot?.dividendYield != null ? e.snapshot.dividendYield * 100 : null,
      }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profileReady, validEntries.length]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      {/* Page header */}
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Stock Comparison</h1>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
              Up to {MAX} stocks
            </span>
          </div>
          <p className="text-sm text-muted">
            Side-by-side valuation, growth, quality, momentum, and analyst consensus. Green = best on metric, red = worst.
          </p>
        </div>
        {symbols.length > 0 && (
          <div className="flex items-center gap-2">
            {validEntries.length > 0 && (
              <button
                onClick={() => {
                  setExportErr(null);
                  void downloadBlob("/api/export/compare", `compare-${validEntries.map((e) => e.symbol).join("-")}-${new Date().toISOString().slice(0, 10)}.xlsx`, "POST", { entries: validEntries })
                    .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
                }}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-2"
              >
                ↓ Export Excel
              </button>
            )}
            {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
            <button
              onClick={copyUrl}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-surface-2"
            >
              Copy link ↗
            </button>
          </div>
        )}
      </div>

      {/* Symbol input row */}
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          {/* US / India market toggle */}
          <div className="flex overflow-hidden rounded-lg border border-border text-xs font-medium">
            <button onClick={() => setMarket("US")}
              className={`px-3 py-2 transition-colors ${market === "US" ? "bg-accent-strong text-background" : "hover:bg-surface-2"}`}>
              🇺🇸 US
            </button>
            <button onClick={() => setMarket("IN")}
              className={`px-3 py-2 transition-colors ${market === "IN" ? "bg-accent-strong text-background" : "hover:bg-surface-2"}`}>
              🇮🇳 India
            </button>
          </div>
          <SymbolSearch value={input} onChange={setInput} onSelect={addSymbol} loading={loading} />
          <button onClick={() => addSymbol(input)} disabled={!input.trim() || symbols.length >= MAX}
            className="shrink-0 rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
            Add
          </button>
        </div>
        {market === "IN" && (
          <p className="text-xs text-muted">India mode — symbols will get <code className="font-mono">.NS</code> (NSE) suffix automatically. Use .BO for BSE.</p>
        )}
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
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-12 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h4v12H3zM11 3h4v12h-4z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold">Add 2–5 tickers to compare side by side</p>
              <p className="mt-1 text-xs text-muted">Fundamentals, momentum, analyst data, and AI verdict across all stocks</p>
            </div>
            <div className="flex flex-col items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Quick start</p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  { label: "Big Tech", syms: ["AAPL", "MSFT", "GOOGL", "META"] },
                  { label: "Semis", syms: ["NVDA", "AMD", "INTC", "TSM"] },
                  { label: "Banks", syms: ["JPM", "BAC", "GS"] },
                  { label: "Defensives", syms: ["JNJ", "PG", "KO", "WMT"] },
                ].map(({ label, syms }) => (
                  <button
                    key={label}
                    onClick={() => syms.forEach((s) => addSymbol(s))}
                    className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm transition-colors hover:border-accent/30 hover:text-accent"
                  >
                    {label} <span className="ml-1 font-mono text-xs text-muted">{syms.join(" · ")}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { title: "7 metric categories", desc: "Valuation, growth, quality, financial health, momentum, analyst consensus, and composite scores" },
              { title: "Visual overlays", desc: "Performance chart and radar overlay to spot strengths and weaknesses at a glance" },
              { title: "AI verdict", desc: "Local AI compares any two stocks head-to-head — winner, rationale, and key differentiators" },
            ].map(({ title, desc }) => (
              <div key={title} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && entries.length > 0 && (
        <>
          {/* Incomplete data banner */}
          {entries.some((e) => e.error) && (
            <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm">
              <span className="font-semibold text-yellow-600 dark:text-yellow-400">⚠ Some symbols couldn&apos;t load: </span>
              {entries.filter((e) => e.error).map((e) => (
                <span key={e.symbol} className="mr-2 text-yellow-600 dark:text-yellow-400 font-mono">
                  {e.symbol} ({e.error})
                </span>
              ))}
            </div>
          )}

          {/* Stock header cards */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}
          >
            {entries.map((e, i) => (
              <StockCard key={e.symbol} entry={e} color={COLORS[i % COLORS.length]} colorBg={COLOR_BG[i % COLOR_BG.length]} />
            ))}
          </div>

          {/* Executive Summary — auto-triggered on data load, the decision at a glance */}
          {validEntries.length >= 2 && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">Executive Summary</h2>
                    <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent">Local AI</span>
                  </div>
                  <p className="text-xs text-muted">
                    {validEntries[0].symbol} vs {validEntries[1].symbol} — which is the better investment, and why
                  </p>
                </div>
                <button
                  onClick={() => void fetchAiVerdict(validEntries[0].symbol, validEntries[1].symbol)}
                  disabled={aiLoading}
                  className="rounded-lg bg-accent-strong px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {aiLoading ? "Analyzing…" : aiResult ? "Re-analyze" : "Run analysis"}
                </button>
              </div>
              {aiLoading && (
                <div className="mt-4 flex flex-col gap-2">
                  {[80, 60, 90, 50].map((w) => (
                    <div key={w} className="h-2.5 animate-pulse rounded-full bg-surface-2" style={{ width: `${w}%` }} />
                  ))}
                  <p className="mt-1 text-xs text-muted">Running Ollama analysis — typically ~30s on a local model…</p>
                </div>
              )}
              {!aiLoading && aiResult && (
                <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
                  {aiResult.error ? (
                    <p className="text-sm text-negative">{aiResult.error}</p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        {aiResult.winner && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted">Winner:</span>
                            <span className="font-mono text-sm font-semibold text-accent">{aiResult.winner}</span>
                          </div>
                        )}
                        {aiResult.confidenceScore != null && (
                          <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">
                            {aiResult.confidenceScore}% confidence
                          </span>
                        )}
                      </div>
                      {(aiResult.executiveSummary ?? aiResult.summary) && (
                        <p className="text-sm leading-6 text-foreground">{aiResult.executiveSummary ?? aiResult.summary}</p>
                      )}
                      {aiResult.rationale && <p className="text-sm leading-6 text-muted">{aiResult.rationale}</p>}
                      {aiResult.conditionsForChange && (
                        <p className="text-xs leading-5 text-muted">
                          <span className="font-semibold text-foreground">Would change if: </span>
                          {aiResult.conditionsForChange}
                        </p>
                      )}
                      {(aiResult.capitalAllocation || aiResult.competitivePositioning) && (
                        <div className="grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
                          {aiResult.capitalAllocation && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Capital Allocation</p>
                              <p className="mt-1 text-xs leading-5 text-muted">{aiResult.capitalAllocation}</p>
                            </div>
                          )}
                          {aiResult.competitivePositioning && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Competitive Positioning</p>
                              <p className="mt-1 text-xs leading-5 text-muted">{aiResult.competitivePositioning}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              {!aiLoading && !aiResult && (
                <p className="mt-3 text-xs text-muted">Analyzing {validEntries[0].symbol} vs {validEntries[1].symbol} — generating win conditions, risks, and a recommended lean…</p>
              )}
            </div>
          )}

          {/* Winner by category — deterministic, derived from the metric table below (no AI) */}
          {validEntries.length >= 2 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60 shrink-0">Winner by category</span>
              {computeCategoryWinners(
                SECTIONS.filter((s) => ["Valuation", "Growth", "Quality", "Financial Health", "Momentum"].includes(s.title)),
                validEntries,
                COLORS,
              ).map((w) => (
                <span key={w.category} className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-[11px]">
                  <span className="text-muted">{w.category}: </span>
                  <span className="font-mono font-semibold" style={{ color: w.color }}>{w.symbol}</span>
                </span>
              ))}
            </div>
          )}

          {/* Risk comparison */}
          {validEntries.some((e) => e.risks?.length) && (
            <RiskComparisonSection entries={validEntries} colors={COLORS} />
          )}

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

          {/* Portfolio Fit — IOS personalized comparison */}
          {ios?.profileReady && fitScores.length > 0 && !fitScores[0].isGeneric && (
            <PortfolioFitSection
              entries={validEntries}
              fits={fitScores}
              open={openSections.has("Portfolio Fit")}
              onToggle={() => toggleSection("Portfolio Fit")}
              missingSectors={ios.profile.missingSectors}
              overweightSectors={ios.profile.overweightSectors}
              objective={ios.profile.objective}
            />
          )}

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
    </div>
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

  const { quote, score, analyst, opportunity } = entry;
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
          <Link
            href={`/intelligence?view=timeline&scope=symbol&id=${encodeURIComponent(entry.symbol)}`}
            className="mt-1 inline-block text-[10px] text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            View timeline →
          </Link>
        </div>
        {analyst?.recommendationKey && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${recColor(analyst.recommendationKey)}`}>
            {recLabel(analyst.recommendationKey)}
          </span>
        )}
      </div>

      {opportunity && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
            {opportunity.opportunityScore}/100 · {opportunity.conviction}
          </span>
          <span className="text-[10px] text-muted">{opportunity.categoryLabel}</span>
        </div>
      )}

      {quote && (
        <div className="mt-3">
          <div className="font-mono text-xl font-semibold">
            {formatCurrency(quote.price, quote.currency)}
          </div>
          <div className={`text-xs font-mono ${pos ? "text-positive" : "text-rose-400"}`}>
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
          textColor = val >= 0 ? "text-positive" : "text-rose-400";
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

/* -------------------------------------------------------------------------- */
/* Portfolio Fit section — IOS personalized comparison                        */
/* -------------------------------------------------------------------------- */

function PortfolioFitSection({
  entries,
  fits,
  open,
  onToggle,
  missingSectors = [],
  overweightSectors = [],
  objective = "",
}: {
  entries: CompareEntry[];
  fits: PortfolioFitAnalysis[];
  open: boolean;
  onToggle: () => void;
  missingSectors?: string[];
  overweightSectors?: string[];
  objective?: string;
}) {
  const bestIdx = fits.reduce(
    (best, f, i) => (f.fitScore > (fits[best]?.fitScore ?? -1) ? i : best),
    0,
  );

  const bestFit  = fits[bestIdx];
  const bestEntry = entries[bestIdx];

  // Synthesize a personalized narrative for the winner.
  function buildWinnerNarrative(): string | null {
    if (!bestFit || !bestEntry) return null;
    const parts: string[] = [`${bestEntry.symbol} is your best portfolio fit (${bestFit.fitScore}/100).`];
    if (bestFit.reasons[0]) parts.push(bestFit.reasons[0]);
    const filledSector = missingSectors.find((s) => bestFit.dimensions.sector.score > 65 && bestFit.dimensions.sector.message?.includes(s));
    if (filledSector) parts.push(`Fills your missing ${filledSector} gap.`);
    if (overweightSectors.some((s) => bestFit.dimensions.sector.message?.includes(s))) {
      parts.push(`Note: your portfolio already has concentration in ${overweightSectors[0]}.`);
    }
    if (bestFit.suggestedAllocationPct && bestFit.suggestedAllocationPct > 0) {
      parts.push(`Suggested allocation: ${bestFit.suggestedAllocationPct.toFixed(1)}%.`);
    }
    return parts.join(" ");
  }

  const winnerNarrative = buildWinnerNarrative();

  return (
    <div className="overflow-hidden rounded-xl border border-accent/20 bg-accent/3">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between bg-accent/5 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Portfolio Fit</span>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-accent">
            IOS
          </span>
          <span className="text-[11px] text-muted">
            {objective ? `${objective.replace(/_/g, " ")} objective · ` : ""}personalised to your portfolio
          </span>
        </div>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>

      {/* Winner narrative — always visible when section is rendered */}
      {winnerNarrative && (
        <div className="border-t border-border/50 bg-accent/5 px-4 py-2.5">
          <p className="text-[11px] text-foreground/80 leading-4">{winnerNarrative}</p>
        </div>
      )}

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
                  {i === bestIdx && (
                    <span className="ml-1 text-[9px] text-accent">★ Best fit</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {/* Fit score row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Portfolio Fit Score</span>
                <p className="text-[10px] text-muted">0-100 · higher = better fit</p>
              </td>
              {fits.map((f, i) => (
                <td key={i} className={`px-4 py-2.5 text-right ${i === bestIdx ? "bg-green-500/5" : ""}`}>
                  <PortfolioFitBadge score={f.fitScore} tier={f.fitTier} size="sm" />
                </td>
              ))}
            </tr>
            {/* Top reason row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Key Reason</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right text-[10px] text-muted max-w-[160px]">
                  {f.reasons[0] ?? "—"}
                </td>
              ))}
            </tr>
            {/* Suggested allocation row */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Suggested Allocation</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  {f.suggestedAllocationPct > 0 ? `${f.suggestedAllocationPct.toFixed(1)}%` : "—"}
                </td>
              ))}
            </tr>
            {/* Sector dimension */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Sector Fit</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  <span className={f.dimensions.sector.score >= 65 ? "text-positive" : f.dimensions.sector.score >= 45 ? "text-warning" : "text-negative"}>
                    {f.dimensions.sector.score}
                  </span>
                  <span className="ml-1 text-[10px] text-muted">/100</span>
                </td>
              ))}
            </tr>
            {/* Objective alignment */}
            <tr className="bg-surface">
              <td className="px-4 py-2.5">
                <span className="text-xs text-foreground">Objective Alignment</span>
              </td>
              {fits.map((f, i) => (
                <td key={i} className="px-4 py-2.5 text-right font-mono text-xs">
                  <span className={f.dimensions.objective.score >= 65 ? "text-positive" : f.dimensions.objective.score >= 45 ? "text-warning" : "text-negative"}>
                    {f.dimensions.objective.score}
                  </span>
                  <span className="ml-1 text-[10px] text-muted">/100</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Risk comparison — reuses assessRisks() output already computed server-side  */
/* -------------------------------------------------------------------------- */

const RISK_LEVEL_STYLE: Record<string, string> = {
  low: "text-positive",
  medium: "text-warning",
  high: "text-negative",
};

function RiskComparisonSection({ entries, colors }: { entries: CompareEntry[]; colors: string[] }) {
  const categories = [...new Set(entries.flatMap((e) => (e.risks ?? []).map((r) => r.category)))];

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold">Risk Comparison</span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-t border-border bg-surface">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted w-32">Category</th>
            {entries.map((e, i) => (
              <th key={e.symbol} className="px-4 py-2.5 text-right text-xs font-mono font-bold" style={{ color: colors[i % colors.length] }}>
                {e.symbol}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {categories.map((cat) => (
            <tr key={cat} className="bg-surface">
              <td className="px-4 py-2.5 text-xs text-foreground">{cat}</td>
              {entries.map((e) => {
                const r = (e.risks ?? []).find((x) => x.category === cat);
                return (
                  <td key={e.symbol} className="px-4 py-2.5 text-right">
                    {r ? (
                      <span className={`text-[11px] ${RISK_LEVEL_STYLE[r.level] ?? "text-muted"}`} title={r.reason}>
                        {r.level} — {r.reason}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
