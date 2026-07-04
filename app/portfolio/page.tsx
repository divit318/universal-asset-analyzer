"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/lib/download";
import type { PortfolioPosition, Quote } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Dialog, ConfirmDialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { PortfolioProvider, usePortfolio, type PortfolioTab } from "@/lib/portfolio-context";

import { BriefTab }          from "./_components/brief-tab";
import { HoldingsTable, type PositionWithQuote } from "./_components/holdings-tab";
import { IntelligenceTab }   from "./_components/intelligence-tab";
import { ActionsTab }        from "./_components/actions-tab";
import { RebalancePanel }    from "./_components/rebalance-panel";
import { CIOPanel }          from "./_components/cio-panel";
import { ObjectiveSelector } from "./_components/objective-selector";
import { ConstraintsPanel }  from "./_components/constraints-panel";

/* ─────────────── Helpers ─────────────── */

function costBasis(p: PortfolioPosition)         { return p.shares * p.avgCost; }
function currentValue(p: PositionWithQuote)      { return p.quote ? p.shares * p.quote.price : null; }
function unrealizedPL(p: PositionWithQuote)      { const cv = currentValue(p); return cv != null ? cv - costBasis(p) : null; }
function unrealizedPct(p: PositionWithQuote)     { const pl = unrealizedPL(p); const cb = costBasis(p); return pl != null && cb !== 0 ? (pl / cb) * 100 : null; }
function todayChangeDollar(p: PositionWithQuote) { return p.quote ? p.shares * p.quote.price * (p.quote.changePercent / 100) : null; }

function SectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-border bg-surface" />
      ))}
    </div>
  );
}

/* ─────────────── Tab nav config ─────────────── */

const TABS: { id: PortfolioTab; label: string }[] = [
  { id: "brief",        label: "Brief"        },
  { id: "actions",      label: "Actions"      },
  { id: "intelligence", label: "Intelligence" },
  { id: "holdings",     label: "Holdings"     },
  { id: "review",       label: "Review"       },
];

/* ─────────────── Inner layout (must be inside PortfolioProvider) ─────────────── */

interface PortfolioInnerProps {
  positions:   PositionWithQuote[];
  totalValue:  number;
  totalCost:   number;
  totalPL:     number;
  todayPL:     number;
  totalPct:    number;
  hasPositions: boolean;
  loading:     boolean;
  onEdit:      (p: PortfolioPosition) => void;
  onDelete:    (p: PortfolioPosition) => void;
  onRefresh:   () => void;
  onExport:    () => void;
  onAddPosition: () => void;
  exportErr:   string | null;
  error:       string | null;
}

function PortfolioInner({
  positions, totalValue, totalCost, totalPL, todayPL, totalPct,
  hasPositions, loading,
  onEdit, onDelete, onRefresh, onExport, onAddPosition,
  exportErr, error,
}: PortfolioInnerProps) {
  const { activeTab, navigateTo, report, reportLoading, reportError, refreshReport } = usePortfolio();

  // Trigger analytics load once positions are available
  useEffect(() => {
    if (hasPositions) void refreshReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPositions]);

  const highAlertCount = report?.alerts.filter((a) => a.severity === "high").length ?? 0;
  const actionCount    = report?.recommendations.filter((r) => r.action !== "HOLD").length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-6 py-8">

      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="text-sm text-muted mt-0.5">AI Portfolio Management System — analytics, decisions, and institutional-grade insights.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/intelligence?view=timeline&scope=portfolio&id=portfolio"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Timeline
          </Link>
          <Link
            href="/intelligence?view=graph&scope=portfolio&id=portfolio"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Graph
          </Link>
          <Link
            href="/intelligence?view=opportunity-map"
            className="flex items-center rounded-lg border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Opportunities
          </Link>
          <button
            onClick={() => { onRefresh(); void refreshReport(true); }}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↻ Refresh
          </button>
          <button
            onClick={onExport}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2"
          >
            ↓ Export Excel
          </button>
          <button
            onClick={onAddPosition}
            className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            + Add position
          </button>
        </div>
      </div>
      {exportErr && <p className="text-xs text-negative">{exportErr}</p>}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
      )}

      {/* Hero P&L bar — always visible when there are positions */}
      {!loading && hasPositions && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1 rounded-xl border border-border bg-surface p-5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Portfolio Value</span>
            <p className="font-mono text-2xl font-bold mt-1">{formatCurrency(totalValue)}</p>
            <p className="text-xs text-muted">Cost basis {formatCurrency(totalCost)}</p>
          </div>
          <div className={`rounded-xl border p-5 ${totalPL >= 0 ? "border-positive/30 bg-positive/5" : "border-negative/30 bg-negative/5"}`}>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Unrealized P&amp;L</span>
            <p className={`font-mono text-xl font-bold mt-1 ${totalPL >= 0 ? "text-positive" : "text-negative"}`}>
              {totalPL >= 0 ? "+" : ""}{formatCurrency(totalPL)}
            </p>
            <p className={`font-mono text-xs font-medium ${totalPct >= 0 ? "text-positive" : "text-negative"}`}>
              {totalPct >= 0 ? "+" : ""}{formatPercent(totalPct)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Today&apos;s Change</span>
            <p className={`font-mono text-xl font-bold mt-1 ${todayPL >= 0 ? "text-positive" : "text-negative"}`}>
              {todayPL >= 0 ? "+" : ""}{formatCurrency(todayPL)}
            </p>
            <p className="text-xs text-muted">{positions.filter((p) => p.quote).length} positions tracked</p>
          </div>
          {report ? (
            <div className={`rounded-xl border p-5 ${
              report.health.grade === "A" ? "border-positive/30 bg-positive/5"
              : report.health.grade === "B" ? "border-positive/20 bg-surface"
              : report.health.grade === "C" ? "border-amber-400/30 bg-amber-400/5"
              : "border-negative/30 bg-negative/5"
            }`}>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted/60">Health Score</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-mono text-xl font-bold">{report.health.total}</span>
                <span className={`text-2xl font-bold ${
                  report.health.grade === "A" ? "text-positive"
                  : report.health.grade === "B" ? "text-positive/70"
                  : report.health.grade === "C" ? "text-amber-400"
                  : "text-negative"
                }`}>{report.health.grade}</span>
              </div>
              <p className="text-xs text-muted truncate">{report.health.summary}</p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5 animate-pulse">
              <div className="h-3 w-20 bg-surface-2 rounded mb-2" />
              <div className="h-6 w-16 bg-surface-2 rounded" />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasPositions && (
        <div className="flex flex-col items-center gap-5 rounded-xl border border-border bg-surface py-14 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface-2 text-muted">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3v14M3 10h14" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-semibold">No positions yet</p>
            <p className="max-w-xs text-xs leading-5 text-muted">
              Add your holdings to track live P&amp;L, cost basis, allocation, and get AI-powered portfolio intelligence.
            </p>
          </div>
          <button
            onClick={onAddPosition}
            className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Add first position →
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && <SectionSkeleton rows={4} />}

      {/* Tabbed content */}
      {!loading && hasPositions && (
        <div id="portfolio-content" className="flex flex-col gap-4">
          {/* Portfolio Objective Selector */}
          <ObjectiveSelector />

          {/* Tab nav */}
          <div className="flex items-center gap-1 border-b border-border overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => navigateTo(t.id)}
                className={`relative shrink-0 px-4 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === t.id
                    ? "text-foreground border-b-2 border-accent -mb-px"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
                {t.id === "brief" && highAlertCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-negative text-[9px] font-bold text-background">
                    {highAlertCount}
                  </span>
                )}
                {t.id === "actions" && actionCount > 0 && (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-strong/80 text-[9px] font-bold text-background">
                    {actionCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Analytics loading / error banner */}
          {reportLoading && !report && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/50 px-4 py-2.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-accent/60 animate-pulse" />
              Loading deep analytics…
            </div>
          )}
          {reportError && (
            <div className="flex items-center justify-between rounded-lg border border-negative/25 bg-negative/5 px-4 py-2.5">
              <p className="text-xs text-negative">{reportError}</p>
              <button onClick={() => void refreshReport(true)} className="text-xs text-accent hover:underline ml-4">Retry</button>
            </div>
          )}

          {/* === BRIEF TAB === */}
          {activeTab === "brief" && (
            <BriefTab />
          )}

          {/* === HOLDINGS TAB === */}
          {activeTab === "holdings" && (
            <HoldingsTable
              positions={positions}
              report={report}
              totalValue={totalValue}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          )}

          {/* === INTELLIGENCE TAB === */}
          {activeTab === "intelligence" && (
            <IntelligenceTab />
          )}

          {/* === ACTIONS TAB === */}
          {activeTab === "actions" && (
            <ActionsTab />
          )}

          {/* === REVIEW TAB (Rebalancing + AI CIO + Constraints) === */}
          {activeTab === "review" && (
            <div className="flex flex-col gap-8">
              {report ? (
                <>
                  <RebalancePanel rebalance={report.rebalance} totalValue={report.totalValue} />
                  <CIOPanel report={report} />
                </>
              ) : reportLoading ? (
                <SectionSkeleton rows={4} />
              ) : (
                <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center">
                  <p className="text-sm text-muted">
                    Analytics unavailable.{" "}
                    <button onClick={() => void refreshReport(true)} className="text-accent hover:underline">Retry</button>
                  </p>
                </div>
              )}
              <ConstraintsPanel />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Page root ─────────────── */

export default function PortfolioPage() {
  const [positions,  setPositions]  = useState<PositionWithQuote[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [exportErr,  setExportErr]  = useState<string | null>(null);

  const [showForm,      setShowForm]      = useState(false);
  const [editTarget,    setEditTarget]    = useState<PortfolioPosition | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PortfolioPosition | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "Portfolio · UAA";
    return () => { document.title = "Universal Asset Analyzer"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/portfolio");
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to load portfolio");
      const list = (json as { positions: PortfolioPosition[] }).positions;
      const quoteMap: Record<string, Quote> = {};
      if (list.length > 0) {
        const symbols = list.map((p) => p.symbol).join(",");
        const qres  = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
        const qjson = await qres.json();
        if (qres.ok) for (const q of (qjson as { quotes: Quote[] }).quotes) quoteMap[q.symbol] = q;
      }
      setPositions(list.map((p) => ({ ...p, quote: quoteMap[p.symbol] ?? null })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally { setLoading(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function remove(symbol: string) {
    setPositions((prev) => prev.filter((p) => p.symbol !== symbol));
    await fetch(`/api/portfolio?symbol=${encodeURIComponent(symbol)}`, { method: "DELETE" });
    toast(`${symbol} removed from portfolio`, "info");
  }

  function openAdd()   { setEditTarget(null); setShowForm(true); }
  function openEdit(p: PortfolioPosition) { setEditTarget(p); setShowForm(true); }
  function closeForm() { setShowForm(false); setEditTarget(null); }
  async function onSaved(isNew: boolean) {
    closeForm();
    toast(isNew ? "Position added" : "Position updated");
    await load();
  }

  const totalCost        = positions.reduce((s, p) => s + costBasis(p), 0);
  const totalCostTracked = positions.reduce((s, p) => p.quote != null ? s + costBasis(p) : s, 0);
  const totalValue = positions.reduce((s, p) => { const cv = currentValue(p); return cv != null ? s + cv : s; }, 0);
  const totalPL    = positions.reduce((s, p) => { const pl = unrealizedPL(p); return pl != null ? s + pl : s; }, 0);
  const todayPL    = positions.reduce((s, p) => { const tc = todayChangeDollar(p); return tc != null ? s + tc : s; }, 0);
  // Use only cost of positions with live quotes as denominator so % matches the $ P&L shown
  const totalPct   = totalCostTracked > 0 ? (totalPL / totalCostTracked) * 100 : 0;
  const hasPositions = positions.length > 0;

  return (
    <PortfolioProvider>
      <PortfolioInner
        positions={positions}
        totalValue={totalValue}
        totalCost={totalCost}
        totalPL={totalPL}
        todayPL={todayPL}
        totalPct={totalPct}
        hasPositions={hasPositions}
        loading={loading}
        onEdit={openEdit}
        onDelete={(p) => setConfirmDelete(p)}
        onRefresh={() => void load()}
        onExport={() => {
          setExportErr(null);
          void downloadBlob(
            "/api/export/portfolio?format=excel",
            `portfolio-${new Date().toISOString().slice(0, 10)}.xlsx`
          ).catch((e: unknown) => setExportErr(e instanceof Error ? e.message : "Export failed"));
        }}
        onAddPosition={openAdd}
        exportErr={exportErr}
        error={error}
      />

      {showForm && (
        <PositionModal initial={editTarget} onSaved={onSaved} onCancel={closeForm} />
      )}

      <ConfirmDialog
        open={confirmDelete != null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete.symbol); }}
        title="Remove position"
        message={`Remove ${confirmDelete?.symbol} from your portfolio? This cannot be undone.`}
        confirmLabel="Remove"
        danger
      />
    </PortfolioProvider>
  );
}

/* ─────────────────────────── PositionModal ─────────────────────────── */

function PositionModal({ initial, onSaved, onCancel }: {
  initial: PortfolioPosition | null;
  onSaved: (isNew: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [symbol,   setSymbol]   = useState(initial?.symbol ?? "");
  const [name,     setName]     = useState(initial?.name ?? "");
  const [shares,   setShares]   = useState(initial ? String(initial.shares) : "");
  const [avgCost,  setAvgCost]  = useState(initial ? String(initial.avgCost) : "");
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [symbolValid, setSymbolValid] = useState<boolean | null>(initial ? true : null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isEditing = !!initial;

  async function validateSymbol(sym: string) {
    if (!sym.trim()) { setSymbolValid(null); return; }
    setValidating(true);
    try {
      const res  = await fetch(`/api/quote?symbols=${encodeURIComponent(sym.trim().toUpperCase())}`);
      const json = await res.json();
      const q    = (json as { quotes: Quote[] }).quotes?.[0];
      if (q) { setSymbolValid(true); if (!name) setName(q.name ?? ""); }
      else    { setSymbolValid(false); }
    } catch { setSymbolValid(null); }
    finally   { setValidating(false); }
  }

  function onSymbolChange(v: string) {
    setSymbol(v.toUpperCase());
    setSymbolValid(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { void validateSymbol(v); }, 700);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const sharesNum = parseFloat(shares);
    const costNum   = parseFloat(avgCost);
    if (!symbol.trim())                                  return setErr("Symbol is required.");
    if (!Number.isFinite(sharesNum) || sharesNum <= 0)  return setErr("Shares must be a positive number.");
    if (!Number.isFinite(costNum)   || costNum < 0)     return setErr("Average cost must be ≥ 0.");
    if (symbolValid === false)                           return setErr("Ticker not found — check the symbol and try again.");

    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol:  symbol.trim().toUpperCase(),
          name:    name.trim() || symbol.trim().toUpperCase(),
          shares:  sharesNum,
          avgCost: costNum,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed to save");
      await onSaved(!isEditing);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onCancel} title={isEditing ? "Edit position" : "Add position"} className="max-w-md">
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Ticker symbol</span>
          <div className="relative">
            <input
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              disabled={isEditing}
              placeholder="AAPL or RELIANCE.NS"
              className={`w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent disabled:opacity-60 ${
                symbolValid === true  ? "border-positive/60 bg-surface-2"
                : symbolValid === false ? "border-negative/60 bg-negative/5"
                : "border-border bg-surface-2"
              }`}
            />
            {validating                           && <span className="absolute right-3 top-2.5 text-xs text-muted">checking…</span>}
            {symbolValid === true  && !validating && <span className="absolute right-3 top-2.5 text-xs text-positive">✓ valid</span>}
            {symbolValid === false && !validating && <span className="absolute right-3 top-2.5 text-xs text-negative">✗ not found</span>}
          </div>
          {!isEditing && <span className="text-xs text-muted">Indian stocks: use .NS (NSE) or .BO (BSE) suffix</span>}
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Company name</span>
          <input
            value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-filled from ticker"
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Shares</span>
            <input
              type="number" step="any" min="0" value={shares}
              onChange={(e) => setShares(e.target.value)} placeholder="10"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Avg cost / share</span>
            <input
              type="number" step="any" min="0" value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)} placeholder="150.00"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
        </div>

        {err && <p className="text-xs text-negative">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button
            type="submit" disabled={saving || validating}
            className="flex-1 rounded-lg bg-accent-strong py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
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
