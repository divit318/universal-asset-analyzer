"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Quote, WatchlistItem } from "@/lib/types";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

function formatDaysAgo(iso: string): string {
  const d = daysAgo(iso);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

interface Alert {
  type: "target_reached" | "significant_drop";
  message: string;
}

function checkAlerts(item: WatchlistItem, quote: Quote | undefined): Alert[] {
  if (!quote) return [];
  const alerts: Alert[] = [];
  if (item.targetPrice != null && quote.price >= item.targetPrice) {
    alerts.push({
      type: "target_reached",
      message: `Hit target ${formatCurrency(item.targetPrice)} — now at ${formatCurrency(quote.price)}`,
    });
  }
  if (item.alertPctDrop != null && quote.changePercent <= -item.alertPctDrop) {
    alerts.push({
      type: "significant_drop",
      message: `Down ${formatPercent(Math.abs(quote.changePercent))} today (alert: −${item.alertPctDrop}%)`,
    });
  }
  return alerts;
}

/* -------------------------------------------------------------------------- */
/* Alert editor modal                                                          */
/* -------------------------------------------------------------------------- */

function AlertModal({
  item,
  onSave,
  onCancel,
}: {
  item: WatchlistItem;
  onSave: (patch: { targetPrice: number | null; alertPctDrop: number | null; notes: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [targetPrice, setTargetPrice] = useState(item.targetPrice != null ? String(item.targetPrice) : "");
  const [alertPctDrop, setAlertPctDrop] = useState(item.alertPctDrop != null ? String(item.alertPctDrop) : "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({
      targetPrice: targetPrice ? parseFloat(targetPrice) : null,
      alertPctDrop: alertPctDrop ? parseFloat(alertPctDrop) : null,
      notes: notes.trim() || null,
    });
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{item.symbol} — Alerts & Notes</h2>
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Price target (alert when reached)</span>
            <input
              type="number"
              step="any"
              min="0"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
              placeholder="e.g. 200.00"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Drop alert (% daily decline to flag)</span>
            <input
              type="number"
              step="0.5"
              min="0"
              max="50"
              value={alertPctDrop}
              onChange={(e) => setAlertPctDrop(e.target.value)}
              placeholder="e.g. 5"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Notes (why you're watching this)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Your thesis, price levels to watch, catalyst…"
              className="resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-accent-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-lg border border-border py-2.5 text-sm transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main page                                                                   */
/* -------------------------------------------------------------------------- */

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<WatchlistItem | null>(null);

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
    await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
  }

  async function saveAlerts(
    symbol: string,
    patch: { targetPrice: number | null; alertPctDrop: number | null; notes: string | null },
  ) {
    await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, ...patch }),
    });
    setItems((prev) => prev.map((i) => i.symbol === symbol ? { ...i, ...patch } : i));
    setEditing(null);
  }

  // Count how many items have active alerts firing right now
  const alertCount = items.reduce((n, item) => n + checkAlerts(item, quotes[item.symbol]).length, 0);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
            {alertCount > 0 ? (
              <span className="rounded-full bg-negative/15 px-2.5 py-0.5 text-xs font-semibold text-negative">
                {alertCount} alert{alertCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
          <p className="text-muted">Live prices, price alerts, and your research notes.</p>
        </div>
        <button
          onClick={() => { setLoading(true); void load(); }}
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
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((item) => {
            const q = quotes[item.symbol];
            const positive = q ? q.changePercent >= 0 : true;
            const alerts = checkAlerts(item, q);
            const days = daysAgo(item.addedAt);

            return (
              <li key={item.symbol} className="flex flex-col gap-0 bg-surface">
                {/* Alert banners */}
                {alerts.map((a) => (
                  <div key={a.type} className="flex items-center gap-2 border-b border-negative/20 bg-negative/8 px-4 py-1.5">
                    <span className="text-xs font-semibold text-negative">⚠ Alert:</span>
                    <span className="text-xs text-negative">{a.message}</span>
                  </div>
                ))}

                <div className="flex items-start justify-between gap-4 px-4 py-3">
                  {/* Symbol + name + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <Link
                      href={`/research?symbol=${item.symbol}`}
                      className="font-mono text-sm font-semibold text-accent hover:underline"
                    >
                      {item.symbol}
                    </Link>
                    <p className="truncate text-sm text-muted">{item.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span>Watched {formatDaysAgo(item.addedAt)}</span>
                      {item.targetPrice != null ? (
                        <span className="rounded-full border border-accent/30 bg-accent/5 px-1.5 py-0.5 text-accent">
                          Target {formatCurrency(item.targetPrice)}
                        </span>
                      ) : null}
                      {item.alertPctDrop != null ? (
                        <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5">
                          Drop alert −{item.alertPctDrop}%
                        </span>
                      ) : null}
                    </div>
                    {item.notes ? (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted/80 italic">{item.notes}</p>
                    ) : null}
                  </div>

                  {/* Price */}
                  <div className="shrink-0 text-right">
                    {q ? (
                      <>
                        <div className="font-mono text-sm">{formatCurrency(q.price, q.currency)}</div>
                        <div className={`text-xs ${positive ? "text-positive" : "text-negative"}`}>
                          {formatPercent(q.changePercent)}
                        </div>
                        {q.volume != null ? (
                          <div className="mt-0.5 text-[0.65rem] text-muted">
                            Vol {(q.volume / 1_000_000).toFixed(1)}M
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      onClick={() => setEditing(item)}
                      title="Set price alerts and notes"
                      className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-accent"
                    >
                      ⚙ Alerts
                    </button>
                    <button
                      onClick={() => void remove(item.symbol)}
                      className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      aria-label={`Remove ${item.symbol}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                {/* Added date footer */}
                <div className="border-t border-border/50 px-4 py-1 text-[0.65rem] text-muted/60">
                  Added {formatDate(item.addedAt)}
                  {days > 7 ? ` · ${days} days on watchlist` : ""}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <AlertModal
          item={editing}
          onSave={(patch) => saveAlerts(editing.symbol, patch)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </main>
  );
}
