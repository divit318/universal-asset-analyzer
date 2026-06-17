"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { PortfolioPosition, Quote } from "@/lib/types";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

interface PositionWithQuote extends PortfolioPosition {
  quote: Quote | null;
}

function costBasis(p: PortfolioPosition) {
  return p.shares * p.avgCost;
}

function currentValue(p: PositionWithQuote) {
  if (!p.quote) return null;
  return p.shares * p.quote.price;
}

function unrealizedPL(p: PositionWithQuote) {
  const cv = currentValue(p);
  if (cv == null) return null;
  return cv - costBasis(p);
}

function unrealizedPct(p: PositionWithQuote) {
  const pl = unrealizedPL(p);
  const cb = costBasis(p);
  if (pl == null || cb === 0) return null;
  return (pl / cb) * 100;
}

export default function PortfolioPage() {
  const [positions, setPositions] = useState<PositionWithQuote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<PortfolioPosition | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load portfolio");
      const list = json.positions as PortfolioPosition[];

      const quoteMap: Record<string, Quote> = {};
      if (list.length > 0) {
        const symbols = list.map((p) => p.symbol).join(",");
        const qres = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
        const qjson = await qres.json();
        if (qres.ok) {
          for (const q of qjson.quotes as Quote[]) quoteMap[q.symbol] = q;
        }
      }

      setPositions(list.map((p) => ({ ...p, quote: quoteMap[p.symbol] ?? null })));
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
    setPositions((prev) => prev.filter((p) => p.symbol !== symbol));
    await fetch(`/api/portfolio?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
  }

  function openAdd() {
    setEditTarget(null);
    setShowForm(true);
  }

  function openEdit(p: PortfolioPosition) {
    setEditTarget(p);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditTarget(null);
  }

  async function onSaved() {
    closeForm();
    await load();
  }

  // --- summary stats ---
  const totalCost = positions.reduce((s, p) => s + costBasis(p), 0);
  const totalValue = positions.reduce((s, p) => {
    const cv = currentValue(p);
    return cv != null ? s + cv : s;
  }, 0);
  const totalPL = positions.reduce((s, p) => {
    const pl = unrealizedPL(p);
    return pl != null ? s + pl : s;
  }, 0);
  const totalPct = totalCost > 0 ? (totalPL / totalCost) * 100 : 0;
  const hasQuotes = positions.some((p) => p.quote != null);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-muted">Track positions with cost basis and unrealized P&amp;L.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
          <button
            onClick={openAdd}
            className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            + Add position
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </div>
      ) : null}

      {/* Summary cards */}
      {!loading && hasQuotes && positions.length > 0 ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          <SummaryCard label="Total invested" value={formatCurrency(totalCost)} />
          <SummaryCard label="Current value" value={formatCurrency(totalValue)} />
          <SummaryCard
            label="Unrealized P&L"
            value={formatCurrency(totalPL)}
            color={totalPL >= 0 ? "positive" : "negative"}
          />
          <SummaryCard
            label="Return"
            value={formatPercent(totalPct)}
            color={totalPct >= 0 ? "positive" : "negative"}
          />
        </div>
      ) : null}

      {/* Position table */}
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : positions.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center">
          <p className="text-muted">No positions yet.</p>
          <button
            onClick={openAdd}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Add your first position →
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Shares</th>
                <th className="px-4 py-3 text-right font-medium">Avg cost</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Cost basis</th>
                <th className="px-4 py-3 text-right font-medium">Market value</th>
                <th className="px-4 py-3 text-right font-medium">Unreal. P&L</th>
                <th className="px-4 py-3 text-right font-medium">Return</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {positions.map((p) => {
                const cv = currentValue(p);
                const pl = unrealizedPL(p);
                const pct = unrealizedPct(p);
                const positive = pl == null ? true : pl >= 0;
                return (
                  <tr key={p.symbol} className="bg-surface hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link
                        href={`/research?symbol=${p.symbol}`}
                        className="font-mono font-semibold text-accent hover:underline"
                      >
                        {p.symbol}
                      </Link>
                      <p className="truncate text-xs text-muted">{p.name}</p>
                    </td>
                    <td className="px-4 py-3 font-mono">{formatNumber(p.shares, p.shares % 1 === 0 ? 0 : 4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(p.avgCost)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {p.quote ? formatCurrency(p.quote.price, p.quote.currency) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatCurrency(costBasis(p))}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {cv != null ? formatCurrency(cv) : <span className="text-muted">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${pl != null ? (positive ? "text-positive" : "text-negative") : ""}`}>
                      {pl != null ? formatCurrency(pl) : <span className="text-muted">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${pct != null ? (positive ? "text-positive" : "text-negative") : ""}`}>
                      {pct != null ? formatPercent(pct) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(p)}
                          className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void remove(p.symbol)}
                          className="rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-negative/10 hover:text-negative"
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
      )}

      {showForm ? (
        <PositionModal
          initial={editTarget}
          onSaved={onSaved}
          onCancel={closeForm}
        />
      ) : null}
    </main>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "positive" | "negative";
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className={`font-mono text-lg font-semibold ${color === "positive" ? "text-positive" : color === "negative" ? "text-negative" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function PositionModal({
  initial,
  onSaved,
  onCancel,
}: {
  initial: PortfolioPosition | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [shares, setShares] = useState(initial ? String(initial.shares) : "");
  const [avgCost, setAvgCost] = useState(initial ? String(initial.avgCost) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sharesNum = parseFloat(shares);
    const costNum = parseFloat(avgCost);
    if (!symbol.trim()) return setErr("Symbol is required.");
    if (!Number.isFinite(sharesNum) || sharesNum <= 0) return setErr("Shares must be a positive number.");
    if (!Number.isFinite(costNum) || costNum < 0) return setErr("Average cost must be ≥ 0.");

    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          name: name.trim() || symbol.trim().toUpperCase(),
          shares: sharesNum,
          avgCost: costNum,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          {initial ? "Edit position" : "Add position"}
        </h2>
        <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Ticker symbol</span>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={!!initial}
              placeholder="AAPL"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-60"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Company name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Apple Inc."
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Shares</span>
            <input
              type="number"
              step="any"
              min="0"
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              placeholder="10"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Average cost per share (USD)</span>
            <input
              type="number"
              step="any"
              min="0"
              value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)}
              placeholder="150.00"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>

          {err ? (
            <p className="text-xs text-negative">{err}</p>
          ) : null}

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
