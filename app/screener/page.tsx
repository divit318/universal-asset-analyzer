"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { downloadBlob } from "@/lib/download";
import type { DatasetStatus, StockMetrics } from "@/lib/types";
import { SCREENER_SECTORS } from "@/lib/yahoo-screener";
import { formatMarketCap } from "@/lib/format";
import { ScoreChip } from "./_components/score-chip";
import {
  COLUMNS,
  PRESETS,
  SCORE_FIELDS,
  SECTIONS,
  type ColumnDef,
  type Preset,
} from "./_config";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { DataProvenance } from "@/app/_components/data-provenance";
import { PageShell, PageHeader } from "@/app/_components/ui";

type Bounds = { min: string; max: string };
const ALL_RANGE_KEYS = [
  "marketCap",
  ...SECTIONS.flatMap((s) => s.fields.map((f) => f.key)),
  ...SCORE_FIELDS.map((f) => f.key),
];
const emptyRanges = (): Record<string, Bounds> =>
  Object.fromEntries(ALL_RANGE_KEYS.map((k) => [k, { min: "", max: "" }]));

const PAGE_SIZE = 50;

export default function ScreenerPage() {
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
  const [exportErr, setExportErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableOverflowsRight, setTableOverflowsRight] = useState(false);

  // IOS — portfolio fit scores for visible rows
  const [fitSort, setFitSort] = useState(false);
  const ios = useIOSSafe();
  const fitScores = useMemo(() => {
    if (!ios?.profileReady || !rows) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const m of rows) {
      const fit = ios.getPortfolioFit({
        symbol: m.symbol,
        sector: m.sector ?? null,
        marketCap: m.marketCap,
        compositeScores: m.scores,
        dividendYield: m.dividendYield,
      });
      map.set(m.symbol, fit.fitScore);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profileReady, rows]);

  const displayRows = useMemo(() => {
    if (!fitSort || fitScores.size === 0 || !rows) return rows;
    return [...rows].sort((a, b) => (fitScores.get(b.symbol) ?? 0) - (fitScores.get(a.symbol) ?? 0));
  }, [fitSort, fitScores, rows]);

  // NL screener state
  const [nlPrompt, setNlPrompt] = useState("");
  const [nlModel, setNlModel] = useState("");
  const [nlModels, setNlModels] = useState<string[]>([]);
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlApplied, setNlApplied] = useState<string | null>(null);
  const [nlCriteria, setNlCriteria] = useState<Record<string, { min?: number | null; max?: number | null }> | null>(null);

  // Watchlist state
  const [watchlisted, setWatchlisted] = useState<Set<string>>(new Set());
  const [watchAdding, setWatchAdding] = useState<Set<string>>(new Set());
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  const buildBody = useCallback(
    (offset: number, sf = sortField, sd = sortDir) => {
      const filters: Record<string, { min: number | null; max: number | null }> = {};
      for (const key of ALL_RANGE_KEYS) {
        const b = ranges[key];
        const min = b.min === "" ? null : Number(b.min);
        const max = b.max === "" ? null : Number(b.max);
        if (min == null && max == null) continue;
        const scale = key === "marketCap" ? 1e9 : 1; // market cap entered in $B
        filters[key] = {
          min: min == null ? null : min * scale,
          max: max == null ? null : max * scale,
        };
      }
      return {
        sector: sector || null,
        industry: industry || null,
        sortField: sf,
        sortDir: sd,
        size: PAGE_SIZE,
        offset,
        filters,
      };
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
        setRows((prev) =>
          offset > 0 && prev ? [...prev, ...(json.rows as StockMetrics[])] : (json.rows as StockMetrics[]),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [buildBody, sortField, sortDir],
  );

  // Always-current references used in session save/restore
   
  const runRef = useRef(run);
  // eslint-disable-next-line react-hooks/refs
  runRef.current = run;
   
  const _s = useRef({ ranges, sector, industry, sortField, sortDir, nlPrompt, activePreset, open });
  // eslint-disable-next-line react-hooks/refs
  _s.current = { ranges, sector, industry, sortField, sortDir, nlPrompt, activePreset, open };

  // Auto-poll while the dataset warms so results fill in without manual reloads.
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (status?.stage === "building") {
      pollRef.current = setTimeout(() => void run(0), 4000);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [status, run]);

  // Dynamic page title
  useEffect(() => {
    document.title = "Screener · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  // Track whether the results table overflows horizontally, to show a scroll affordance.
  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const check = () => setTableOverflowsRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    check();
    el.addEventListener("scroll", check);
    window.addEventListener("resize", check);
    return () => {
      el.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [rows]);

  // Fetch installed Ollama models for the NL screener model picker.
  useEffect(() => {
    fetch("/api/screener/nl")
      .then((r) => r.json())
      .then((d: { models?: string[] }) => {
        const models = d.models ?? [];
        setNlModels(models);
        setOllamaOnline(models.length > 0);
        if (models.length > 0) setNlModel(models[0]);
      })
      .catch(() => { setOllamaOnline(false); });
  }, []);

  // Restore filter preferences from session on mount; save on unmount.
  // Filters survive client-side navigation but reset when the tab is closed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("uaa_screener_state");
      if (raw) {
        const st = JSON.parse(raw) as { ranges?: Record<string, Bounds>; sector?: string; industry?: string; sortField?: string; sortDir?: "asc" | "desc"; nlPrompt?: string; activePreset?: string | null; open?: string[] };
        /* eslint-disable react-hooks/set-state-in-effect */
        if (st.ranges) setRanges(st.ranges);
        if (st.sector !== undefined) setSector(st.sector);
        if (st.industry !== undefined) setIndustry(st.industry);
        if (st.sortField) setSortField(st.sortField);
        if (st.sortDir) setSortDir(st.sortDir);
        if (st.nlPrompt !== undefined) setNlPrompt(st.nlPrompt);
        if (st.activePreset !== undefined) setActivePreset(st.activePreset);
        if (st.open) setOpen(new Set(st.open));
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch { /* ignore corrupt storage */ }
    return () => {
      try {
        const { ranges: r, sector: s, industry: i, sortField: sf, sortDir: sd, nlPrompt: nl, activePreset: ap, open: o } = _s.current;
        sessionStorage.setItem("uaa_screener_state", JSON.stringify({ ranges: r, sector: s, industry: i, sortField: sf, sortDir: sd, nlPrompt: nl, activePreset: ap, open: Array.from(o) }));
      } catch { /* ignore */ }
    };
   
  }, []);

  // First load: trigger the build + show whatever's ready.
  // setTimeout(0) lets restored filter state settle before fetching.
  useEffect(() => {
    const t = setTimeout(() => void runRef.current(0), 0);
    return () => clearTimeout(t);
   
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
    setNlApplied(null);
    setNlError(null);
    setNlCriteria(null);
    setActivePreset(null);
  }

  async function addToWatchlist(symbol: string, name: string) {
    setWatchAdding((s) => new Set(s).add(symbol));
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, name }),
      });
      setWatchlisted((s) => new Set(s).add(symbol));
    } finally {
      setWatchAdding((s) => { const n = new Set(s); n.delete(symbol); return n; });
    }
  }

  async function runNlScreen() {
    if (!nlPrompt.trim() || !nlModel) return;
    setNlLoading(true);
    setNlError(null);
    setNlApplied(null);
    try {
      const res = await fetch("/api/screener/nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: nlPrompt.trim(), model: nlModel }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "NL screener failed");

      const c = json.criteria as Record<string, unknown>;
      const next = emptyRanges();
      let sf = "overallScore";
      let sd: "asc" | "desc" = "desc";
      let newSector = "";
      let newIndustry = "";

      for (const [key, val] of Object.entries(c)) {
        if (key === "sortField" && typeof val === "string") { sf = val; continue; }
        if (key === "sortDir" && (val === "asc" || val === "desc")) { sd = val; continue; }
        if (key === "sector" && typeof val === "string") { newSector = val; continue; }
        if (key === "industry" && typeof val === "string") { newIndustry = val; continue; }
        if (val && typeof val === "object") {
          const r = val as { min?: number | null; max?: number | null };
          // marketCap arrives in dollars; the UI input expects $B (buildBody scales × 1e9)
          const scale = key === "marketCap" ? 1e-9 : 1;
          next[key] = {
            min: r.min != null ? String(r.min * scale) : "",
            max: r.max != null ? String(r.max * scale) : "",
          };
        }
      }

      const metaCriteria: Record<string, { min?: number | null; max?: number | null }> = {};
      for (const [key, val] of Object.entries(c)) {
        if (["sortField","sortDir","sector","industry"].includes(key)) continue;
        if (val && typeof val === "object") metaCriteria[key] = val as { min?: number | null; max?: number | null };
      }
      setRanges(next);
      setSector(newSector);
      setIndustry(newIndustry);
      setSortField(sf);
      setSortDir(sd);
      setNlApplied(nlPrompt.trim());
      setNlCriteria(Object.keys(metaCriteria).length > 0 ? metaCriteria : null);
      void run(0, sf, sd);
    } catch (err) {
      setNlError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setNlLoading(false);
    }
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
    setActivePreset(p.name);
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
      await fetch("/api/screener", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh: true }),
      });
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

  return (
    <PageShell py="py-10">
      <div className="flex flex-col gap-2">
        <PageHeader
          title="Fundamental Screener"
          description="Find US-listed stocks for long-term investing. Start with a one-click strategy, or build a custom screen across valuation, growth, quality, financial strength, cash flow, shareholder returns, and momentum."
        />
        <DatasetBar status={status} loading={loading} onRefresh={refreshData} />
      </div>

      {/* AI Natural Language Screener */}
      {ollamaOnline === false ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          <span className="text-yellow-500">⚠</span>
          <span>AI screening is unavailable — Ollama is not running. Start Ollama to use natural-language screens.</span>
        </div>
      ) : nlModels.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">AI Screen</span>
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
              Local · {nlModel.split(":")[0]}
            </span>
          </div>
          <p className="text-xs text-muted">
            Describe what you&apos;re looking for in plain English and the AI will translate it into a screen.
          </p>
          <textarea
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void runNlScreen();
            }}
            placeholder='e.g. "Large-cap tech companies with strong growth and clean balance sheets"'
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
          />
          <div className="flex items-center gap-2">
            {nlModels.length > 1 ? (
              <select
                value={nlModel}
                onChange={(e) => setNlModel(e.target.value)}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs outline-none focus:border-brand"
              >
                {nlModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : null}
            <button
              onClick={() => void runNlScreen()}
              disabled={nlLoading || !nlPrompt.trim()}
              className="rounded-lg bg-brand-strong px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {nlLoading ? "Analyzing…" : "Apply (Ctrl+Enter)"}
            </button>
          </div>
          {nlError ? (
            <p className="text-xs text-negative">{nlError}</p>
          ) : nlApplied ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-positive">Screen applied from: &ldquo;{nlApplied}&rdquo;</p>
              {nlCriteria && Object.keys(nlCriteria).length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(nlCriteria).map(([key, val]) => (
                    <span key={key} className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-xs text-brand">
                      {nlChipLabel(key, val)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Quick screens */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted/60">Starter Screens</span>
          <div className="h-px flex-1 bg-border" />
          {activePreset && (
            <button onClick={reset} className="text-xs text-muted hover:text-foreground transition-colors">
              Clear &ldquo;{activePreset}&rdquo; ×
            </button>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className={`group flex flex-col gap-1.5 rounded-xl border px-4 py-3.5 text-left transition-all hover:border-brand/40 hover:bg-surface-2 ${
                activePreset === p.name
                  ? "border-brand/50 bg-brand/5 shadow-[0_0_0_1px_rgba(56,189,248,0.1)]"
                  : "border-border bg-surface"
              }`}
            >
              <span className={`text-sm font-semibold transition-colors ${activePreset === p.name ? "text-brand" : "text-foreground group-hover:text-brand"}`}>
                {p.name}
              </span>
              <span className="text-xs leading-4 text-muted">{p.tagline}</span>
              {activePreset === p.name && (
                <span className="mt-0.5 text-label font-medium uppercase tracking-wide text-brand">Active</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Filters */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Company</h2>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Sector</span>
                <select
                  value={sector}
                  onChange={(e) => setSector(e.target.value)}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-brand"
                >
                  <option value="">All sectors</option>
                  {SCREENER_SECTORS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Industry contains</span>
                <input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g. Semiconductors"
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
                />
              </label>
              <RangeRow
                label="Market Cap"
                unit="$B"
                bounds={ranges.marketCap}
                onChange={(b, v) => setRange("marketCap", b, v)}
              />
            </div>
          </div>

          {/* Composite score floors */}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold">Composite Scores</h2>
            <p className="mb-3 text-xs text-muted">Minimum 0–100 score in each dimension.</p>
            <div className="flex flex-col gap-2.5">
              {SCORE_FIELDS.map((f) => (
                <RangeRow
                  key={f.key}
                  label={f.label}
                  bounds={ranges[f.key]}
                  onChange={(b, v) => setRange(f.key, b, v)}
                />
              ))}
            </div>
          </div>

          {SECTIONS.map((sec) => {
            const activeCount = sec.fields.filter((f) => ranges[f.key]?.min !== "" || ranges[f.key]?.max !== "").length;
            return (
              <div key={sec.title} className="rounded-xl border border-border bg-surface">
                <button
                  onClick={() => toggleSection(sec.title)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{sec.title}</span>
                    {!open.has(sec.title) && activeCount > 0 && (
                      <span className="rounded-full bg-brand px-1.5 py-0.5 text-label font-semibold leading-none text-background">
                        {activeCount}
                      </span>
                    )}
                  </div>
                  <span className="text-muted">{open.has(sec.title) ? "−" : "+"}</span>
                </button>
                {open.has(sec.title) ? (
                  <div className="flex flex-col gap-2.5 border-t border-border px-4 py-3">
                    <p className="text-xs text-muted">{sec.blurb}</p>
                    {sec.fields.map((f) => (
                      <RangeRow
                        key={f.key}
                        label={f.label}
                        unit={f.unit}
                        step={f.step}
                        bounds={ranges[f.key]}
                        onChange={(b, v) => setRange(f.key, b, v)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="flex gap-2">
            <button
              onClick={() => void run(0)}
              disabled={loading}
              className="flex-1 rounded-lg bg-brand-strong px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Running…" : "Run screen"}
            </button>
            <button
              onClick={reset}
              className="rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              Reset
            </button>
          </div>
        </aside>

        {/* Results */}
        <section className="flex min-w-0 flex-col gap-3">
          {error ? (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              {total.toLocaleString("en-US")} match{total === 1 ? "" : "es"}
              {rows ? ` · showing ${rows.length}` : ""}
            </span>
            <div className="flex items-center gap-3">
              {ios?.profileReady && ios.profile.hasPortfolio && rows && rows.length > 0 && (
                <button
                  onClick={() => setFitSort((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
                    fitSort
                      ? "border-brand/40 bg-brand/10 text-brand"
                      : "border-border text-muted hover:border-brand/30 hover:text-brand"
                  }`}
                >
                  ✦ {fitSort ? "Sorted by Fit" : "Sort by Portfolio Fit"}
                </button>
              )}
              <span className="text-xs">Click a column to sort</span>
              {rows && rows.length > 0 && (
                <button
                  onClick={() => {
                    const date = new Date().toISOString().slice(0, 10);
                    setExportErr(null);
                    void downloadBlob("/api/export/screener", `screener-${date}.xlsx`, "POST", { rows })
                      .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
                  }}
                  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-surface-2"
                >
                  ↓ Export Excel
                </button>
              )}
              {exportErr && <span className="text-xs text-negative">{exportErr}</span>}
            </div>
          </div>

          <div className="relative">
            <div ref={tableScrollRef} className="max-h-[calc(100vh-15rem)] overflow-auto rounded-card border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-left text-xs font-semibold uppercase tracking-wide text-muted [&_th]:border-b [&_th]:border-border">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Symbol</th>
                  <th className="px-3 py-2.5 font-semibold">Name</th>
                  <th className="px-3 py-2.5 font-semibold">Sector</th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className={`cursor-pointer select-none px-3 py-2.5 text-right font-semibold transition-colors hover:text-foreground ${sortField === c.key ? "text-brand" : ""}`}
                    >
                      {c.label}
                      {c.kind === "score" && (
                        <span className="font-normal text-muted">/100</span>
                      )}
                      {sortField === c.key ? (sortDir === "desc" ? " ▾" : " ▴") : ""}
                    </th>
                  ))}
                  {ios?.profileReady && ios.profile.hasPortfolio && (
                    <th
                      onClick={() => setFitSort((v) => !v)}
                      className="cursor-pointer select-none px-3 py-3 text-right font-medium text-brand hover:text-brand/80"
                    >
                      Portfolio Fit {fitSort ? "▾" : ""}
                    </th>
                  )}
                  <th className="px-3 py-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayRows && displayRows.length > 0 ? (
                  displayRows.map((m, i) => {
                    const fit = ios?.profileReady && ios.profile.hasPortfolio
                      ? ios.getPortfolioFit({ symbol: m.symbol, sector: m.sector ?? null, marketCap: m.marketCap, compositeScores: m.scores, dividendYield: m.dividendYield })
                      : null;
                    return (
                    <tr key={m.symbol} className="bg-surface transition-colors hover:bg-surface-2">
                      <td className="px-3 py-2.5 tabular-nums text-faint">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/research?symbol=${encodeURIComponent(m.symbol)}`}
                          className="font-mono font-semibold text-brand hover:underline"
                        >
                          {m.symbol}
                        </Link>
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted">{m.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{m.sector ?? "—"}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-right tabular-nums">
                          <Cell col={c} value={c.get(m)} />
                        </td>
                      ))}
                      {fit && (
                        <td className="px-3 py-2.5 text-right">
                          <PortfolioFitBadge score={fit.fitScore} tier={fit.fitTier} showScore={false} />
                        </td>
                      )}
                      <td className="px-2 py-2.5">
                        {watchlisted.has(m.symbol) ? (
                          <span className="text-xs text-positive">✓ Watching</span>
                        ) : (
                          <button
                            onClick={() => void addToWatchlist(m.symbol, m.name ?? m.symbol)}
                            disabled={watchAdding.has(m.symbol)}
                            title={`Add ${m.symbol} to watchlist`}
                            className="rounded-md border border-border px-2 py-0.5 text-xs text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                          >
                            {watchAdding.has(m.symbol) ? "…" : "+ Watch"}
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4 + COLUMNS.length + (ios?.profile.hasPortfolio ? 1 : 0)} className="px-4 py-10 text-center text-sm text-muted">
                      {status?.stage === "building"
                        ? "Building the dataset… results will appear as companies are analyzed."
                        : loading
                          ? "Loading…"
                          : "No matches. Loosen the filters or try a quick screen."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
            {tableOverflowsRight && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 w-6 rounded-r-xl shadow-[inset_-16px_0_12px_-12px_rgba(0,0,0,0.55)]"
              />
            )}
          </div>

          {rows && rows.length < total ? (
            <button
              onClick={() => void run(rows.length)}
              disabled={loading}
              className="self-center rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {loading ? "Loading…" : `Load more (${(total - rows.length).toLocaleString("en-US")} more)`}
            </button>
          ) : null}
        </section>
      </div>
    </PageShell>
  );
}

function Cell({ col, value }: { col: ColumnDef; value: number | null }) {
  if (col.kind === "score") return <ScoreChip value={value} lg={col.key === "overallScore"} />;
  if (value == null) return <span className="font-mono text-muted">—</span>;
  if (col.kind === "mcap") return <span className="font-mono">{formatMarketCap(value)}</span>;
  if (col.kind === "ratio") return <span className="font-mono">{value.toFixed(1)}x</span>;
  // pct
  const cls = value < 0 ? "text-negative" : "";
  return (
    <span className={`font-mono ${cls}`}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function DatasetBar({
  status,
  loading,
  onRefresh,
}: {
  status: DatasetStatus | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const building = status?.stage === "building";
  const pctReady = status && status.total ? Math.round((status.ready / status.total) * 100) : 0;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm">
      {building ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
          </span>
          <span className="text-muted">
            Building dataset… {status!.ready} / {status!.total} companies
          </span>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pctReady}%` }} />
          </div>
        </>
      ) : status?.stage === "error" ? (
        <span className="text-negative">Dataset error: {status.error}</span>
      ) : status?.stage === "ready" ? (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <span className="font-medium text-foreground">{status.ready.toLocaleString("en-US")}</span> stocks
          <span className="text-faint">·</span>
          <DataProvenance source="yahoo" asOf={status.builtAt} ttlHours={24} />
        </span>
      ) : (
        <span className="text-muted">Loading dataset…</span>
      )}
      <button
        onClick={onRefresh}
        disabled={loading || building}
        className="ml-auto rounded-md border border-border px-3 py-1 text-xs transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        ↻ Refresh data
      </button>
    </div>
  );
}

function nlChipLabel(key: string, val: { min?: number | null; max?: number | null }): string {
  const humanKey = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
  const isPct = /growth|yield|margin|roe|roa|payout|change/i.test(key);
  const isBillions = /marketcap/i.test(key);
  const fmt = (n: number) => isBillions ? `$${n}B` : isPct ? `${n}%` : String(n);
  if (val.min != null && val.max != null) return `${humanKey}: ${fmt(val.min)}–${fmt(val.max)}`;
  if (val.min != null) return `${humanKey} ≥ ${fmt(val.min)}`;
  if (val.max != null) return `${humanKey} ≤ ${fmt(val.max)}`;
  return humanKey;
}

function RangeRow({
  label,
  unit,
  step,
  bounds,
  onChange,
}: {
  label: string;
  unit?: string;
  step?: string;
  bounds: Bounds;
  onChange: (bound: keyof Bounds, value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 text-xs text-muted">
        {label}
        {unit ? <span className="text-muted/60"> {unit}</span> : null}
      </span>
      <input
        type="number"
        step={step ?? "any"}
        value={bounds.min}
        onChange={(e) => onChange("min", e.target.value)}
        placeholder="min"
        className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-brand"
      />
      <input
        type="number"
        step={step ?? "any"}
        value={bounds.max}
        onChange={(e) => onChange("max", e.target.value)}
        placeholder="max"
        className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-brand"
      />
    </div>
  );
}
