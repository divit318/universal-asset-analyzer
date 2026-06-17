"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // NL screener state
  const [nlPrompt, setNlPrompt] = useState("");
  const [nlModel, setNlModel] = useState("");
  const [nlModels, setNlModels] = useState<string[]>([]);
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlApplied, setNlApplied] = useState<string | null>(null);

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

  // Fetch installed Ollama models for the NL screener model picker.
  useEffect(() => {
    fetch("/api/screener/nl")
      .then((r) => r.json())
      .then((d: { models?: string[] }) => {
        const models = d.models ?? [];
        setNlModels(models);
        if (models.length > 0) setNlModel(models[0]);
      })
      .catch(() => {/* Ollama offline — NL screener degrades gracefully */});
  }, []);

  // First load: trigger the build + show whatever's ready. A one-time kickoff
  // from mount is exactly the intended behavior here.
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
    setNlApplied(null);
    setNlError(null);
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

      setRanges(next);
      setSector(newSector);
      setIndustry(newIndustry);
      setSortField(sf);
      setSortDir(sd);
      setNlApplied(nlPrompt.trim());
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
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Fundamental Screener</h1>
        <p className="max-w-3xl text-muted">
          Find US-listed stocks for long-term investing. Start with a one-click strategy, or
          build a custom screen across valuation, growth, quality, financial strength, cash
          flow, shareholder returns, and momentum.
        </p>
        <DatasetBar status={status} loading={loading} onRefresh={refreshData} />
      </header>

      {/* AI Natural Language Screener */}
      {nlModels.length > 0 ? (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">AI Screen</span>
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
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
            className="w-full resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="flex items-center gap-2">
            {nlModels.length > 1 ? (
              <select
                value={nlModel}
                onChange={(e) => setNlModel(e.target.value)}
                className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-xs outline-none focus:border-accent"
              >
                {nlModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : null}
            <button
              onClick={() => void runNlScreen()}
              disabled={nlLoading || !nlPrompt.trim()}
              className="rounded-lg bg-accent-strong px-4 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {nlLoading ? "Analyzing…" : "Apply ↵"}
            </button>
          </div>
          {nlError ? (
            <p className="text-xs text-negative">{nlError}</p>
          ) : nlApplied ? (
            <p className="text-xs text-positive">
              Screen applied — filters set from your description.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Quick screens */}
      <section className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Quick screens</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => applyPreset(p)}
              className="group flex flex-col rounded-lg border border-border bg-surface px-3.5 py-2 text-left transition-colors hover:border-accent hover:bg-surface-2"
            >
              <span className="text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted">{p.tagline}</span>
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
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
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
                  className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
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

          {SECTIONS.map((sec) => (
            <div key={sec.title} className="rounded-xl border border-border bg-surface">
              <button
                onClick={() => toggleSection(sec.title)}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span className="text-sm font-semibold">{sec.title}</span>
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
          ))}

          <div className="flex gap-2">
            <button
              onClick={() => void run(0)}
              disabled={loading}
              className="flex-1 rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
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
                    <th
                      key={c.key}
                      onClick={() => toggleSort(c.key)}
                      className="cursor-pointer select-none px-3 py-3 text-right font-medium hover:text-foreground"
                    >
                      {c.label}
                      {sortField === c.key ? (sortDir === "desc" ? " ▾" : " ▴") : ""}
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
                        <Link
                          href={`/research?symbol=${encodeURIComponent(m.symbol)}`}
                          className="font-mono font-semibold text-accent hover:underline"
                        >
                          {m.symbol}
                        </Link>
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted">{m.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{m.sector ?? "—"}</td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-3 py-2.5 text-right">
                          <Cell col={c} value={c.get(m)} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4 + COLUMNS.length} className="px-4 py-10 text-center text-sm text-muted">
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
    </main>
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
      {value >= 0 ? "" : ""}
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
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          <span className="text-muted">
            Building dataset… {status!.ready} / {status!.total} companies
          </span>
          <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pctReady}%` }} />
          </div>
        </>
      ) : status?.stage === "error" ? (
        <span className="text-negative">Dataset error: {status.error}</span>
      ) : status?.stage === "ready" ? (
        <span className="text-muted">
          <span className="font-medium text-foreground">{status.ready.toLocaleString("en-US")}</span> stocks ·
          updated {relativeTime(status.builtAt)}
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

function relativeTime(iso: string | null): string {
  if (!iso) return "just now";
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
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
        className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-accent"
      />
      <input
        type="number"
        step={step ?? "any"}
        value={bounds.max}
        onChange={(e) => onChange("max", e.target.value)}
        placeholder="max"
        className="w-16 rounded-md border border-border bg-surface-2 px-2 py-1 text-right text-xs outline-none placeholder:text-muted/60 focus:border-accent"
      />
    </div>
  );
}
