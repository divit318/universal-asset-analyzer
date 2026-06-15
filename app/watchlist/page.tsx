"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Quote, WatchlistItem } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

interface WatchlistStockSummary {
  symbol: string;
  name: string;
  quote: Quote | null;
  fundamentalScore: number | null;
  recommendation: string | null;
  topRisk: string | null;
  analystUpside: number | null;
}

interface WatchlistDigest {
  model: string;
  summary: string;
  actionItems: string[];
  concentrationRisks: string[];
  topPicks: string[];
  topConcerns: string[];
  stockSummaries: WatchlistStockSummary[];
  generatedAt: string;
}

const REC_COLOR: Record<string, string> = {
  STRONG_BUY: "text-positive",
  BUY: "text-positive",
  HOLD: "text-amber-400",
  SELL: "text-negative",
  STRONG_SELL: "text-negative",
};

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<WatchlistDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load watchlist");
      const list = json.items as WatchlistItem[];
      setItems(list);
      setError(null);

      if (list.length > 0) {
        const symbols = list.map((i) => i.symbol).join(",");
        const qres = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
        const qjson = await qres.json();
        if (qres.ok) {
          const map: Record<string, Quote> = {};
          for (const q of qjson.quotes as Quote[]) map[q.symbol] = q;
          setQuotes(map);
        }
      } else {
        setQuotes({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(symbol: string) {
    setItems((prev) => prev.filter((i) => i.symbol !== symbol));
    setDigest(null);
    await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
  }

  async function runDigest() {
    setDigestLoading(true);
    setDigestError(null);
    try {
      const res = await fetch("/api/ai/watchlist", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Digest failed");
      setDigest(json as WatchlistDigest);
    } catch (err) {
      setDigestError(err instanceof Error ? err.message : "Digest failed");
    } finally {
      setDigestLoading(false);
    }
  }

  // Merge digest stock summaries with live quotes for the enriched table.
  const digestMap = Object.fromEntries(
    (digest?.stockSummaries ?? []).map((s) => [s.symbol, s]),
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="text-muted">Saved symbols with live prices and AI digest.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => { setLoading(true); void load(); }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
          {items.length > 0 ? (
            <button
              onClick={runDigest}
              disabled={digestLoading}
              className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {digestLoading ? "Analyzing…" : "AI Digest"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-muted">Your watchlist is empty.</p>
          <Link href="/research" className="mt-2 inline-block text-sm text-accent hover:underline">
            Find symbols in Research →
          </Link>
        </div>
      ) : (
        <>
          {/* Stock list — enriched when digest has run */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Change</th>
                  {digest ? (
                    <>
                      <th className="px-4 py-3 text-right font-medium">Score</th>
                      <th className="px-4 py-3 font-medium">Signal</th>
                      <th className="px-4 py-3 font-medium">Top Risk</th>
                      <th className="px-4 py-3 text-right font-medium">Upside</th>
                    </>
                  ) : null}
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => {
                  const q = quotes[item.symbol];
                  const ds = digestMap[item.symbol];
                  const positive = q ? q.changePercent >= 0 : true;
                  return (
                    <tr key={item.symbol} className="bg-surface hover:bg-surface-2">
                      <td className="px-4 py-3">
                        <Link
                          href={`/research?symbol=${item.symbol}`}
                          className="font-mono font-semibold text-accent hover:underline"
                        >
                          {item.symbol}
                        </Link>
                        <div className="truncate text-xs text-muted">{item.name}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {q ? formatCurrency(q.price, q.currency) : "—"}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${positive ? "text-positive" : "text-negative"}`}>
                        {q ? formatPercent(q.changePercent) : "—"}
                      </td>
                      {digest ? (
                        <>
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {ds?.fundamentalScore != null ? (
                              <span className={ds.fundamentalScore >= 60 ? "text-positive" : ds.fundamentalScore >= 42 ? "text-amber-400" : "text-negative"}>
                                {ds.fundamentalScore}
                              </span>
                            ) : "—"}
                          </td>
                          <td className={`px-4 py-3 text-xs font-medium ${REC_COLOR[ds?.recommendation ?? ""] ?? "text-muted"}`}>
                            {ds?.recommendation?.replace("_", " ") ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">
                            {ds?.topRisk ?? "—"}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${(ds?.analystUpside ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
                            {ds?.analystUpside != null
                              ? `${ds.analystUpside >= 0 ? "+" : ""}${ds.analystUpside.toFixed(0)}%`
                              : "—"}
                          </td>
                        </>
                      ) : null}
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <Link
                            href={`/compare?a=${item.symbol}&b=`}
                            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2"
                          >
                            Compare
                          </Link>
                          <button
                            onClick={() => void remove(item.symbol)}
                            className="rounded-md px-2 py-1 text-xs text-muted hover:bg-negative/10 hover:text-negative"
                          >
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Digest loading */}
          {digestLoading ? (
            <div className="flex items-center gap-3 text-sm text-muted">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Fetching fundamentals and scores for {items.length} stocks…
            </div>
          ) : null}

          {digestError ? (
            <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
              {digestError}
            </div>
          ) : null}

          {/* Digest result */}
          {digest && !digestLoading ? (
            <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">AI Portfolio Digest</h2>
                <span className="font-mono text-xs text-muted">model: {digest.model}</span>
              </div>

              <p className="text-sm leading-6 text-foreground">{digest.summary}</p>

              <div className="grid gap-4 sm:grid-cols-2">
                {digest.topPicks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-positive">Top Picks</h3>
                    <ul className="flex flex-col gap-1">
                      {digest.topPicks.map((p, i) => (
                        <li key={i} className="text-sm text-muted">→ {p}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {digest.topConcerns.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-negative">Concerns</h3>
                    <ul className="flex flex-col gap-1">
                      {digest.topConcerns.map((c, i) => (
                        <li key={i} className="text-sm text-muted">⚠ {c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {digest.actionItems.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">Action Items</h3>
                    <ul className="flex flex-col gap-1">
                      {digest.actionItems.map((a, i) => (
                        <li key={i} className="text-sm text-muted">• {a}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {digest.concentrationRisks.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-400">Concentration Risks</h3>
                    <ul className="flex flex-col gap-1">
                      {digest.concentrationRisks.map((r, i) => (
                        <li key={i} className="text-sm text-muted">⚡ {r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {!digest && !digestLoading ? (
            <p className="text-center text-sm text-muted">
              Click <strong className="text-foreground">AI Digest</strong> to get a portfolio-level summary with scores,
              recommendations, and action items for every stock.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
