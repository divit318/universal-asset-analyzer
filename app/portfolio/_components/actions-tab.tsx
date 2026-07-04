"use client";

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio-context";
import type { PositionRecommendation, PortfolioReport } from "@/lib/portfolio-analytics";
import { ACTION_LABEL } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";
import { MovementExplainerCard } from "@/app/_components/movement-explainer-card";

/* ─────────────── Before/After impact computation ─────────────── */

function computeAfterState(
  report: PortfolioReport,
  rec: PositionRecommendation
): { hhi: number; topPos: number; volDelta: number } {
  const positions = report.positions;
  const newPositionValues = positions.map((p) => {
    if (p.symbol === rec.symbol) return Math.max(0, p.value + rec.suggestedDollar);
    return p.value;
  });
  const newTotal = newPositionValues.reduce((s, v) => s + v, 0);
  if (newTotal <= 0) return { hhi: report.risk.hhi, topPos: report.risk.topPositionWeight, volDelta: 0 };

  const newWeights = newPositionValues.map((v) => (v / newTotal) * 100);
  const newHHI    = Math.round(newWeights.reduce((s, w) => s + w * w, 0));
  const newTopPos  = Math.max(...newWeights);

  // Rough vol delta: concentration reduction correlates to ~0.3% vol per 100 HHI pts
  const hhiDelta   = newHHI - report.risk.hhi;
  const volDelta   = Math.round((hhiDelta / 100) * 0.3 * 10) / 10;

  return { hhi: newHHI, topPos: Math.round(newTopPos * 10) / 10, volDelta };
}

/* ─────────────── Confidence breakdown ─────────────── */

function ConfidenceBar({ label, value, max = 100 }: { label: string; value: number | null; max?: number }) {
  if (value == null) return null;
  const pct   = (value / max) * 100;
  const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-negative";

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted w-28 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs font-semibold w-6 text-right">{value}</span>
    </div>
  );
}

/* ─────────────── Before/After visual ─────────────── */

function BeforeAfterRow({
  label,
  before,
  after,
  unit = "",
  lowerIsBetter = false,
}: {
  label: string;
  before: number | null;
  after: number | null;
  unit?: string;
  lowerIsBetter?: boolean;
}) {
  if (before == null) return null;
  const delta   = after != null ? after - before : 0;
  const improved = lowerIsBetter ? delta < -0.5 : delta > 0.5;
  const worsened = lowerIsBetter ? delta > 0.5 : delta < -0.5;
  const arrow   = improved ? "↓" : worsened ? "↑" : "→";
  const color   = improved ? "text-positive" : worsened ? "text-negative" : "text-muted";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted w-28 shrink-0">{label}</span>
      <span className="font-mono">{before.toFixed(before > 10 ? 0 : 1)}{unit}</span>
      <span className={`${color} font-mono`}>{arrow}</span>
      {after != null && (
        <span className={`font-mono font-semibold ${color}`}>{after.toFixed(after > 10 ? 0 : 1)}{unit}</span>
      )}
    </div>
  );
}

/* ─────────────── Decision card ─────────────── */

const ACTION_THEME: Record<string, { border: string; bg: string; badge: string; priority: string }> = {
  STRONG_BUY: { border: "border-positive/30",    bg: "bg-positive/5",    badge: "border-positive/50 bg-positive/12 text-positive",      priority: "HIGH" },
  INCREASE:   { border: "border-positive/20",    bg: "bg-positive/3",    badge: "border-positive/40 bg-positive/8 text-positive",        priority: "MEDIUM" },
  HOLD:       { border: "border-border",          bg: "bg-surface",       badge: "border-border text-muted",                             priority: "LOW" },
  REDUCE:     { border: "border-orange-400/30",  bg: "bg-orange-400/5",  badge: "border-orange-400/40 bg-orange-400/10 text-orange-400", priority: "HIGH" },
  SELL:       { border: "border-negative/30",    bg: "bg-negative/5",    badge: "border-negative/40 bg-negative/10 text-negative",       priority: "HIGH" },
};

function DecisionCard({
  rec,
  rank,
  report,
  isFocused,
  cardRef,
}: {
  rec: PositionRecommendation;
  rank: number;
  report: PortfolioReport;
  isFocused: boolean;
  cardRef?: React.Ref<HTMLDivElement>;
}) {
  const theme   = ACTION_THEME[rec.action] ?? ACTION_THEME.HOLD;
  const after   = computeAfterState(report, rec);
  const isRisk  = rec.action === "REDUCE" || rec.action === "SELL";
  const tradeVerb = rec.action === "REDUCE" || rec.action === "SELL" ? "Sell" : "Buy";
  const sharesText = rec.suggestedShares != null && rec.suggestedShares !== 0
    ? `${tradeVerb} ~${Math.abs(rec.suggestedShares)} shares`
    : tradeVerb;

  return (
    <div
      ref={cardRef}
      className={`rounded-xl border p-5 transition-all ${theme.border} ${theme.bg} ${
        isFocused ? "ring-2 ring-accent ring-offset-1 ring-offset-background" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs font-bold text-muted shrink-0">
            {rank}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span className={`rounded-md border px-2.5 py-0.5 text-[11px] font-bold ${theme.badge}`}>
                {ACTION_LABEL[rec.action]}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-widest ${
                theme.priority === "HIGH" ? "text-negative" : theme.priority === "MEDIUM" ? "text-warning" : "text-muted"
              }`}>{theme.priority} PRIORITY</span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className={`font-mono text-sm font-bold ${rec.suggestedDollar >= 0 ? "text-positive" : "text-negative"}`}>
            {rec.suggestedDollar >= 0 ? "+" : ""}{formatCurrency(rec.suggestedDollar)}
          </p>
          <p className="text-[10px] text-muted">{sharesText}</p>
        </div>
      </div>

      {/* Position info */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-mono text-base font-bold">{rec.symbol}</span>
          <span className="text-sm text-muted">{rec.name}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted">
          <span className="font-mono">{rec.currentWeight.toFixed(1)}%</span>
          <span>→</span>
          <span className={`font-mono font-semibold ${rec.delta > 0 ? "text-positive" : "text-negative"}`}>
            {rec.targetWeight.toFixed(1)}%
          </span>
          <span className={`ml-1 font-mono ${rec.delta > 0 ? "text-positive" : "text-negative"}`}>
            ({rec.delta >= 0 ? "+" : ""}{rec.delta.toFixed(1)}pp)
          </span>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        {/* Why */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Why This Matters</p>
          <p className="text-xs leading-5 text-foreground/80">{rec.reasoning}</p>
          {rec.risks.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-muted">Trade-offs</p>
              {rec.risks.slice(0, 2).map((r, i) => (
                <div key={i} className="flex gap-1.5 text-[11px] text-muted">
                  <span className="mt-1 h-1 w-1 rounded-full bg-muted/60 shrink-0" />{r}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Confidence */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Confidence Breakdown</p>
          <div className="space-y-2">
            <ConfidenceBar label="Fundamentals"      value={rec.fundamentalScore} />
            <ConfidenceBar label="Analyst Consensus" value={rec.analystScore} />
            <ConfidenceBar label="Momentum"          value={rec.momentumScore} />
            <ConfidenceBar label="Composite Score"   value={rec.composite} />
          </div>
          <div className="mt-3 pt-2 border-t border-border/50 flex items-center gap-2">
            <span className="text-[10px] text-muted">Overall confidence</span>
            <span className="font-mono text-sm font-bold">{rec.confidence}%</span>
          </div>
        </div>

        {/* Before → After */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted mb-2">Expected Impact</p>
          <div className="space-y-2">
            <BeforeAfterRow
              label="HHI Concentration"
              before={report.risk.hhi}
              after={after.hhi}
              lowerIsBetter
            />
            <BeforeAfterRow
              label="Top Position"
              before={report.risk.topPositionWeight}
              after={isRisk && rec.symbol === report.positions.sort((a, b) => b.weight - a.weight)[0]?.symbol
                ? after.topPos : null}
              unit="%"
              lowerIsBetter
            />
            <BeforeAfterRow
              label="Est. Volatility"
              before={report.risk.annualizedVolatility}
              after={report.risk.annualizedVolatility != null ? report.risk.annualizedVolatility + after.volDelta : null}
              unit="%"
              lowerIsBetter
            />
          </div>
          {rec.catalysts.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border/50">
              <p className="text-[10px] text-muted mb-1">Catalysts</p>
              {rec.catalysts.slice(0, 1).map((c, i) => (
                <p key={i} className="text-[11px] text-foreground/75">{c}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/50">
        <MovementExplainerCard symbol={rec.symbol} />
      </div>
    </div>
  );
}

/* ─────────────── Invest Cash widget ─────────────── */

function InvestCash() {
  const [cash, setCash]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [result, setResult]   = useState<{ symbol: string; name: string; dollarAmount: number; shareCount: number | null; reason: string }[] | null>(null);

  async function compute() {
    const amount = parseFloat(cash.replace(/,/g, "").replace("$", ""));
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a valid dollar amount"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res  = await fetch("/api/portfolio/invest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cashAmount: amount }) });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setResult((json as { allocations: typeof result }).allocations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setLoading(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-sm font-semibold mb-1">Invest New Cash</p>
      <p className="text-xs text-muted mb-4">Intelligently allocate new capital across underweight positions with the highest composite scores.</p>
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm">$</span>
          <input
            value={cash}
            onChange={(e) => setCash(e.target.value)}
            placeholder="10,000"
            className="w-full rounded-lg border border-border bg-surface-2 pl-7 pr-3 py-2 font-mono text-sm outline-none focus:border-accent placeholder:text-muted"
            onKeyDown={(e) => { if (e.key === "Enter") void compute(); }}
          />
        </div>
        <button
          onClick={() => void compute()}
          disabled={loading}
          className="rounded-lg bg-accent-strong px-5 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? "…" : "Allocate"}
        </button>
      </div>
      {error && <p className="text-xs text-negative mb-2">{error}</p>}
      {result && (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {result.map((a, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 bg-surface">
              <div>
                <span className="font-mono font-semibold text-sm text-accent">{a.symbol}</span>
                {a.shareCount != null && a.shareCount > 0 && (
                  <span className="text-xs text-muted ml-2">~{a.shareCount} shares</span>
                )}
                <p className="text-xs text-muted">{a.reason}</p>
              </div>
              <span className="font-mono font-semibold text-positive text-sm">{formatCurrency(a.dollarAmount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Summary stats ─────────────── */

function ActionSummaryStrip({ report, actions }: { report: PortfolioReport; actions: PositionRecommendation[] }) {
  const sells = actions.filter((a) => a.action === "REDUCE" || a.action === "SELL");
  const buys  = actions.filter((a) => a.action === "INCREASE" || a.action === "STRONG_BUY");
  const sellTotal = sells.reduce((s, a) => s + Math.abs(a.suggestedDollar), 0);
  const buyTotal  = buys.reduce((s, a) => s + a.suggestedDollar, 0);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Actions</p>
        <p className="font-mono text-2xl font-bold mt-1">{actions.length}</p>
        <p className="text-[11px] text-muted">{buys.length} buy · {sells.length} sell</p>
      </div>
      <div className="rounded-xl border border-positive/25 bg-positive/5 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Buy Total</p>
        <p className="font-mono text-xl font-bold mt-1 text-positive">{formatCurrency(buyTotal)}</p>
      </div>
      <div className="rounded-xl border border-negative/20 bg-negative/5 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Sell Total</p>
        <p className="font-mono text-xl font-bold mt-1 text-negative">{formatCurrency(sellTotal)}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Est. Risk Reduction</p>
        <p className="font-mono text-xl font-bold mt-1">
          {report.rebalance.estimatedRiskReduction != null
            ? `${report.rebalance.estimatedRiskReduction.toFixed(0)}%`
            : "—"}
        </p>
        <p className="text-[11px] text-muted">Vol reduction</p>
      </div>
    </div>
  );
}

/* ─────────────── Actions Tab ─────────────── */

export function ActionsTab() {
  const { report, reportLoading, focusedSymbol, objective, navigateTo } = usePortfolio();
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (focusedSymbol) {
      const el = cardRefs.current.get(focusedSymbol);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedSymbol]);

  if (reportLoading && !report) {
    return (
      <div className="flex flex-col gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-xl border border-border bg-surface" />
        ))}
      </div>
    );
  }

  if (!report) return null;

  // Decision queue: non-HOLD, ranked by (urgency × |delta|) descending
  // REDUCE/SELL carry extra weight since they reduce active risk
  const urgencyMultiplier = (action: string) =>
    action === "STRONG_BUY" ? 1.5 : action === "SELL" ? 1.8 : action === "REDUCE" ? 1.6 : 1.0;

  const actionQueue = report.recommendations
    .filter((r) => r.action !== "HOLD")
    .sort((a, b) => {
      const scoreA = Math.abs(a.delta) * urgencyMultiplier(a.action) * (a.confidence / 100);
      const scoreB = Math.abs(b.delta) * urgencyMultiplier(b.action) * (b.confidence / 100);
      return scoreB - scoreA;
    });

  const objectiveLabel = objective.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col gap-5">
      {/* Objective context banner */}
      <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent/6 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">Objective</span>
          <span className="text-xs font-semibold text-accent">{objectiveLabel}</span>
          <span className="text-xs text-muted/60">— actions ranked by relevance to your selected goal</span>
        </div>
        <button
          onClick={() => navigateTo("intelligence")}
          className="text-[11px] text-accent hover:underline shrink-0"
        >
          New position ideas →
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-1">Decision Queue</h2>
        <p className="text-xs text-muted">Ranked by urgency × expected impact × confidence. Every action includes quantified before/after portfolio impact.</p>
      </div>

      <ActionSummaryStrip report={report} actions={actionQueue} />

      {actionQueue.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center">
          <p className="text-sm font-semibold">Portfolio is well positioned</p>
          <p className="text-xs text-muted mt-1">No trades recommended at current prices. Monitor for drift or new opportunities.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {actionQueue.map((rec, i) => (
            <DecisionCard
              key={rec.symbol}
              rec={rec}
              rank={i + 1}
              report={report}
              isFocused={focusedSymbol === rec.symbol}
              cardRef={(el) => {
                if (el) cardRefs.current.set(rec.symbol, el);
                else cardRefs.current.delete(rec.symbol);
              }}
            />
          ))}
        </div>
      )}

      <InvestCash />

      {/* HOLD positions summary */}
      {report.recommendations.filter((r) => r.action === "HOLD").length > 0 && (
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Hold — No Action Needed</p>
          <div className="flex flex-wrap gap-2">
            {report.recommendations
              .filter((r) => r.action === "HOLD")
              .map((r) => (
                <span key={r.symbol} className="rounded-lg border border-border px-3 py-1.5 text-xs">
                  <span className="font-mono font-semibold">{r.symbol}</span>
                  <span className="text-muted ml-2">{r.currentWeight.toFixed(1)}%</span>
                  <span className="text-muted ml-1">· score {r.composite}</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
