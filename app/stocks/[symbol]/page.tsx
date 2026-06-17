"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { formatCurrency, formatCompact, formatMarketCap, formatNumber, formatPercent, formatDate } from "@/lib/format";
import { useStockData, type Market } from "@/lib/hooks/use-stock-data";
import { Sparkline } from "@/app/research/_components/sparkline";
import { ScoreCard } from "@/app/research/_components/score-card";
import { RiskHeatmap } from "@/app/research/_components/risk-heatmap";
import { AnalystCard } from "@/app/research/_components/analyst-card";
import { InsiderTable } from "@/app/research/_components/insider-table";
import { MarginTrendChart, PeerRadarChart, RevenueFcfChart } from "@/app/research/_components/charts";
import { AiDeepPanel } from "@/app/research/_components/ai-deep-panel";
import { MetricsGrid } from "@/app/research/india/_components/metrics-grid";
import { PeersTable } from "@/app/research/india/_components/peers-table";
import { ShareholdingChart } from "@/app/research/india/_components/shareholding-chart";
import { AiIndiaPanel } from "@/app/research/india/_components/ai-india-panel";

type Tab = "overview" | "financials" | "ai" | "deep";

const US_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "financials", label: "Financials & Scoring" },
  { id: "ai", label: "AI Research" },
  { id: "deep", label: "Deep Research" },
];

const IN_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Key Metrics" },
  { id: "financials", label: "Peer Comparison" },
  { id: "ai", label: "AI Research" },
  { id: "deep", label: "10-Year Ratios" },
];

function StockContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const rawSymbol = decodeURIComponent(params.symbol as string).toUpperCase();
  const explicitMarket = searchParams.get("market") as Market | null;

  const { symbol, market, state, error, quoteData, fundamentals, peers, fundamentalsLoading, indiaData, load } =
    useStockData();

  const [tab, setTab] = useState<Tab>("overview");
  const [watchlistSaved, setWatchlistSaved] = useState(false);

  useEffect(() => {
    if (rawSymbol) load(rawSymbol, explicitMarket ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSymbol, explicitMarket]);

  const tabs = market === "IN" ? IN_TABS : US_TABS;

  async function addToWatchlist() {
    if (!quoteData) return;
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: quoteData.quote.symbol, name: quoteData.quote.name }),
      });
      setWatchlistSaved(true);
    } catch { /* non-critical */ }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-muted">
        <Link href="/" className="hover:text-foreground">Home</Link>
        <span>/</span>
        <Link href="/research" className="hover:text-foreground">Research</Link>
        <span>/</span>
        <span className="font-mono text-foreground">{rawSymbol}</span>
        <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
          {market === "IN" ? "NSE/BSE" : "US"}
        </span>
      </nav>

      {/* Loading state */}
      {state === "loading" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
            </span>
            Loading {rawSymbol}…
          </div>
          <div className="h-32 animate-pulse rounded-xl border border-border bg-surface" />
        </div>
      ) : null}

      {/* Error state */}
      {state === "error" ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
            {error}
          </div>
          <Link href="/research" className="self-start text-sm text-accent hover:underline">
            ← Back to Research
          </Link>
        </div>
      ) : null}

      {/* US Stock View */}
      {state === "ready" && market === "US" && quoteData ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-border bg-surface p-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-semibold">{quoteData.quote.symbol}</span>
                <span className="text-muted">{quoteData.quote.name}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-3xl font-semibold">
                  {formatCurrency(quoteData.quote.price, quoteData.quote.currency)}
                </span>
                <span className={quoteData.quote.changePercent >= 0 ? "text-positive" : "text-negative"}>
                  {formatCurrency(quoteData.quote.change, quoteData.quote.currency)}{" "}
                  ({formatPercent(quoteData.quote.changePercent)})
                </span>
              </div>
            </div>
            <button
              onClick={addToWatchlist}
              disabled={watchlistSaved}
              className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              {watchlistSaved ? "★ Saved" : "☆ Watchlist"}
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
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

          {/* Overview tab */}
          {tab === "overview" ? (
            <div className="flex flex-col gap-6">
              <Sparkline data={quoteData.history} />

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                {[
                  ["Market cap", formatMarketCap(quoteData.quote.marketCap)],
                  ["P/E ratio", quoteData.quote.peRatio != null ? formatNumber(quoteData.quote.peRatio) : "—"],
                  ["Day range", `${formatCurrency(quoteData.quote.dayLow, quoteData.quote.currency)} – ${formatCurrency(quoteData.quote.dayHigh, quoteData.quote.currency)}`],
                  ["52-week range", `${formatCurrency(quoteData.quote.fiftyTwoWeekLow, quoteData.quote.currency)} – ${formatCurrency(quoteData.quote.fiftyTwoWeekHigh, quoteData.quote.currency)}`],
                  ["Volume", quoteData.quote.volume != null ? formatCompact(quoteData.quote.volume) : "—"],
                  ["Exchange", quoteData.quote.exchange ?? "—"],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-1 bg-surface p-4">
                    <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                    <dd className="font-mono text-sm">{value}</dd>
                  </div>
                ))}
              </dl>

              {/* SEC Filings */}
              <section className="flex flex-col gap-3">
                <h2 className="text-base font-semibold">Recent SEC Filings</h2>
                {quoteData.edgarError ? (
                  <p className="text-sm text-muted">EDGAR unavailable: {quoteData.edgarError}</p>
                ) : quoteData.filings.length === 0 ? (
                  <p className="text-sm text-muted">No recent filings found.</p>
                ) : (
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {quoteData.filings.map((f) => (
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
            </div>
          ) : null}

          {/* Financials & Scoring tab */}
          {tab === "financials" ? (
            <div className="flex flex-col gap-6">
              {fundamentalsLoading ? (
                <p className="text-sm text-muted">Loading institutional analysis…</p>
              ) : fundamentals ? (
                <>
                  <ScoreCard score={fundamentals.score} momentum={fundamentals.momentum} />
                  <div className="grid gap-4 lg:grid-cols-2">
                    {fundamentals.statements ? <MarginTrendChart statements={fundamentals.statements} /> : null}
                    {fundamentals.statements ? <RevenueFcfChart statements={fundamentals.statements} /> : null}
                    {peers && peers.peerCount > 0 ? (
                      <PeerRadarChart peers={peers} symbol={symbol} />
                    ) : (
                      <div className="flex h-[296px] items-center justify-center rounded-xl border border-border bg-surface text-sm text-muted">
                        {peers ? "Peer data unavailable (non-S&P 500)" : "Loading peer comparison…"}
                      </div>
                    )}
                  </div>
                  <RiskHeatmap risks={fundamentals.risks} />
                  <AnalystCard analyst={fundamentals.analyst} />
                  <InsiderTable insider={fundamentals.insider} />
                  {fundamentals.statementsError ? (
                    <p className="text-xs text-muted">
                      Note: SEC statement data unavailable ({fundamentals.statementsError}) — margin/FCF charts limited.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted">Fundamentals unavailable.</p>
              )}
            </div>
          ) : null}

          {/* AI Research tab */}
          {tab === "ai" ? (
            <div className="flex flex-col gap-4">
              {fundamentals && quoteData ? (
                <AiDeepPanel quote={quoteData.quote} fundamentals={fundamentals} peers={peers} />
              ) : fundamentalsLoading ? (
                <p className="text-sm text-muted">Loading data for AI analysis…</p>
              ) : (
                <p className="text-sm text-muted">Fundamentals required for AI analysis.</p>
              )}
            </div>
          ) : null}

          {/* Deep Research tab */}
          {tab === "deep" ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-border bg-surface p-5">
                <h2 className="text-base font-semibold">Investment Committee Report</h2>
                <p className="mt-1 text-sm text-muted">
                  Full IC-grade pipeline — signal detection, 9-agent investigation, thesis formation, and DCF valuation.
                </p>
                <a
                  href={`/ic-report?symbol=${symbol}`}
                  className="mt-4 inline-block rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  Run Deep Research →
                </a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* India Stock View */}
      {state === "ready" && market === "IN" && indiaData ? (
        <div className="flex flex-col gap-6">
          {/* Header */}
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{indiaData.company.symbol}</span>
                  {indiaData.company.bseCode ? (
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-muted">
                      BSE {indiaData.company.bseCode}
                    </span>
                  ) : null}
                </div>
                <span className="text-muted">{indiaData.company.name}</span>
              </div>
              <div className="text-right">
                {indiaData.company.currentPrice != null ? (
                  <div className="text-3xl font-semibold">
                    ₹{indiaData.company.currentPrice.toFixed(2)}
                  </div>
                ) : null}
                {indiaData.company.changePercent != null ? (
                  <div className={`font-mono text-sm ${indiaData.company.changePercent >= 0 ? "text-positive" : "text-negative"}`}>
                    {formatPercent(indiaData.company.changePercent)}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
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

          {/* Key Metrics tab */}
          {tab === "overview" ? (
            <div className="flex flex-col gap-6">
              <MetricsGrid company={indiaData.company} derived={indiaData.derived} />
              {indiaData.company.shareholding.length > 0 ? (
                <section className="flex flex-col gap-3">
                  <h2 className="text-base font-semibold">Shareholding Pattern</h2>
                  <div className="rounded-xl border border-border bg-surface p-5">
                    <ShareholdingChart rows={indiaData.company.shareholding} />
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {/* Peer Comparison tab */}
          {tab === "financials" ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Peer Comparison</h2>
              <p className="text-xs text-muted">
                All figures from screener.in. P/E, ROCE, ROE as trailing twelve months.
              </p>
              <PeersTable peers={indiaData.derived.peers} currentSymbol={symbol} />
            </section>
          ) : null}

          {/* AI Research tab */}
          {tab === "ai" ? (
            <AiIndiaPanel
              company={indiaData.company}
              quote={null}
              derived={indiaData.derived}
            />
          ) : null}

          {/* 10-Year Ratios tab */}
          {tab === "deep" ? (
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-semibold">Historical Ratios</h2>
              <div className="flex flex-col gap-4">
                {indiaData.company.ratios.map((r) => (
                  <div key={r.name} className="rounded-xl border border-border bg-surface p-4">
                    <h3 className="mb-3 text-sm font-medium">{r.name}</h3>
                    <div className="flex flex-wrap gap-3">
                      {r.values.map((v, i) => (
                        <div key={i} className="flex flex-col items-center gap-1">
                          {v.period ? <span className="text-xs text-muted">{v.period}</span> : null}
                          <span className="font-mono text-sm">{v.value || "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {indiaData.company.ratios.length === 0 ? (
                  <p className="text-sm text-muted">No ratio history available.</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}

export default function StockPage() {
  return (
    <Suspense>
      <StockContent />
    </Suspense>
  );
}
