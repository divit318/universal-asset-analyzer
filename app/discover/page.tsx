"use client";

/**
 * /discover — unified stock discovery hub
 *
 * Two tabs:
 *   - "Live Signals" — the market scanner (news-driven AI signals)
 *   - "Stock Screener" — the fundamental screener (filter by metrics)
 *
 * Both redirect to /stocks/[symbol] on symbol click.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { DatasetStatus, ScanResult, StockMetrics } from "@/lib/types";
import { SCREENER_SECTORS } from "@/lib/yahoo-screener";
import { formatMarketCap } from "@/lib/format";
import { useCallback, useRef } from "react";
import { SignalCard } from "@/app/scanner/_components/signal-card";
import { NewsItemRow } from "@/app/scanner/_components/news-item";
import { ScoreChip } from "@/app/screener/_components/score-chip";
import {
  COLUMNS,
  PRESETS,
  SCORE_FIELDS,
  SECTIONS,
  type ColumnDef,
  type Preset,
} from "@/app/screener/_config";

type Tab = "signals" | "screener";

function DiscoverContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) ?? "signals";
  const [tab, setTab] = useState<Tab>(initialTab);

  function switchTab(t: Tab) {
    setTab(t);
    router.replace(`/discover?tab=${t}`, { scroll: false });
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Discover</h1>
        <p className="text-muted">
          Find stocks two ways — AI-powered news signals or a deep fundamental screener.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-border">
        {([
          { id: "signals" as Tab, label: "Live Market Signals" },
          { id: "screener" as Tab, label: "Fundamental Screener" },
        ] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`px-4 py-2 text-sm transition-colors ${
              tab === t.id
                ? "border-b-2 border-accent font-medium text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "signals" ? <ScannerTab /> : <ScreenerTab />}
    </main>
  );
}

export default function DiscoverPage() {
  return (
    <Suspense>
      <DiscoverContent />
    </Suspense>
  );
}

/* ─────────────────────────── Scanner tab ─────────────────────────── */

const DIR_FILTERS = ["all", "bullish", "bearish", "neutral"] as const;
type DirFilter = (typeof DIR_FILTERS)[number];

function ScannerTab() {
  const [query, setQuery] = useState("");
  const [india, setIndia] = useState(true);
  const [global, setGlobal] = useState(true);
  const [minConfidence, setMinConfidence] = useState(50);
  const [dirFilter, setDirFilter] = useState<DirFilter>("all");
  const [showNews, setShowNews] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScan(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/scanner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() || undefined, india, global, minConfidence }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Scan failed");
      setResult(json as ScanResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const visibleSignals = result?.signals.filter(
    (s) => dirFilter === "all" || s.direction === dirFilter,
  ) ?? [];

  const bullishCount = result?.signals.filter((s) => s.direction === "bullish").length ?? 0;
  const bearishCount = result?.signals.filter((s) => s.direction === "bearish").length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={runScan} className="flex flex-col gap-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Theme or headline — e.g. 'RBI rate cut', 'budget infra' — or leave blank for auto-scan"
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-accent-strong px-6 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Scan"}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" checked={india} onChange={(e) => setIndia(e.target.checked)} className="accent-accent" />
            Indian markets
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} className="accent-accent" />
            Global markets
          </label>
          <label className="flex items-center gap-2 text-muted">
            Min confidence
            <input
              type="number" min={0} max={100} value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-center text-xs outline-none focus:border-accent"
            />
          </label>
        </div>
      </form>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Fetching news from ET, NSE, Moneycontrol, Yahoo Finance, Google News…
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border border-border bg-surface" />
            ))}
          </div>
        </div>
      ) : null}

      {result && !loading ? (
        <div className="flex flex-col gap-6">
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold">Market Overview</h2>
              <span className="font-mono text-xs text-muted">{new Date(result.scannedAt).toLocaleString()}</span>
            </div>
            <p className="text-sm leading-6 text-muted">{result.aiSummary}</p>
            {result.themes.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {result.themes.map((t) => (
                  <button
                    key={t}
                    onClick={() => { setQuery(t); void runScan(); }}
                    className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-semibold">{result.signals.length} signals</span>
              <span className="text-positive">↑ {bullishCount} bullish</span>
              <span className="text-negative">↓ {bearishCount} bearish</span>
            </div>
            <div className="flex gap-1">
              {DIR_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setDirFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs capitalize transition-colors ${
                    dirFilter === f ? "bg-accent-strong text-background" : "border border-border hover:bg-surface-2"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {visibleSignals.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSignals.map((s) => (
                <SignalCard key={`${s.ticker}-${s.theme}`} signal={s} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No signals match the current filter.</p>
          )}

          <section className="rounded-xl border border-border">
            <button
              onClick={() => setShowNews((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold">Source news ({result.newsItems.length} articles)</span>
              <span className="text-muted">{showNews ? "−" : "+"}</span>
            </button>
            {showNews ? (
              <ul className="border-t border-border bg-surface">
                {result.newsItems.map((item, i) => (
                  <NewsItemRow key={i} item={item} />
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}

      {!result && !loading && !error ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center text-muted">
          <span className="text-4xl">◈</span>
          <p className="max-w-sm text-sm">
            Enter a theme above or hit Scan to run an automatic scan of today&apos;s market-moving
            events across Indian and global markets.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {["RBI rate cut", "Budget 2025 infra", "IT sector results", "Oil price rally", "FII selling"].map((t) => (
              <button
                key={t}
                onClick={() => { setQuery(t); setTimeout(() => void runScan(), 0); }}
                className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── Screener tab ─────────────────────────── */

type Bounds = { min: string; max: string };
const ALL_RANGE_KEYS = [
  "marketCap",
  ...SECTIONS.flatMap((s) => s.fields.map((f) => f.key)),
  ...SCORE_FIELDS.map((f) => f.key),
];
const emptyRanges = (): Record<string, Bounds> =>
  Object.fromEntries(ALL_RANGE_KEYS.map((k) => [k, { min: "", max: "" }]));

const PAGE_SIZE = 50;

function ScreenerTab() {
  const [ranges, setRanges] = useState<Record<string, Bounds>>(emptyRanges);
  const [sector, setSector] = useState("");
  const [industry, setIndustry] = useState("");
  const [sortField, setSortField] = useState("overallScore");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState<Set<string>>(new Set(["Valuation", "Quality"]));
  const [rows, setRows] = useState<StockMetrics[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<DatasetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildBody = useCallback(
    (offset: number, sf = sortField, sd = sortDir) => {
      const filters: Record<string, { min: number | null; max: number | null }> = {};
      for (const key of ALL_RANGE_KEYS) {
        const b = ranges[key];
        const min = b.min === "" ? null : Number(b.min);
        const max = b.max === "" ? null : Number(b.max);
        if (min == null && max == null) continue;
        const scale = key === "marketCap" ? 1e9 : 1;
        filters[key] = { min: min == null ? null : min * scale, max: max == null ? null : max * scale };
      }
      return { sector: sector || null, industry: industry || null, sortField: sf, sortDir: sd, size: PAGE_SIZE, offset, filters };
    },
    [ranges, sector, industry, sortField, sortDir],
  );

  const run = useCallback(
    async (offset = 0, sf = sortField, sd = sortDir) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/screener", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildBody(offset, sf, sd)),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Screener failed");
        setStatus(json.status as DatasetStatus);
        setTotal(json.total as number);
        setRows((prev) => offset > 0 && prev ? [...prev, ...(json.rows as StockMetrics[])] : (json.rows as StockMetrics[]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [buildBody, sortField, sortDir],
  );

  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (status?.stage === "building") {
      pollRef.current = setTimeout(() => void run(0), 4000);
    }
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [status, run]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void run(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setRange(key: string, bound: keyof Bounds, value: string) {
    setRanges((r) => ({ ...r, [key]: { ...r[key], [bound]: value } }));
  }

  function reset() {
    setRanges(emptyRanges());
    setSector("");
    setIndustry("");
    setSortField("overallScore");
    setSortDir("desc");
  }

  function applyPreset(p: Preset) {
    const next = emptyRanges();
    let sf = "overallScore";
    let sd: "asc" | "desc" = "desc";
    for (const [key, val] of Object.entries(p.criteria)) {
      if (key === "sortField") sf = val as string;
      else if (key === "sortDir") sd = val as "asc" | "desc";
      else if (val && typeof val === "object") {
        const v = val as { min?: number | null; max?: number | null };
        next[key] = { min: v.min != null ? String(v.min) : "", max: v.max != null ? String(v.max) : "" };
      }
    }
    setRanges(next);
    setSector("");
    setIndustry("");
    setSortField(sf);
    setSortDir(sd);
    void run(0, sf, sd);
  }

  function toggleSort(field: string) {
    const nextDir = sortField === field && sortDir === "desc" ? "asc" : "desc";
    setSortField(field);
    setSortDir(nextDir);
    void run(0, field, nextDir);
  }

  async function refreshData() {
    setLoading(true);
    try {
      await fetch("/api/screener", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: true }) });
    } finally {
      void run(0);
    }
  }

  function toggleSection(title: string) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      return n;
    });
  }

  const building = status?.stage === "building";
  const pctReady = status && status.total ? Math.round((status.ready / status.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Dataset status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
        {building ? (
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            <span className="text-muted">Building dataset… {status!.ready} / {status!.total} companies</span>
            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pctReady}%` }} />
            </div>
          </>
        ) : status?.stage === "ready" ? (
          <span className="text-muted">
            <span className="font-medium text-foreground">{status.ready.toLocaleString("en-US")}</span> stocks
          </span>
        ) : (
          <span className="text-muted">Loading dataset…</span>
        )}
        <button
          onClick={refreshData}
          disabled={loading || building}
          className="ml-auto rounded-md border border-border px-3 py-1 text-xs transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          ↻ Refresh data
        </button>
      </div>

      {/* Quick screens */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            onClick={() => applyPreset(p)}
            className="flex flex-col rounded-lg border border-border bg-surface px-3.5 py-2 text-left transition-colors hover:border-accent hover:bg-surface-2"
          >
            <span className="text-sm font-medium">{p.name}</span>
            <span className="text-xs text-muted">{p.tagline}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Filters sidebar */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Company</h2>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Sector</span>
                <select value={sector} onChange={(e) => setSector(e.target.value)} className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent">
                  <option value="">All sectors</option>
                  {SCREENER_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Industry contains</span>
                <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. Semiconductors" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent" />
              </label>
              <RangeRow label="Market Cap" unit="$B" bounds={ranges.marketCap} onChange={(b, v) => setRange("marketCap", b, v)} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold">Composite Scores</h2>
            <p className="mb-3 text-xs text-muted">Minimum 0–100 score in each dimension.</p>
            <div className="flex flex-col gap-2.5">
              {SCORE_FIELDS.map((f) => (
                <RangeRow key={f.key} label={f.label} bounds={ranges[f.key]} onChange={(b, v) => setRange(f.key, b, v)} />
              ))}
            </div>
          </div>

          {SECTIONS.map((sec) => (
            <div key={sec.title} className="rounded-xl border border-border bg-surface">
              <button onClick={() => toggleSection(sec.title)} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-sm font-semibold">{sec.title}</span>
                <span className="text-muted">{open.has(sec.title) ? "−" : "+"}</span>
              </button>
              {open.has(sec.title) ? (
                <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
                  <p className="text-xs text-muted">{sec.blurb}</p>
                  {sec.fields.map((f) => (
                    <RangeRow key={f.key} label={f.label} unit={f.unit} step={f.step} bounds={ranges[f.key]} onChange={(b, v) => setRange(f.key, b, v)} />
                  ))}
                </div>
              ) : null}
            </div>
          ))}

          <div className="flex gap-2">
            <button onClick={() => void run(0)} disabled={loading} className="flex-1 rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
              {loading ? "Running…" : "Run screen"}
            </button>
            <button onClick={reset} className="rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-surface-2">Reset</button>
          </div>
        </aside>

        {/* Results table */}
        <section className="flex min-w-0 flex-col gap-3">
          {error ? (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
          ) : null}
          <div className="flex items-center justify-between text-sm text-muted">
            <span>{total.toLocaleString("en-US")} match{total === 1 ? "" : "es"}{rows ? ` · showing ${rows.length}` : ""}</span>
            <span className="text-xs">Click a column to sort</span>
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-3 py-3 font-medium">#</th>
                  <th className="px-3 py-3 font-medium">Symbol</th>
                  <th className="px-3 py-3 font-medium">Name</th>
                  <th className="px-3 py-3 font-medium">Sector</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} onClick={() => toggleSort(c.key)} className="cursor-pointer select-none px-3 py-3 text-right font-medium hover:text-foreground">
                      {c.label}{sortField === c.key ? (sortDir === "desc" ? " ▾" : " ▴") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows && rows.length > 0 ? (
                  rows.map((m, i) => (
                    <tr key={m.symbol} className="bg-surface hover:bg-surface-2">
                      <td className="px-3 py-2.5 text-muted">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <Link href={`/stocks/${encodeURIComponent(m.symbol)}`} className="font-mono font-semibold text-accent hover:underline">
                          {m.symbol}
                        </Link>
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted">{m.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{m.sector ?? "—"}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-right">
                          <CellValue col={c} value={c.get(m)} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4 + COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted">
                      {status?.stage === "building" ? "Building dataset… results appear as companies are analyzed." : loading ? "Loading…" : "No matches. Loosen the filters or try a quick screen."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {rows && rows.length < total ? (
            <button onClick={() => void run(rows.length)} disabled={loading} className="self-center rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
              {loading ? "Loading…" : `Load more (${(total - rows.length).toLocaleString("en-US")} more)`}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CellValue({ col, value }: { col: ColumnDef; value: number | null }) {
  if (col.kind === "score") return <ScoreChip value={value} lg={col.key === "overallScore"} />;
  if (value == null) return <span className="font-mono text-muted">—</span>;
  if (col.kind === "mcap") return <span className="font-mono">{formatMarketCap(value)}</span>;
  if (col.kind === "ratio") return <span className="font-mono">{value.toFixed(1)}x</span>;
  const cls = value < 0 ? "text-negative" : "";
  return <span className={`font-mono ${cls}`}>{value.toFixed(1)}%</span>;
}

function RangeRow({
  label, unit, step, bounds, onChange,
}: {
  label: string; unit?: string; step?: string;
  bounds: Bounds; onChange: (bound: keyof Bounds, value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-xs text-muted">
        {label}{unit ? <span className="text-muted/60"> {unit}</span> : null}
      </span>
      <input type="number" step={step ?? "any"} value={bounds.min} onChange={(e) => onChange("min", e.target.value)} placeholder="min" className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-accent" />
      <input type="number" step={step ?? "any"} value={bounds.max} onChange={(e) => onChange("max", e.target.value)} placeholder="max" className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-accent" />
    </div>
  );
}
