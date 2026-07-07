"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/lib/download";
import type { PortfolioPosition, Quote } from "@/lib/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { Dialog, ConfirmDialog } from "@/app/_components/dialog";
import { useToast } from "@/app/_components/toast";
import { PortfolioProvider, usePortfolio, type PortfolioTab } from "@/lib/portfolio-context";
import { PageShell, PageHeader, StatTile, Button, Tabs, type TabItem, Input, Field } from "@/app/_components/ui";

import { PerformancePanel }  from "./_components/performance-panel";
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

const TABS: TabItem<PortfolioTab>[] = [
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
    <PageShell gap="gap-5">
      <PageHeader
        title="Portfolio"
        description="AI Portfolio Management System — analytics, decisions, and institutional-grade insights."
        actions={
          <>
            <Link
              href="/intelligence?view=timeline&scope=portfolio&id=portfolio"
              className="flex items-center rounded-control border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Timeline
            </Link>
            <Link
              href="/intelligence?view=graph&scope=portfolio&id=portfolio"
              className="flex items-center rounded-control border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Graph
            </Link>
            <Link
              href="/intelligence?view=opportunity-map"
              className="flex items-center rounded-control border border-border px-4 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              Opportunities
            </Link>
            <Button variant="secondary" onClick={() => { onRefresh(); void refreshReport(true); }}>
              ↻ Refresh
            </Button>
            <Button variant="secondary" onClick={onExport}>
              ↓ Export Excel
            </Button>
            <Button variant="primary" onClick={onAddPosition}>
              + Add position
            </Button>
          </>
        }
      />
      {exportErr && <p className="text-xs text-negative">{exportErr}</p>}
      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
      )}

      {/* Hero P&L bar — always visible when there are positions */}
      {!loading && hasPositions && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            className="col-span-2 sm:col-span-1"
            label="Portfolio Value"
            value={formatCurrency(totalValue)}
            sublabel={`Cost basis ${formatCurrency(totalCost)}`}
          />
          <StatTile
            label="Unrealized P&L"
            tone={totalPL >= 0 ? "positive" : "negative"}
            value={`${totalPL >= 0 ? "+" : ""}${formatCurrency(totalPL)}`}
            sublabel={
              <span className={`font-mono text-xs font-medium ${totalPct >= 0 ? "text-positive" : "text-negative"}`}>
                {totalPct >= 0 ? "+" : ""}{formatPercent(totalPct)}
              </span>
            }
          />
          <StatTile
            label="Today's Change"
            tone={todayPL >= 0 ? "positive" : "negative"}
            value={`${todayPL >= 0 ? "+" : ""}${formatCurrency(todayPL)}`}
            sublabel={`${positions.filter((p) => p.quote).length} positions tracked`}
          />
          {report ? (
            <StatTile
              label="Health Score"
              tone={
                report.health.grade === "A" || report.health.grade === "B" ? "positive"
                : report.health.grade === "C" ? "warning"
                : "negative"
              }
              value={
                <span className="flex items-baseline gap-2">
                  <span className="text-foreground">{report.health.total}</span>
                  <span className="text-2xl">{report.health.grade}</span>
                </span>
              }
              sublabel={report.health.summary}
            />
          ) : (
            <div className="animate-pulse rounded-card border border-border bg-surface p-5">
              <div className="mb-2 h-3 w-20 rounded bg-surface-2" />
              <div className="h-6 w-16 rounded bg-surface-2" />
            </div>
          )}
        </div>
      )}

      {/* Money-weighted performance + benchmark-relative return */}
      {!loading && hasPositions && <PerformancePanel />}

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
          <Button variant="primary" size="md" onClick={onAddPosition}>
            Add first position →
          </Button>
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
          <Tabs
            tabs={TABS.map((t) => ({
              ...t,
              badge:
                t.id === "brief" ? highAlertCount
                : t.id === "actions" ? actionCount
                : undefined,
              badgeVariant: t.id === "brief" ? ("negative" as const) : ("brand" as const),
            }))}
            active={activeTab}
            onChange={navigateTo}
            layoutId="portfolio-tabs-underline"
          />

          {/* Analytics loading / error banner */}
          {reportLoading && !report && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface/50 px-4 py-2.5 text-xs text-muted">
              <span className="h-2 w-2 rounded-full bg-brand/60 animate-pulse" />
              Loading deep analytics…
            </div>
          )}
          {reportError && (
            <div className="flex items-center justify-between rounded-lg border border-negative/25 bg-negative/5 px-4 py-2.5">
              <p className="text-xs text-negative">{reportError}</p>
              <button onClick={() => void refreshReport(true)} className="text-xs text-brand hover:underline ml-4">Retry</button>
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
                  <RebalancePanel rebalance={report.rebalance} />
                  <CIOPanel report={report} />
                </>
              ) : reportLoading ? (
                <SectionSkeleton rows={4} />
              ) : (
                <div className="rounded-xl border border-border bg-surface px-5 py-8 text-center">
                  <p className="text-sm text-muted">
                    Analytics unavailable.{" "}
                    <button onClick={() => void refreshReport(true)} className="text-brand hover:underline">Retry</button>
                  </p>
                </div>
              )}
              <ConstraintsPanel />
            </div>
          )}
        </div>
      )}
    </PageShell>
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
        <Field label="Ticker symbol" hint={!isEditing ? "Indian stocks: use .NS (NSE) or .BO (BSE) suffix" : undefined}>
          <div className="relative">
            <Input
              value={symbol}
              onChange={(e) => onSymbolChange(e.target.value)}
              disabled={isEditing}
              placeholder="AAPL or RELIANCE.NS"
              className={`font-mono ${
                symbolValid === true  ? "border-positive/60 bg-surface-2"
                : symbolValid === false ? "border-negative/60 bg-negative/5"
                : ""
              }`}
            />
            {validating                           && <span className="absolute right-3 top-2.5 text-xs text-muted">checking…</span>}
            {symbolValid === true  && !validating && <span className="absolute right-3 top-2.5 text-xs text-positive">✓ valid</span>}
            {symbolValid === false && !validating && <span className="absolute right-3 top-2.5 text-xs text-negative">✗ not found</span>}
          </div>
        </Field>

        <Field label="Company name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Auto-filled from ticker" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Shares">
            <Input
              type="number" step="any" min="0" value={shares}
              onChange={(e) => setShares(e.target.value)} placeholder="10"
              className="font-mono"
            />
          </Field>
          <Field label="Avg cost / share">
            <Input
              type="number" step="any" min="0" value={avgCost}
              onChange={(e) => setAvgCost(e.target.value)} placeholder="150.00"
              className="font-mono"
            />
          </Field>
        </div>

        {err && <p className="text-xs text-negative">{err}</p>}

        <div className="flex gap-2 pt-1">
          <Button type="submit" variant="primary" className="flex-1" disabled={saving || validating}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
