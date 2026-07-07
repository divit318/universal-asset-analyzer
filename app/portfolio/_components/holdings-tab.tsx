"use client";

import { useEffect, useRef, useState, Fragment, useCallback } from "react";
import Link from "next/link";
import { usePortfolio } from "@/lib/portfolio-context";
import type { EnrichedPosition, PositionRecommendation, PortfolioReport } from "@/lib/portfolio-analytics";
import type { PortfolioPosition, Quote } from "@/lib/types";
import { ACTION_LABEL } from "@/lib/portfolio-analytics";
import { formatCurrency, formatNumber } from "@/lib/format";

const ACTION_BADGE: Record<string, string> = {
  STRONG_BUY: "border-positive/50 bg-positive/12 text-positive",
  INCREASE:   "border-positive/40 bg-positive/8 text-positive",
  HOLD:       "border-border text-muted",
  REDUCE:     "border-orange-400/40 bg-orange-400/10 text-orange-400",
  SELL:       "border-negative/40 bg-negative/10 text-negative",
};

const ACTION_ROW_GLOW: Record<string, string> = {
  STRONG_BUY: "bg-positive/5 border-l-2 border-l-positive",
  INCREASE:   "bg-positive/3 border-l-2 border-l-positive/50",
  HOLD:       "",
  REDUCE:     "bg-orange-400/5 border-l-2 border-l-orange-400",
  SELL:       "bg-negative/5 border-l-2 border-l-negative",
};

type SortCol = "symbol" | "shares" | "avgCost" | "price" | "today" | "value" | "alloc" | "return";
type SortDir = "asc" | "desc";
const SORT_KEY = "uaa_holdings_sort";

function loadSortState(): { col: SortCol; dir: SortDir } {
  try {
    const raw = sessionStorage.getItem(SORT_KEY);
    if (raw) return JSON.parse(raw) as { col: SortCol; dir: SortDir };
  } catch { /* ignore */ }
  return { col: "value", dir: "desc" };
}

function InlineActionCallout({ rec, onSeeTrade }: { rec: PositionRecommendation; onSeeTrade: () => void }) {
  if (rec.action === "HOLD") return null;
  const isBuy = rec.action === "STRONG_BUY" || rec.action === "INCREASE";
  const color = isBuy ? "text-positive" : "text-orange-400";
  return (
    <div className="flex items-center gap-2 mt-1">
      <span className={`text-[10px] font-semibold ${color}`}>
        ◀ {ACTION_LABEL[rec.action]}: {rec.currentWeight.toFixed(1)}% → {rec.targetWeight.toFixed(1)}%
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onSeeTrade(); }}
        className={`rounded border px-2 py-0.5 text-[10px] font-semibold transition-colors hover:opacity-80 ${ACTION_BADGE[rec.action]}`}
      >
        See Trade →
      </button>
    </div>
  );
}

function PositionDetailDrawer({ pos, rec }: { pos: EnrichedPosition; rec: PositionRecommendation | undefined }) {
  if (!rec) return (
    <tr className="border-t border-border/40 bg-surface-2/40">
      <td colSpan={9} className="px-6 py-3">
        <p className="text-xs text-muted">No score data available for {pos.symbol}.</p>
      </td>
    </tr>
  );
  return (
    <tr className="border-t border-border/40 bg-surface-2/30">
      <td colSpan={9} className="px-6 py-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Confidence Breakdown</p>
            <div className="space-y-2">
              {[
                { label: "Fundamentals",      value: rec.fundamentalScore },
                { label: "Analyst Consensus", value: rec.analystScore },
                { label: "Momentum",          value: rec.momentumScore },
              ].map(({ label, value }) => {
                if (value == null) return null;
                const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-negative";
                return (
                  <div key={label}>
                    <div className="flex justify-between text-[10px] mb-0.5">
                      <span className="text-muted">{label}</span>
                      <span className="font-mono font-semibold">{value}</span>
                    </div>
                    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-1 flex items-center gap-2">
                <span className="text-[10px] text-muted">Overall Confidence</span>
                <span className="font-mono text-sm font-bold">{rec.confidence}%</span>
              </div>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Reasoning</p>
            <p className="text-xs leading-5 text-foreground/80 mb-2">{rec.reasoning}</p>
            {rec.keyMetrics.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {rec.keyMetrics.map((m, i) => (
                  <span key={i} className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px]">{m}</span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            {rec.catalysts.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Catalysts</p>
                {rec.catalysts.map((c, i) => (
                  <div key={i} className="flex gap-1.5 text-xs text-foreground/75 mb-1">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-positive shrink-0" />{c}
                  </div>
                ))}
              </div>
            )}
            {rec.risks.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-1.5">Risks</p>
                {rec.risks.map((r, i) => (
                  <div key={i} className="flex gap-1.5 text-xs text-foreground/75 mb-1">
                    <span className="mt-1.5 h-1 w-1 rounded-full bg-negative shrink-0" />{r}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function SortTh({
  col, label, sortCol, sortDir, onSort, className = "",
}: {
  col: SortCol; label: string; sortCol: SortCol; sortDir: SortDir;
  onSort: (c: SortCol) => void; className?: string;
}) {
  const active = sortCol === col;
  return (
    <th className={`px-4 py-3 font-medium cursor-pointer select-none group ${className}`} onClick={() => onSort(col)}>
      <span className={`flex items-center gap-1 ${className.includes("text-right") ? "justify-end" : ""}`}>
        <span className={active ? "text-accent" : "group-hover:text-foreground transition-colors"}>{label}</span>
        <span className={`text-[10px] ${active ? "text-accent" : "text-muted/40 group-hover:text-muted"}`}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

export interface PositionWithQuote extends PortfolioPosition { quote: Quote | null; }

interface HoldingsTableProps {
  positions: PositionWithQuote[];
  report: PortfolioReport | null;
  totalValue: number;
  onEdit: (p: PortfolioPosition) => void;
  onDelete: (p: PortfolioPosition) => void;
}

function costBasis(p: PortfolioPosition)         { return p.shares * p.avgCost; }
function currentValue(p: PositionWithQuote)      { return p.quote ? p.shares * p.quote.price : null; }
function unrealizedPL(p: PositionWithQuote)      { const cv = currentValue(p); const cb = costBasis(p); return cv != null ? cv - cb : null; }
function unrealizedPct(p: PositionWithQuote)     { const pl = unrealizedPL(p); const cb = costBasis(p); return pl != null && cb !== 0 ? (pl / cb) * 100 : null; }
function todayChangeDollar(p: PositionWithQuote) { return p.quote ? p.shares * p.quote.price * (p.quote.changePercent / 100) : null; }

export function HoldingsTable({ positions, report, totalValue, onEdit, onDelete }: HoldingsTableProps) {
  const { focusedSymbol, focusSymbol, navigateTo } = usePortfolio();
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [search, setSearch]         = useState("");
  const [actionFilter, setActionFilter] = useState<"all" | "buy" | "hold" | "sell">("all");
  const [sectorFilter, setSectorFilter] = useState("all");
  const focusedRowRef = useRef<HTMLTableRowElement | null>(null);

  const saved = loadSortState();
  const [sortCol, setSortCol] = useState<SortCol>(saved.col);
  const [sortDir, setSortDir] = useState<SortDir>(saved.dir);

  useEffect(() => {
    try { sessionStorage.setItem(SORT_KEY, JSON.stringify({ col: sortCol, dir: sortDir })); } catch { /* ignore */ }
  }, [sortCol, sortDir]);

  useEffect(() => {
    if (focusedSymbol && focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => focusSymbol(null), 3000);
      return () => clearTimeout(t);
    }
  }, [focusedSymbol, focusSymbol]);

  const handleSort = useCallback((col: SortCol) => {
    if (col === sortCol) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("desc"); }
  }, [sortCol]);

  const recMap     = new Map((report?.recommendations ?? []).map((r) => [r.symbol, r]));
  const enrichedMap = new Map((report?.positions ?? []).map((p) => [p.symbol, p]));
  const sectors    = Array.from(new Set((report?.positions ?? []).map((p) => p.sector).filter(Boolean))).sort();

  const filtered = positions.filter((p) => {
    const q = search.toLowerCase();
    if (q && !p.symbol.toLowerCase().includes(q) && !p.name.toLowerCase().includes(q)) return false;
    if (actionFilter !== "all") {
      const action = recMap.get(p.symbol)?.action ?? "HOLD";
      if (actionFilter === "buy"  && action !== "STRONG_BUY" && action !== "INCREASE") return false;
      if (actionFilter === "sell" && action !== "REDUCE"     && action !== "SELL")      return false;
      if (actionFilter === "hold" && action !== "HOLD") return false;
    }
    if (sectorFilter !== "all" && enrichedMap.get(p.symbol)?.sector !== sectorFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const aCV   = currentValue(a) ?? 0;
    const bCV   = currentValue(b) ?? 0;
    const aAlloc = totalValue > 0 && aCV ? (aCV / totalValue) * 100 : 0;
    const bAlloc = totalValue > 0 && bCV ? (bCV / totalValue) * 100 : 0;
    let cmp = 0;
    switch (sortCol) {
      case "symbol":  cmp = a.symbol.localeCompare(b.symbol); break;
      case "shares":  cmp = a.shares  - b.shares; break;
      case "avgCost": cmp = a.avgCost - b.avgCost; break;
      case "price":   cmp = (a.quote?.price ?? 0) - (b.quote?.price ?? 0); break;
      case "today":   cmp = (a.quote?.changePercent ?? 0) - (b.quote?.changePercent ?? 0); break;
      case "value":   cmp = aCV - bCV; break;
      case "alloc":   cmp = aAlloc - bAlloc; break;
      case "return":  cmp = (unrealizedPct(a) ?? 0) - (unrealizedPct(b) ?? 0); break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/50" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="9" r="7"/><path d="M16 16l-3-3"/>
          </svg>
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ticker or name…"
            className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-xs outline-none focus:border-accent placeholder:text-muted"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground text-sm">×</button>
          )}
        </div>

        <div className="flex gap-1">
          {(["all", "buy", "hold", "sell"] as const).map((f) => (
            <button key={f} onClick={() => setActionFilter(f)} className={`rounded-lg border px-3 py-2 text-xs capitalize transition-colors ${
              actionFilter === f
                ? f === "buy" ? "border-positive/50 bg-positive/10 text-positive font-medium"
                : f === "sell" ? "border-negative/50 bg-negative/10 text-negative font-medium"
                : "border-accent/50 bg-accent/10 text-accent font-medium"
                : "border-border text-muted hover:text-foreground"
            }`}>{f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>

        {sectors.length > 1 && (
          <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none focus:border-accent text-muted">
            <option value="all">All sectors</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {(search || actionFilter !== "all" || sectorFilter !== "all") && (
          <span className="text-xs text-muted ml-auto">{sorted.length} of {positions.length} positions</span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wide text-muted sticky top-0 z-10">
            <tr>
              <SortTh col="symbol"  label="Position" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <SortTh col="shares"  label="Shares"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="avgCost" label="Avg Cost" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="price"   label="Price"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="today"   label="Today"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="value"   label="Value"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="alloc"   label="Alloc"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <SortTh col="return"  label="Return"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
              <th className="px-4 py-3 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-8 text-center text-sm text-muted">
                  No positions match your filters.{" "}
                  <button onClick={() => { setSearch(""); setActionFilter("all"); setSectorFilter("all"); }} className="text-accent hover:underline">
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : sorted.map((p) => {
              const cv       = currentValue(p);
              const pl       = unrealizedPL(p);
              const plPct    = unrealizedPct(p);
              const todayDlr = todayChangeDollar(p);
              const allocPct = totalValue > 0 && cv != null ? (cv / totalValue) * 100 : null;
              const positive = pl == null ? true : pl >= 0;
              const todayPos = (p.quote?.changePercent ?? 0) >= 0;
              const rec      = recMap.get(p.symbol);
              const enriched = enrichedMap.get(p.symbol);
              const isFocused  = focusedSymbol === p.symbol;
              const hasAction  = rec && rec.action !== "HOLD";
              const rowGlow    = isFocused ? "bg-accent/10 border-l-2 border-l-accent" : hasAction ? ACTION_ROW_GLOW[rec.action] ?? "" : "";
              const isExpanded = expanded === p.symbol;

              return (
                <Fragment key={p.symbol}>
                  <tr
                    ref={isFocused ? focusedRowRef : null}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    className={`transition-colors cursor-pointer hover:bg-surface-2 ${rowGlow}`}
                    onClick={() => setExpanded((prev) => prev === p.symbol ? null : p.symbol)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpanded((prev) => prev === p.symbol ? null : p.symbol);
                      }
                    }}
                  >
                    <td className="px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Link href={`/research?symbol=${p.symbol}`} className="font-mono font-bold text-accent hover:underline" onClick={(e) => e.stopPropagation()}>
                            {p.symbol}
                          </Link>
                          {rec && rec.action !== "HOLD" && (
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${ACTION_BADGE[rec.action]}`}>
                              {ACTION_LABEL[rec.action]}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted truncate max-w-[180px]">{p.name}</p>
                        {rec && hasAction && (
                          <InlineActionCallout rec={rec} onSeeTrade={() => navigateTo("actions", { symbol: p.symbol })} />
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {formatNumber(p.shares, p.shares % 1 === 0 ? 0 : 4)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">{formatCurrency(p.avgCost)}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {p.quote ? formatCurrency(p.quote.price, p.quote.currency) : <span className="text-muted">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm ${todayPos ? "text-positive" : "text-negative"}`}>
                      {p.quote ? `${todayPos ? "+" : ""}${p.quote.changePercent.toFixed(2)}%` : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm">
                      {cv != null ? formatCurrency(cv) : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {allocPct != null ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="font-mono text-xs">{allocPct.toFixed(1)}%</span>
                          <div className="h-1 w-12 overflow-hidden rounded-full bg-border">
                            <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.min(100, allocPct)}%` }} />
                          </div>
                        </div>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right font-mono text-sm ${positive ? "text-positive" : "text-negative"}`}>
                      {plPct != null ? `${positive ? "+" : ""}${plPct.toFixed(1)}%` : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={(e) => { e.stopPropagation(); onEdit(p); }} className="rounded px-2 py-1 text-[11px] text-muted hover:bg-surface-2 hover:text-foreground transition-colors">Edit</button>
                        <button onClick={(e) => { e.stopPropagation(); onDelete(p); }} className="rounded px-2 py-1 text-[11px] text-muted hover:bg-negative/10 hover:text-negative transition-colors">×</button>
                        <span className={`text-[11px] text-muted transition-transform inline-block ${isExpanded ? "rotate-180" : ""}`}>▾</span>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <PositionDetailDrawer
                      pos={enriched ?? { symbol: p.symbol, name: p.name, shares: p.shares, avgCost: p.avgCost, price: null, value: cv ?? 0, costBasis: costBasis(p), unrealizedPL: pl, unrealizedPct: plPct, todayChangePct: p.quote?.changePercent ?? null, todayChangeDollar: todayDlr, weight: allocPct ?? 0, sector: "Unknown", score: null, momentum: null, dividendYield: null, upsidePercent: null }}
                      rec={rec}
                    />
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {positions.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted px-1">
          <span>{positions.length} positions · {positions.filter((p) => p.quote).length} with live quotes</span>
          {report?.recommendations && (
            <span>
              {report.recommendations.filter((r) => r.action === "STRONG_BUY" || r.action === "INCREASE").length} buy ·{" "}
              {report.recommendations.filter((r) => r.action === "HOLD").length} hold ·{" "}
              {report.recommendations.filter((r) => r.action === "REDUCE" || r.action === "SELL").length} sell
            </span>
          )}
        </div>
      )}
    </div>
  );
}
