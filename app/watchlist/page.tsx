"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { downloadBlob } from "@/lib/download";
import type { Quote, WatchlistItem } from "@/lib/types";
import type { WatchlistDigest } from "@/lib/ai-watchlist";
import type { PortfolioFitAnalysis } from "@/lib/ios/types";
import type { FitEnrichment } from "@/lib/watchlist-fit";
import { formatCurrency, formatDate, formatPercent } from "@/lib/format";
import { Dialog, ConfirmDialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { useIOSSafe } from "@/lib/ios-context";
import { PortfolioFitBadge } from "@/app/_components/portfolio-fit-badge";
import { WatchlistAlerts } from "./_components/watchlist-alerts";
import { AddToPortfolioModal } from "@/app/_components/portfolio/add-to-portfolio-modal";
import { ArrivalHighlight, useArrivalTarget } from "@/app/_components/arrival-highlight";
import { PageShell, Skeleton } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/reveal";
import { LoadingMark } from "@/app/_components/loading-mark";

function WatchlistDigestPanel({
  digest,
  loading,
  error,
  onGenerate,
}: {
  digest: WatchlistDigest | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-5">
        <div className="flex items-center gap-3 mb-3">
          <LoadingMark size={18} label="AI is analyzing your watchlist" />
          <p className="text-sm font-medium text-foreground/90">AI is analyzing your watchlist…</p>
        </div>
        <div className="space-y-2">
          {[90, 75, 60].map((w) => (
            <Skeleton key={w} height="h-3" width="" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (!digest) {
    return (
      <div className="rounded-xl border border-brand/20 bg-brand/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-label font-semibold uppercase tracking-widest text-brand/70">AI Watchlist Intelligence</p>
            <p className="max-w-md text-sm leading-6 text-foreground/80">
              {error ?? "Get an AI-generated summary, top picks, concerns, and action items across everything you're watching — runs fully offline via Ollama, takes about 20–30s."}
            </p>
          </div>
          <button
            onClick={onGenerate}
            className="shrink-0 rounded-lg bg-brand-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            {error ? "Retry" : "Generate insights"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-label font-semibold uppercase tracking-widest text-brand/70">AI Watchlist Intelligence</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onGenerate}
            title="Regenerate — reflects the current watchlist"
            className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand transition-opacity hover:opacity-80"
          >
            ↻ Regenerate
          </button>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-label font-semibold uppercase tracking-widest text-brand">
            Local AI
          </span>
        </div>
      </div>
      <p className="text-sm leading-6 text-foreground/90 mb-4">{digest.summary}</p>
      {(digest.topPicks.length > 0 || digest.topConcerns.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 mb-4">
          {digest.topPicks.length > 0 && (
            <div>
              <p className="mb-2 text-label font-semibold uppercase tracking-widest text-positive/80">Top picks</p>
              <ul className="space-y-1">
                {digest.topPicks.map((p, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-positive/60" />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {digest.topConcerns.length > 0 && (
            <div>
              <p className="mb-2 text-label font-semibold uppercase tracking-widest text-negative/80">Concerns</p>
              <ul className="space-y-1">
                {digest.topConcerns.map((c, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-negative/60" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {digest.actionItems.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-label font-semibold uppercase tracking-widest text-muted">Action items</p>
          <ul className="space-y-1">
            {digest.actionItems.map((a, i) => (
              <li key={i} className="flex gap-2 text-xs leading-5 text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}
function formatDaysAgo(iso: string): string {
  const d = daysAgo(iso);
  if (d === 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

interface Alert { type: "target_reached" | "significant_drop"; message: string; }

function checkAlerts(item: WatchlistItem, quote: Quote | undefined): Alert[] {
  if (!quote) return [];
  const alerts: Alert[] = [];
  if (item.targetPrice != null && quote.price >= item.targetPrice)
    alerts.push({ type: "target_reached", message: `Hit target ${formatCurrency(item.targetPrice)} — now at ${formatCurrency(quote.price)}` });
  if (item.alertPctDrop != null && quote.changePercent <= -item.alertPctDrop)
    alerts.push({ type: "significant_drop", message: `Down ${formatPercent(Math.abs(quote.changePercent))} today (alert: −${item.alertPctDrop}%)` });
  return alerts;
}

function AlertModal({ item, onSave, onCancel }: {
  item: WatchlistItem;
  onSave: (patch: { targetPrice: number | null; alertPctDrop: number | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [targetPrice, setTargetPrice] = useState(item.targetPrice != null ? String(item.targetPrice) : "");
  const [alertPctDrop, setAlertPctDrop] = useState(item.alertPctDrop != null ? String(item.alertPctDrop) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        targetPrice: targetPrice ? parseFloat(targetPrice) : null,
        alertPctDrop: alertPctDrop ? parseFloat(alertPctDrop) : null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save alerts");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open title={`${item.symbol} — Price Alerts`} onClose={onCancel} className="max-w-md">
      <p className="mb-4 text-xs text-muted">
        Alerts are checked each time you open the watchlist.
      </p>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        {error && <p className="text-xs text-negative">{error}</p>}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Price target</span>
          <span className="text-xs text-muted/70">Alert when price reaches or exceeds this level</span>
          <input
            type="number" step="any" min="0" value={targetPrice}
            onChange={(e) => setTargetPrice(e.target.value)}
            placeholder="e.g. 200.00"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Intraday drop alert</span>
          <span className="text-xs text-muted/70">
            Fires when today&apos;s session decline exceeds this percentage (checks today&apos;s change, not from purchase date)
          </span>
          <div className="relative">
            <input
              type="number" step="0.5" min="0" max="50" value={alertPctDrop}
              onChange={(e) => setAlertPctDrop(e.target.value)}
              placeholder="e.g. 5"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-brand"
            />
            <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted">%</span>
          </div>
        </label>
        <div className="flex gap-2 pt-1">
          <button
            type="submit" disabled={saving}
            className="flex-1 rounded-lg bg-brand-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save alerts"}
          </button>
          <button
            type="button" onClick={onCancel}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function NotesModal({ item, onSave, onCancel }: {
  item: WatchlistItem;
  onSave: (notes: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [notes, setNotes] = useState(item.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave(notes.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open title={`${item.symbol} — Research Notes`} onClose={onCancel} className="max-w-md">
      <p className="mb-4 text-xs text-muted">Your thesis, price levels to watch, catalyst timeline…</p>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        {error && <p className="text-xs text-negative">{error}</p>}
        <textarea
          value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
          placeholder="Why you're watching this, key levels, upcoming catalysts…"
          className="resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
        />
        <div className="flex gap-2 pt-1">
          <button
            type="submit" disabled={saving}
            className="flex-1 rounded-lg bg-brand-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save notes"}
          </button>
          <button
            type="button" onClick={onCancel}
            className="flex-1 rounded-lg border border-border py-2.5 text-sm transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default function WatchlistPage() {
  return (
    <Suspense fallback={null}>
      <WatchlistPageInner />
    </Suspense>
  );
}

function WatchlistPageInner() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [editingAlerts, setEditingAlerts] = useState<WatchlistItem | null>(null);
  const [editingNotes, setEditingNotes] = useState<WatchlistItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WatchlistItem | null>(null);
  const [buyingItem, setBuyingItem] = useState<WatchlistItem | null>(null);
  const [ownedSymbols, setOwnedSymbols] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [digest, setDigest] = useState<WatchlistDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  // Full research inputs (composite scores, sector, beta, geography) per symbol,
  // fetched on demand so every watchlist stock — including newly-added ones —
  // gets an accurate, differentiated fit score instead of a data-poor neutral.
  const [fitData, setFitData] = useState<Map<string, FitEnrichment>>(new Map());
  const toast = useToast();
  // IOS — declared early so the digest effect can access portfolio context
  const ios = useIOSSafe();
  const highlightTarget = useArrivalTarget();

  useEffect(() => {
    document.title = "Watchlist · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  const loadOwned = useCallback(async () => {
    try {
      const res = await fetch("/api/portfolio");
      const json = await res.json();
      if (!res.ok) return;
      const holdings = (json.holdings ?? []) as { symbol: string | null }[];
      setOwnedSymbols(new Set(holdings.filter((h) => h.symbol).map((h) => h.symbol!.toUpperCase())));
    } catch {
      /* owned-status is an enhancement — degrade gracefully */
    }
  }, []);

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
      void loadOwned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [loadOwned]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // AI watchlist digest is opt-in — the user triggers it explicitly (button in
  // WatchlistDigestPanel's idle state) rather than it auto-firing on every
  // load, and the same control re-runs it on demand afterward ("Regenerate"),
  // since the digest otherwise has no way to reflect symbols added/removed
  // since it was generated. Passes portfolio context so the digest can warn
  // about actual holdings concentration.
  async function runDigest() {
    if (digestLoading) return;
    setDigestLoading(true);
    setDigestError(null);
    const portfolioContext = ios?.profile.hasPortfolio
      ? {
          objective: ios.profile.objective,
          holdingSymbols: ios.profile.holdingSymbols,
          sectorWeights: ios.profile.sectorWeights,
          missingSectors: ios.profile.missingSectors,
          overweightSectors: ios.profile.overweightSectors,
        }
      : undefined;
    try {
      const r = await fetch("/api/ai/watchlist", {
        method: "POST",
        headers: portfolioContext ? { "Content-Type": "application/json" } : {},
        body: portfolioContext ? JSON.stringify({ portfolioContext }) : undefined,
      });
      const json = await r.json() as WatchlistDigest & { error?: string };
      if (!r.ok || json.error) throw new Error(json.error ?? "AI digest unavailable");
      setDigest(json);
    } catch (err) {
      setDigestError(err instanceof Error ? err.message : "AI digest unavailable — check that Ollama is running.");
    } finally {
      setDigestLoading(false);
    }
  }

  async function remove(symbol: string) {
    setItems((prev) => prev.filter((i) => i.symbol !== symbol));
    await fetch(`/api/watchlist?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    toast(`${symbol} removed from watchlist`, "info");
  }

  async function patchItem(symbol: string, patch: { targetPrice?: number | null; alertPctDrop?: number | null; notes?: string | null }) {
    const res = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, ...patch }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error ?? "Failed to save");
    }
    setItems((prev) => prev.map((i) => i.symbol === symbol ? { ...i, ...patch } : i));
  }

  // IOS — portfolio fit per watchlist item
  const [fitSort, setFitSort] = useState(false);

  // Fetch full research inputs for every symbol. Keyed on the symbol set so
  // adding/removing a stock re-enriches (server-side cache makes repeats cheap).
  const symbolsKey = items.map((i) => i.symbol).join(",");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing cached fit data when the list empties, not derivable at render time since fitData persists across item removal
    if (items.length === 0) { setFitData(new Map()); return; }
    let cancelled = false;
    fetch("/api/watchlist/fit")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { items?: FitEnrichment[] } | null) => {
        if (cancelled || !json?.items) return;
        const map = new Map<string, FitEnrichment>();
        for (const e of json.items) map.set(e.symbol.toUpperCase(), e);
        setFitData(map);
      })
      .catch(() => { /* fit inputs are an enhancement — degrade gracefully */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  const quoteKeys = Object.keys(quotes).join(",");
  const fitDataKey = [...fitData.keys()].join(",");
  const fitScores = useMemo(() => {
    if (!ios?.profileReady) return new Map<string, PortfolioFitAnalysis>();
    const map = new Map<string, PortfolioFitAnalysis>();
    for (const item of items) {
      const q = quotes[item.symbol];
      const enr = fitData.get(item.symbol.toUpperCase());
      // Compute ONCE and reuse for both score and tier — computing the tier
      // from a second call with different inputs was producing score/tier
      // mismatches at band boundaries.
      const fit = ios.getPortfolioFit({
        symbol: item.symbol,
        sector: enr?.sector ?? item.sector ?? null,
        marketCap: enr?.marketCap ?? q?.marketCap ?? null,
        compositeScores: enr?.compositeScores ?? null,
        dividendYield: enr?.dividendYield ?? item.dividendYield ?? null,
        beta: enr?.beta ?? null,
        geography: enr?.geography ?? null,
        isOnWatchlist: true,
      });
      map.set(item.symbol, fit);
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ios?.profile.builtAt, ios?.profileReady, items.length, quoteKeys, fitDataKey]);

  const filteredItems = [...items]
    .filter((i) =>
      !filter ||
      i.symbol.toLowerCase().includes(filter.toLowerCase()) ||
      i.name.toLowerCase().includes(filter.toLowerCase()),
    )
    .sort((a, b) => {
      // When fit sort is active, rank by fit score first
      if (fitSort && fitScores.size > 0) {
        const af = fitScores.get(a.symbol)?.fitScore ?? 0;
        const bf = fitScores.get(b.symbol)?.fitScore ?? 0;
        if (bf !== af) return bf - af;
      }
      const aAlerts = checkAlerts(a, quotes[a.symbol]).length;
      const bAlerts = checkAlerts(b, quotes[b.symbol]).length;
      if (bAlerts !== aAlerts) return bAlerts - aAlerts;
      return Date.parse(b.addedAt) - Date.parse(a.addedAt);
    });

  const alertCount = items.reduce((n, item) => n + checkAlerts(item, quotes[item.symbol]).length, 0);

  // Scoped to current `items`, not all of `quotes` — removing a symbol doesn't
  // prune its stale quote from state, so counting every cached quote would
  // keep a removed stock's gain/loss in the summary strip until next reload.
  const trackedQuotes = items.map((i) => quotes[i.symbol]).filter((q): q is Quote => q != null);
  const gainers = trackedQuotes.filter((q) => q.changePercent > 0).length;
  const losers  = trackedQuotes.filter((q) => q.changePercent < 0).length;
  const hasQuotes = trackedQuotes.length > 0;

  return (
    <PageShell py="py-10">
      <ArrivalHighlight targetId={highlightTarget} />
      <Reveal index={0} className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
            {alertCount > 0 && (
              <span className="animate-pulse rounded-full border border-negative/30 bg-negative/15 px-2.5 py-0.5 text-xs font-semibold text-negative">
                {alertCount} alert{alertCount > 1 ? "s" : ""} firing
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Live prices, price targets, and research notes. Alerts check on page load.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Link
            href="/"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            The Desk
          </Link>
          <Link
            href="/knowledge-graph?scope=watchlist&id=watchlist"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Graph
          </Link>
          <button
            onClick={() => { setLoading(true); void load(); }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => {
              setExportErr(null);
              void downloadBlob("/api/export/watchlist", `watchlist-${new Date().toISOString().slice(0, 10)}.csv`)
                .catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
            }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↓ Export
          </button>
        </div>
      </Reveal>

      {/* Summary strip */}
      {!loading && items.length > 0 && hasQuotes && (
        <Reveal index={1} className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface px-5 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Watching</span>
            <span className="font-mono text-sm font-semibold">{items.length}</span>
          </div>
          <span className="h-8 w-px bg-border" />
          <div className="flex flex-col gap-0.5">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Today</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-positive">↑ {gainers}</span>
              <span className="text-xs text-negative">↓ {losers}</span>
            </div>
          </div>
          {alertCount > 0 && (
            <>
              <span className="h-8 w-px bg-border" />
              <div className="flex flex-col gap-0.5">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/60">Alerts</span>
                <span className="text-xs font-semibold text-negative">{alertCount} firing</span>
              </div>
            </>
          )}
        </Reveal>
      )}

      {/* AI Watchlist Intelligence — opt-in; user triggers generation and can regenerate on demand */}
      {!loading && items.length > 0 && (
        <Reveal index={2}>
          <WatchlistDigestPanel
            digest={digest}
            loading={digestLoading}
            error={digestError}
            onGenerate={() => void runDigest()}
          />
        </Reveal>
      )}

      {/* Structured, deterministic per-asset alerts — new opportunities, deterioration, breakouts, sector leadership, valuation */}
      {!loading && digest && digest.alerts.length > 0 && (
        <Reveal index={3}>
          <WatchlistAlerts alerts={digest.alerts} />
        </Reveal>
      )}

      {exportErr && <p className="text-xs text-negative">{exportErr}</p>}

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {!loading && items.length > 4 && (
        <div className="flex gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by ticker or name…"
            className="flex-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-brand"
          />
          {ios?.profileReady && ios.profile.hasPortfolio && (
            <div
              role="group"
              aria-label="Sort watchlist"
              className="flex items-center gap-1 rounded-lg border border-border bg-surface p-0.5 text-xs font-medium"
            >
              <span className="pl-2 pr-1 text-muted select-none">Sort</span>
              <button
                type="button"
                onClick={() => setFitSort(false)}
                aria-pressed={!fitSort}
                title="Order by active alerts first, then most recently added"
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  !fitSort ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"
                }`}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setFitSort(true)}
                aria-pressed={fitSort}
                title="Order by Portfolio Fit score, best fit first"
                className={`flex items-center gap-1 rounded-md px-3 py-1.5 transition-colors ${
                  fitSort ? "bg-brand/10 text-brand" : "text-muted hover:text-brand"
                }`}
              >
                ✦ Portfolio Fit
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <Skeleton key={n} height="h-24" radius="rounded-xl" className="border border-border" />
          ))}
        </div>
      ) : filteredItems.length === 0 && items.length === 0 ? (
        <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3a2 2 0 012-2h6a2 2 0 012 2v14l-5-3-5 3V3z" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">Your watchlist is empty</p>
            <p className="max-w-xs text-xs leading-5 text-muted">
              Add symbols from Research or Screener. Set price targets, drop alerts, and thesis notes per position.
            </p>
          </div>
          <div className="flex gap-3">
            <Link href="/research" className="rounded-lg bg-brand-strong px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90">
              Research a stock →
            </Link>
            <Link href="/screener" className="rounded-lg border border-border px-5 py-2 text-sm transition-colors hover:bg-surface-2">
              Browse Screener
            </Link>
          </div>
        </div>
      ) : filteredItems.length === 0 ? (
        <p className="text-sm text-muted">No items match &ldquo;{filter}&rdquo;</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
          {filteredItems.map((item) => {
            const q = quotes[item.symbol];
            const positive = q ? q.changePercent >= 0 : true;
            const alerts = checkAlerts(item, q);
            const hasAlert = alerts.length > 0;

            return (
              <li
                key={item.symbol}
                data-arrival-target={item.symbol}
                className={`flex flex-col bg-surface transition-colors ${hasAlert ? "border-l-4 border-l-negative" : ""}`}
              >
                {/* Alert banners */}
                {alerts.map((a) => (
                  <div
                    key={a.type}
                    className="flex items-center gap-2 border-b border-negative/20 bg-negative/8 px-4 py-1.5"
                  >
                    <span className="text-xs font-semibold text-negative">Alert:</span>
                    <span className="text-xs text-negative">{a.message}</span>
                  </div>
                ))}

                <div className="flex items-start justify-between gap-4 px-4 py-4">
                  {/* Symbol + meta */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/research?symbol=${item.symbol}`}
                        className="font-mono text-sm font-semibold text-brand hover:underline"
                      >
                        {item.symbol}
                      </Link>
                      {ios?.profileReady && ios.profile.hasPortfolio && fitScores.has(item.symbol) && (() => {
                        const fit = fitScores.get(item.symbol)!;
                        return <PortfolioFitBadge score={fit.fitScore} tier={fit.fitTier} showScore={true} />;
                      })()}
                      {hasAlert && (
                        <span className="rounded-full bg-negative/15 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-negative">
                          Alert
                        </span>
                      )}
                      {ownedSymbols.has(item.symbol) && (
                        <span className="rounded-full border border-positive/30 bg-positive/10 px-1.5 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide text-positive">
                          ✓ Owned
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted">{item.name}</p>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span title={formatDate(item.addedAt)}>Added {formatDaysAgo(item.addedAt)}</span>
                      {item.targetPrice != null ? (
                        <span className="rounded-full border border-brand/30 bg-brand/5 px-1.5 py-0.5 text-brand">
                          Target {formatCurrency(item.targetPrice)}
                        </span>
                      ) : null}
                      {item.alertPctDrop != null ? (
                        <span
                          className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5"
                          title="Fires when today's session decline exceeds this percentage"
                        >
                          Drop alert −{item.alertPctDrop}%
                        </span>
                      ) : null}
                    </div>

                    {item.notes ? (
                      <p className="mt-1.5 line-clamp-2 text-xs italic text-muted/80" title={item.notes}>
                        &ldquo;{item.notes}&rdquo;
                      </p>
                    ) : null}

                    {/* Cross-page quick links — visible size */}
                    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <Link
                        href={`/valuation?symbol=${item.symbol}`}
                        className="text-muted underline-offset-2 hover:text-brand hover:underline"
                      >
                        DCF ↗
                      </Link>
                      <Link
                        href={`/ic-report?symbol=${item.symbol}`}
                        className="text-muted underline-offset-2 hover:text-brand hover:underline"
                      >
                        IC Report ↗
                      </Link>
                      <Link
                        href={`/compare?symbols=${item.symbol}`}
                        className="text-muted underline-offset-2 hover:text-brand hover:underline"
                      >
                        Compare ↗
                      </Link>
                      <Link
                        href={`/stocks/${item.symbol}`}
                        className="text-muted underline-offset-2 hover:text-brand hover:underline"
                      >
                        Deep view ↗
                      </Link>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="shrink-0 text-right">
                    {q ? (
                      <>
                        <div className="font-mono text-sm font-medium">{formatCurrency(q.price, q.currency)}</div>
                        <div className={`text-xs ${positive ? "text-positive" : "text-negative"}`}>
                          {formatPercent(q.changePercent)} today
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <button
                      onClick={() => setBuyingItem(item)}
                      disabled={!q}
                      title={!q ? "Waiting for a live price" : `Buy ${item.symbol}`}
                      className="rounded-md bg-brand-strong px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => setEditingAlerts(item)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand"
                    >
                      Set alerts
                    </button>
                    <button
                      onClick={() => setEditingNotes(item)}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-brand hover:text-brand"
                    >
                      Notes
                    </button>
                    <button
                      onClick={() => setConfirmDelete(item)}
                      className="rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:bg-negative/10 hover:text-negative"
                      aria-label={`Remove ${item.symbol} from watchlist`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editingAlerts ? (
        <AlertModal
          item={editingAlerts}
          onSave={async (patch) => {
            await patchItem(editingAlerts.symbol, patch);
            setEditingAlerts(null);
            toast("Alerts updated");
          }}
          onCancel={() => setEditingAlerts(null)}
        />
      ) : null}

      {editingNotes ? (
        <NotesModal
          item={editingNotes}
          onSave={async (notes) => {
            await patchItem(editingNotes.symbol, { notes });
            setEditingNotes(null);
            toast("Notes saved");
          }}
          onCancel={() => setEditingNotes(null)}
        />
      ) : null}

      {buyingItem ? (
        <AddToPortfolioModal
          item={buyingItem}
          fit={fitScores.get(buyingItem.symbol)}
          onClose={() => setBuyingItem(null)}
          onSuccess={(result) => {
            setOwnedSymbols((prev) => new Set(prev).add(result.symbol));
            toast(`Bought ${result.symbol} — added to Portfolio`, "success");
            void loadOwned();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete.symbol); }}
        title="Remove from watchlist"
        message={`Remove ${confirmDelete?.symbol} from your watchlist? This will also delete any alerts and notes you've set for it.`}
        confirmLabel="Remove"
        danger
      />
    </PageShell>
  );
}
