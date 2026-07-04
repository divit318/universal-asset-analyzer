"use client";

import { usePortfolio } from "@/lib/portfolio-context";
import type { PortfolioReport, PortfolioAlert, PositionRecommendation, FactorTilt } from "@/lib/portfolio-analytics";
import { formatCurrency } from "@/lib/format";
import { ACTION_LABEL } from "@/lib/portfolio-analytics";
import { AIPortfolioBrief } from "./ai-portfolio-brief";
import { PortfolioHealth, PortfolioHealthSkeleton } from "./portfolio-health";

/* ─────────────── Status derivation ─────────────── */

type PortfolioStatus = "healthy" | "watch" | "action";

function deriveStatus(report: PortfolioReport): PortfolioStatus {
  const highAlerts = report.alerts.filter((a) => a.severity === "high").length;
  if (highAlerts >= 2 || report.health.total < 55) return "action";
  if (highAlerts >= 1 || report.health.total < 70) return "watch";
  return "healthy";
}

const STATUS_CONFIG: Record<PortfolioStatus, { label: string; dot: string; bg: string; text: string; border: string }> = {
  healthy: { label: "Portfolio Healthy",  dot: "bg-positive",  bg: "bg-positive/8",  text: "text-positive",  border: "border-positive/20"  },
  watch:   { label: "Portfolio Watch",    dot: "bg-warning", bg: "bg-warning/8", text: "text-warning", border: "border-warning/20" },
  action:  { label: "Action Required",   dot: "bg-negative",  bg: "bg-negative/8",  text: "text-negative",  border: "border-negative/20"  },
};

/* ─────────────── Status Banner ─────────────── */

function StatusBanner({ report }: { report: PortfolioReport }) {
  const status = deriveStatus(report);
  const cfg    = STATUS_CONFIG[status];
  const highCount   = report.alerts.filter((a) => a.severity === "high").length;
  const medCount    = report.alerts.filter((a) => a.severity === "medium").length;
  const actionCount = report.recommendations.filter((r) => r.action !== "HOLD").length;

  const headline =
    status === "healthy"
      ? `All systems nominal — ${actionCount} opportunit${actionCount === 1 ? "y" : "ies"} available`
      : status === "watch"
        ? `${medCount} item${medCount !== 1 ? "s" : ""} need${medCount === 1 ? "s" : ""} attention — no urgent risks`
        : `${highCount} high-priority action${highCount !== 1 ? "s" : ""} required — concentration risk elevated`;

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-5 py-3 ${cfg.bg} ${cfg.border}`}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot} shrink-0`} />
      <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
      <span className="text-muted text-sm">—</span>
      <span className="text-sm text-foreground/80">{headline}</span>
    </div>
  );
}

/* ─────────────── Priority Action Card ─────────────── */

const ACTION_STYLE: Record<string, { badge: string; accent: string }> = {
  STRONG_BUY: { badge: "border-positive/50 bg-positive/12 text-positive",         accent: "border-positive/25 bg-positive/5"    },
  INCREASE:   { badge: "border-positive/40 bg-positive/8 text-positive",           accent: "border-positive/20 bg-positive/3"    },
  HOLD:       { badge: "border-warning/40 bg-warning/8 text-warning",        accent: "border-border bg-surface"             },
  REDUCE:     { badge: "border-orange-400/40 bg-orange-400/10 text-orange-400",    accent: "border-orange-400/20 bg-orange-400/5" },
  SELL:       { badge: "border-negative/40 bg-negative/10 text-negative",          accent: "border-negative/20 bg-negative/5"     },
};

function ConfidenceMiniBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const color = value >= 70 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-muted";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="font-mono text-[10px] text-foreground/70 w-6 text-right">{value}</span>
    </div>
  );
}

function PriorityActionCard({
  rec, rank, report,
}: {
  rec: PositionRecommendation;
  rank: number;
  report: PortfolioReport;
}) {
  const { navigateTo } = usePortfolio();
  const style = ACTION_STYLE[rec.action] ?? ACTION_STYLE.HOLD;

  const pos = report.positions.find((p) => p.symbol === rec.symbol);
  const posValue = pos?.value ?? 0;
  const newPosValue = Math.max(0, posValue + rec.suggestedDollar);
  const newTotal = report.totalValue + Math.max(0, rec.suggestedDollar) - Math.max(0, -rec.suggestedDollar);
  const newWeight = newTotal > 0 ? (newPosValue / newTotal) * 100 : 0;
  void newWeight;

  const hhiDelta  = Math.round(newWeight * newWeight - rec.currentWeight * rec.currentWeight);
  const isRisk    = rec.action === "REDUCE" || rec.action === "SELL";
  const isOpport  = rec.action === "STRONG_BUY" || rec.action === "INCREASE";
  const impactLine = isRisk
    ? `Reduces concentration · HHI ${hhiDelta < 0 ? "↓" : "↑"} ${Math.abs(hhiDelta)} pts`
    : isOpport
      ? `Improves quality exposure · composite score ${rec.composite}/100`
      : "Maintain current position";

  return (
    <div className={`rounded-xl border p-4 ${style.accent}`}>
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 border border-border font-mono text-xs font-bold text-muted">
            {rank}
          </span>
          <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold shrink-0 ${style.badge}`}>
            {ACTION_LABEL[rec.action]}
          </span>
          <span className="font-mono font-bold text-sm shrink-0">{rec.symbol}</span>
        </div>
        <p className="font-mono text-xs text-muted whitespace-nowrap shrink-0">
          {rec.currentWeight.toFixed(1)}% → <span className="font-semibold text-foreground">{rec.targetWeight.toFixed(1)}%</span>
        </p>
      </div>
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <p className="text-xs text-muted truncate min-w-0">{rec.name}</p>
        <p className={`font-mono text-xs font-semibold whitespace-nowrap shrink-0 ${rec.suggestedDollar > 0 ? "text-positive" : "text-negative"}`}>
          {rec.suggestedDollar > 0 ? "+" : ""}{formatCurrency(rec.suggestedDollar)}
        </p>
      </div>

      <p className="text-xs text-foreground/75 leading-5 mb-2.5 line-clamp-2">{rec.reasoning.split(".")[0]}.</p>

      <div className="space-y-1 mb-3">
        <ConfidenceMiniBar label="Fundamentals" value={rec.fundamentalScore} />
        <ConfidenceMiniBar label="Analyst"      value={rec.analystScore} />
        <ConfidenceMiniBar label="Momentum"     value={rec.momentumScore} />
      </div>

      <p className="text-[10px] text-muted mb-3">{impactLine}</p>

      <div className="flex gap-2">
        <button
          onClick={() => navigateTo("holdings", { symbol: rec.symbol })}
          className="flex-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 transition-colors"
        >
          Inspect Holdings
        </button>
        <button
          onClick={() => navigateTo("actions", { symbol: rec.symbol })}
          className="flex-1 rounded-lg bg-accent-strong px-3 py-1.5 text-xs font-medium text-background hover:opacity-90 transition-opacity"
        >
          See Trade →
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Portfolio DNA ─────────────── */

const STYLE_BENCHMARKS: { name: string; ticker: string; factors: Record<string, number> }[] = [
  { name: "Nasdaq 100",       ticker: "QQQ",  factors: { Innovation: 82, Growth: 80, Quality: 68, Value: 22, Income: 12 } },
  { name: "S&P 500",          ticker: "SPY",  factors: { Innovation: 50, Growth: 55, Quality: 60, Value: 50, Income: 42 } },
  { name: "Berkshire",        ticker: "BRK",  factors: { Innovation: 22, Growth: 38, Quality: 92, Value: 82, Income: 55 } },
  { name: "ARK Innovation",   ticker: "ARKK", factors: { Innovation: 95, Growth: 90, Quality: 25, Value: 8,  Income: 5  } },
  { name: "Dividend Growth",  ticker: "VYM",  factors: { Innovation: 18, Growth: 38, Quality: 72, Value: 68, Income: 90 } },
];

function tiltsToIdentity(tilts: FactorTilt[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tilts) out[t.factor] = Math.round((t.score + 100) / 2);
  return out;
}

function styleDistance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Object.keys(b);
  let sum = 0;
  for (const k of keys) {
    const av = a[k] ?? 50;
    const bv = b[k] ?? 50;
    sum += (av - bv) ** 2;
  }
  return Math.sqrt(sum / keys.length);
}

function closestStyle(identity: Record<string, number>) {
  return STYLE_BENCHMARKS.reduce((best, s) => {
    const d = styleDistance(identity, s.factors);
    return d < best.dist ? { style: s, dist: d } : best;
  }, { style: STYLE_BENCHMARKS[0], dist: Infinity }).style;
}

function dnaLabel(identity: Record<string, number>): string {
  const inn = identity["Innovation"] ?? 50;
  const grw = identity["Growth"] ?? 50;
  const qlt = identity["Quality"] ?? 50;
  const val = identity["Value"] ?? 50;
  const inc = identity["Income"] ?? 50;

  if (inn > 70 && grw > 65) return "Aggressive Innovation Growth";
  if (grw > 65 && qlt > 60) return "Quality Growth";
  if (val > 65 && qlt > 65) return "Quality Value";
  if (inc > 65)              return "Income & Dividend";
  if (qlt > 70)              return "Quality Compounders";
  if (grw > 60)              return "Growth Oriented";
  return "Balanced All-Weather";
}

const DNA_ORDER = ["Innovation", "Growth", "Quality", "Momentum", "Value", "Low Volatility", "Income"];

function PortfolioDNA({ tilts }: { tilts: FactorTilt[] }) {
  const identity = tiltsToIdentity(tilts);
  const closest  = closestStyle(identity);
  const label    = dnaLabel(identity);

  const ordered = DNA_ORDER
    .map((name) => ({ name, score: identity[name] ?? 50 }))
    .filter((d) => Math.abs(d.score - 50) > 3 || DNA_ORDER.indexOf(d.name) < 4);

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">Portfolio DNA</p>
        <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted">
          ≈ {closest.ticker}
        </span>
      </div>
      <p className="text-sm font-semibold mb-3">{label}</p>

      <div className="space-y-2">
        {ordered.map(({ name, score }) => {
          const delta = score - 50;
          const isPos = delta >= 0;
          const barWidth = Math.min(Math.abs(delta) * 2, 100);
          const color = isPos
            ? score > 70 ? "bg-positive" : "bg-accent/70"
            : "bg-muted/50";

          return (
            <div key={name} className="flex items-center gap-2">
              <span className="text-[10px] text-muted w-20 shrink-0 text-right">{name}</span>
              <div className="flex flex-1 items-center">
                <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{
                      width: `${barWidth}%`,
                      marginLeft: isPos ? "50%" : `${50 - barWidth}%`,
                    }}
                  />
                </div>
              </div>
              <span className={`font-mono text-[10px] w-5 text-right shrink-0 ${isPos ? "text-positive" : "text-muted"}`}>
                {isPos ? "+" : ""}{delta}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border">
        {STYLE_BENCHMARKS.map((s) => {
          const d   = styleDistance(identity, s.factors);
          const sim = Math.max(0, Math.round(100 - d * 0.8));
          const isTop = s.name === closest.name;
          return (
            <span
              key={s.ticker}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                isTop
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-muted"
              }`}
            >
              {s.ticker} {sim}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── Change Feed ─────────────── */

function ChangeFeed({ report }: { report: PortfolioReport }) {
  const sorted = [...report.positions].sort(
    (a, b) => Math.abs(b.todayChangePct ?? 0) - Math.abs(a.todayChangePct ?? 0)
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted mb-3">Today&apos;s Moves</p>
      <div className="space-y-2">
        {sorted.slice(0, 6).map((p) => {
          const pct   = p.todayChangePct ?? 0;
          const isPos = pct >= 0;
          const color = isPos ? "text-positive" : "text-negative";
          const dot   = isPos ? "bg-positive/70" : "bg-negative/70";
          const rec   = report.recommendations.find((r) => r.symbol === p.symbol);
          const hasAction = rec && rec.action !== "HOLD";

          return (
            <div key={p.symbol} className="flex items-center gap-2.5">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
              <span className="font-mono text-xs font-semibold w-10 shrink-0">{p.symbol}</span>
              <span className={`font-mono text-xs font-semibold w-14 ${color}`}>
                {pct >= 0 ? "+" : ""}{pct.toFixed(2)}%
              </span>
              {hasAction && (
                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${ACTION_STYLE[rec.action].badge}`}>
                  {ACTION_LABEL[rec.action]}
                </span>
              )}
              <span className="text-[10px] text-muted truncate">
                {p.unrealizedPct != null
                  ? `${p.unrealizedPct >= 0 ? "+" : ""}${p.unrealizedPct.toFixed(1)}% total`
                  : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────── Alert Row ─────────────── */

function AlertRow({ alert }: { alert: PortfolioAlert }) {
  const dot = alert.severity === "high" ? "bg-negative" : alert.severity === "medium" ? "bg-warning" : "bg-muted";
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-2.5">
      <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{alert.title}</span>
        <span className="ml-2 text-xs text-muted">{alert.description}</span>
      </div>
      <span className="text-xs text-muted shrink-0">{alert.action.split(".")[0]}</span>
    </div>
  );
}

/* ─────────────── Main Brief Tab ─────────────── */

export function BriefTab() {
  const { report, reportLoading, navigateTo } = usePortfolio();

  if (reportLoading && !report) {
    return (
      <div className="flex flex-col gap-4">
        {[40, 180, 200, 200, 160].map((h, i) => (
          <div key={i} className="animate-pulse rounded-xl border border-border bg-surface" style={{ height: h }} />
        ))}
        <PortfolioHealthSkeleton />
      </div>
    );
  }

  if (!report) return null;

  const priorityActions = report.recommendations
    .filter((r) => r.action !== "HOLD")
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-4">
      {/* Portfolio status indicator */}
      <StatusBanner report={report} />

      {/* AI Portfolio Intelligence Brief — auto-loads from local Ollama */}
      <AIPortfolioBrief
        context={{
          health:      report.health.total,
          grade:       report.health.grade,
          actionCount: priorityActions.length,
          topSymbol:   priorityActions[0]?.symbol,
          topAction:   priorityActions[0]?.action,
        }}
      />

      {/* Priority actions */}
      {priorityActions.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Priority Actions</h2>
            <button
              onClick={() => navigateTo("actions")}
              className="text-xs text-accent hover:underline"
            >
              Full decision queue →
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {priorityActions.map((rec, i) => (
              <PriorityActionCard key={rec.symbol} rec={rec} rank={i + 1} report={report} />
            ))}
          </div>
        </div>
      )}

      {/* Portfolio Health Score with SVG ring + all dimensions */}
      <PortfolioHealth health={report.health} />

      {/* DNA + Today's Moves side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PortfolioDNA tilts={report.factors.tilts} />
        <ChangeFeed report={report} />
      </div>

      {/* Active Alerts */}
      {report.alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Active Alerts</h2>
          {report.alerts.slice(0, 4).map((alert, i) => (
            <AlertRow key={i} alert={alert} />
          ))}
          {report.alerts.length > 4 && (
            <button
              onClick={() => navigateTo("intelligence")}
              className="text-xs text-accent text-left hover:underline"
            >
              +{report.alerts.length - 4} more alerts — view in Intelligence →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
