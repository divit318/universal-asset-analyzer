"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Quote, WatchlistItem } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only after the first await, so this is safe to call from an effect.
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

  function refresh() {
    setLoading(true);
    void load();
  }

  // Load the saved watchlist + live quotes once on mount. Fetching state on
  // mount is the intended behavior here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function remove(symbol: string) {
    setItems((prev) => prev.filter((i) => i.symbol !== symbol));
    await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    });
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="text-muted">Saved symbols with live prices.</p>
        </div>
        <button
          onClick={refresh}
          className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
        >
          ↻ Refresh
        </button>
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
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((item) => {
            const q = quotes[item.symbol];
            const positive = q ? q.changePercent >= 0 : true;
            return (
              <li
                key={item.symbol}
                className="flex items-center justify-between gap-4 bg-surface px-4 py-3"
              >
                <Link
                  href={`/research?symbol=${item.symbol}`}
                  className="min-w-0 flex-1"
                >
                  <span className="font-mono text-sm font-semibold text-accent">
                    {item.symbol}
                  </span>
                  <p className="truncate text-sm text-muted">{item.name}</p>
                </Link>
                <div className="shrink-0 text-right">
                  {q ? (
                    <>
                      <div className="font-mono text-sm">
                        {formatCurrency(q.price, q.currency)}
                      </div>
                      <div
                        className={`text-xs ${positive ? "text-positive" : "text-negative"}`}
                      >
                        {formatPercent(q.changePercent)}
                      </div>
                    </>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </div>
                <button
                  onClick={() => void remove(item.symbol)}
                  className="shrink-0 rounded-md px-2 py-1 text-muted transition-colors hover:bg-negative/10 hover:text-negative"
                  aria-label={`Remove ${item.symbol}`}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
