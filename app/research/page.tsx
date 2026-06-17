"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiAnalysis, ResearchData } from "@/lib/types";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { Sparkline } from "./_components/sparkline";
import { FundamentalsSection } from "./_components/fundamentals-section";
import { SymbolSearch } from "./_components/symbol-search";

export default function ResearchPage() {
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const [data, setData] = useState<ResearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // setState only after the network await, so this is safe to call from an effect.
  const runResearch = useCallback(async (raw: string) => {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    try {
      const res = await fetch(`/api/research?symbol=${encodeURIComponent(sym)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Lookup failed (${res.status})`);
      setData(json as ResearchData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  function submit(raw: string) {
    const sym = raw.trim().toUpperCase();
    if (!sym) return;
    // Navigate to unified stock view
    router.push(`/stocks/${encodeURIComponent(sym)}`);
  }

  // Deep-link support: /research?symbol=AAPL redirects to /stocks/AAPL
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    if (!param) return;
    router.replace(`/stocks/${encodeURIComponent(param.toUpperCase())}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addToWatchlist() {
    if (!data) return;
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: data.quote.symbol, name: data.quote.name }),
      });
      if (res.ok) setSaved(true);
    } catch {
      /* non-critical */
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Research</h1>
        <p className="text-muted">
          Enter a ticker for a live quote, price history, SEC filings, and AI analysis.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(symbol);
        }}
        className="flex gap-2"
      >
        <SymbolSearch
          value={symbol}
          onChange={setSymbol}
          onSelect={(sym) => submit(sym)}
          loading={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Research"}
        </button>
      </form>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {data ? (
        <ResearchResult data={data} onSave={addToWatchlist} saved={saved} />
      ) : null}
    </main>
  );
}

function ResearchResult({
  data,
  onSave,
  saved,
}: {
  data: ResearchData;
  onSave: () => void;
  saved: boolean;
}) {
  const { quote, history, filings, edgarError } = data;
  const positive = quote.changePercent >= 0;

  const stats: [string, string][] = [
    ["Market cap", formatMarketCap(quote.marketCap)],
    ["P/E ratio", quote.peRatio != null ? formatNumber(quote.peRatio) : "—"],
    ["Day range", `${formatCurrency(quote.dayLow, quote.currency)} – ${formatCurrency(quote.dayHigh, quote.currency)}`],
    ["52-week range", `${formatCurrency(quote.fiftyTwoWeekLow, quote.currency)} – ${formatCurrency(quote.fiftyTwoWeekHigh, quote.currency)}`],
    ["Volume", quote.volume != null ? formatCompact(quote.volume) : "—"],
    ["Exchange", quote.exchange ?? "—"],
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-surface p-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-lg font-semibold">{quote.symbol}</span>
            <span className="text-muted">{quote.name}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-3xl font-semibold">
              {formatCurrency(quote.price, quote.currency)}
            </span>
            <span className={positive ? "text-positive" : "text-negative"}>
              {formatCurrency(quote.change, quote.currency)} ({formatPercent(quote.changePercent)})
            </span>
          </div>
        </div>
        <button
          onClick={onSave}
          disabled={saved}
          className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-60"
        >
          {saved ? "★ Saved" : "☆ Watchlist"}
        </button>
      </div>

      <Sparkline data={history} />

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface p-4">
            <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <AiPanel data={data} />

      {/* Filings */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Recent SEC filings</h2>
        {edgarError ? (
          <p className="text-sm text-muted">EDGAR unavailable: {edgarError}</p>
        ) : filings.length === 0 ? (
          <p className="text-sm text-muted">No recent filings found.</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {filings.map((f) => (
              <li key={f.accessionNumber} className="flex items-center justify-between gap-4 bg-surface px-4 py-3">
                <div className="min-w-0">
                  <span className="font-mono text-sm text-accent">{f.form}</span>
                  <p className="truncate text-sm text-muted">{f.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-xs text-muted">{formatDate(f.filedAt)}</span>
                  <a
                    href={f.documentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent hover:underline"
                  >
                    View →
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FundamentalsSection symbol={quote.symbol} quote={quote} />
    </div>
  );
}

function AiPanel({ data }: { data: ResearchData }) {
  const [result, setResult] = useState<AiAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: data.quote, filings: data.filings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "AI analysis failed");
      setResult(json as AiAnalysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">AI analysis</h2>
        <button
          onClick={analyze}
          disabled={loading}
          className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? "Analyzing…" : "Analyze"}
        </button>
      </div>
      {error ? <p className="text-sm text-negative">{error}</p> : null}
      {result ? (
        <>
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
            {result.analysis}
          </p>
          <p className="font-mono text-xs text-muted">model: {result.model}</p>
        </>
      ) : !error ? (
        <p className="text-sm text-muted">
          Generate a research summary using the configured AI provider (Claude or Ollama).
        </p>
      ) : null}
    </section>
  );
}
