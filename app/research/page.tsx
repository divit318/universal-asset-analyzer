"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResearchData } from "@/lib/types";
import { DownloadIcon } from "./_components/download-icon";
import {
  formatCompact,
  formatCurrency,
  formatDate,
  formatMarketCap,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import { InteractiveChart } from "./_components/interactive-chart";
import { FundamentalsSection } from "./_components/fundamentals-section";
import { SymbolSearch } from "./_components/symbol-search";
import { ResearchCopilot } from "./_components/copilot/research-copilot";
import { ResearchNotes } from "./_components/research-notes";

export default function ResearchPage() {
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
    if (!raw.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    setSaved(false);
    void runResearch(raw);
  }

  // Deep-link support: /research?symbol=AAPL auto-runs on load. This is a
  // deliberate one-time initialization from the URL, so seeding state on mount
  // is exactly what we want here.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    if (!param) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSymbol(param.toUpperCase());
    submit(param);
    /* eslint-enable react-hooks/set-state-in-effect */
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
          Enter any ticker — stocks, ETFs, crypto, or international — for a live quote
          and AI Copilot analysis powered entirely by local Ollama models.
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
  const { quote, history, filings, edgarError, benchmarks } = data;
  const positive = quote.changePercent >= 0;
  const isEquity = !quote.assetType || quote.assetType === "EQUITY";
  const [downloading, setDownloading] = useState(false);

  async function downloadReport() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/report?symbol=${encodeURIComponent(quote.symbol)}`);
      if (!res.ok) throw new Error("Report generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quote.symbol}_Equity_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-critical */
    } finally {
      setDownloading(false);
    }
  }

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
        <div className="flex gap-2">
          <button
            onClick={downloadReport}
            disabled={downloading}
            title="Download PDF Research Report"
            className="flex items-center gap-2 rounded-lg border border-accent/50 bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            <DownloadIcon />
            {downloading ? "Generating…" : "Excel Report"}
          </button>
          <button
            onClick={onSave}
            disabled={saved}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            {saved ? "★ Saved" : "☆ Watchlist"}
          </button>
        </div>
      </div>

      <InteractiveChart
        symbol={quote.symbol}
        history={history}
        benchmarks={benchmarks ?? { spy: [], sectorEtf: null, sector: [] }}
      />

      {/* Stats */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {stats.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 bg-surface p-4">
            <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
            <dd className="font-mono text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      <ResearchCopilot symbol={quote.symbol} name={quote.name} isEquity={isEquity} />

      {/* SEC Filings — equities only */}
      {isEquity ? (
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
      ) : null}

      <ResearchNotes symbol={quote.symbol} />

      {/* Fundamentals — equities only */}
      {isEquity ? <FundamentalsSection symbol={quote.symbol} /> : (
        <div className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted">
          Detailed fundamentals and SEC filings are available for US-listed equities.
          {quote.assetType === "CRYPTOCURRENCY" ? " Crypto analysis is available via the AI Copilot above." : ""}
        </div>
      )}
    </div>
  );
}
