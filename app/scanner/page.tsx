"use client";

import { useState } from "react";
import type { ScanResult } from "@/lib/types";
import { SignalCard } from "./_components/signal-card";
import { NewsItemRow } from "./_components/news-item";

const DIR_FILTERS = ["all", "bullish", "bearish", "neutral"] as const;
type DirFilter = (typeof DIR_FILTERS)[number];

export default function ScannerPage() {
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Market Scanner</h1>
        <p className="text-muted">
          AI-driven scan of live news and events. Surfaces actionable signals across Indian and
          global markets — backed by fundamentals.
        </p>
      </div>

      {/* Controls */}
      <form onSubmit={runScan} className="flex flex-col gap-4">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Theme or headline (e.g. 'RBI rate cut', 'budget infra', 'oil price spike') — or leave blank for auto-scan"
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

        {/* Options row */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={india}
              onChange={(e) => setIndia(e.target.checked)}
              className="accent-accent"
            />
            Indian markets
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-muted">
            <input
              type="checkbox"
              checked={global}
              onChange={(e) => setGlobal(e.target.checked)}
              className="accent-accent"
            />
            Global markets
          </label>
          <label className="flex items-center gap-2 text-muted">
            Min confidence
            <input
              type="number"
              min={0}
              max={100}
              value={minConfidence}
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

      {/* Loading skeleton */}
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
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl border border-border bg-surface"
              />
            ))}
          </div>
        </div>
      ) : null}

      {result && !loading ? (
        <div className="flex flex-col gap-6">
          {/* Summary */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold">Market Overview</h2>
              <span className="font-mono text-xs text-muted">
                {new Date(result.scannedAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted">{result.aiSummary}</p>

            {result.themes.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {result.themes.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setQuery(t);
                      void runScan();
                    }}
                    className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
                  >
                    {t}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Signal stats */}
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
                    dirFilter === f
                      ? "bg-accent-strong text-background"
                      : "border border-border hover:bg-surface-2"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Signal grid */}
          {visibleSignals.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSignals.map((s) => (
                <SignalCard key={`${s.ticker}-${s.theme}`} signal={s} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">No signals match the current filter.</p>
          )}

          {/* News drawer */}
          <section className="rounded-xl border border-border">
            <button
              onClick={() => setShowNews((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span className="text-sm font-semibold">
                Source news ({result.newsItems.length} articles)
              </span>
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
            {["RBI rate cut", "Budget 2025 infra", "IT sector results", "Oil price rally", "FII selling"].map(
              (t) => (
                <button
                  key={t}
                  onClick={() => {
                    setQuery(t);
                    setTimeout(() => void runScan(), 0);
                  }}
                  className="rounded-full border border-border px-3 py-1 text-xs transition-colors hover:border-accent hover:text-accent"
                >
                  {t}
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
