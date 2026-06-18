"use client";

import { useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScorecardRow {
  symbol: string;
  date: string;
  momentum_score: number;
  quality_score: number;
  value_score: number;
  regime_score: number;
  forecast_score: number;
  mc_upside: number;
  kelly_fraction: number;
  composite_score: number;
  signal: string;
  confidence: number;
}

interface RegimePoint {
  date: string;
  regime_label: string;
  prob_bull: number;
  prob_bear: number;
  prob_range: number;
  prob_crash: number;
  prob_recovery: number;
}

interface ForecastRow {
  horizon_days: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  prob_up: number;
}

interface McRow {
  intrinsic_p10: number;
  intrinsic_p25: number;
  intrinsic_p50: number;
  intrinsic_p75: number;
  intrinsic_p90: number;
  wacc: number;
  terminal_growth: number;
}

interface FundamentalsRow {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  forward_pe: number | null;
  ev_to_ebitda: number | null;
  revenue_growth_yoy: number | null;
  revenue_cagr_3y: number | null;
  eps_growth_yoy: number | null;
  eps_cagr_3y: number | null;
  roic: number | null;
  roe: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  debt_to_equity: number | null;
  net_debt_to_ebitda: number | null;
  current_ratio: number | null;
  fcf_margin: number | null;
  fcf_growth_yoy: number | null;
  dividend_yield: number | null;
  buyback_yield: number | null;
  institutional_ownership: number | null;
  earnings_surprise_pct: number | null;
  ebitda: number | null;
  free_cashflow: number | null;
}

interface FeatureRow { feature: string; value: number; }
interface FactorPoint { date: string; momentum: number; quality: number; value: number; low_vol: number; revision: number; composite: number; }
interface PricePoint { date: string; close: number; volume: number; }

interface DetailData {
  symbol: string;
  scorecard: ScorecardRow | null;
  regime_history: RegimePoint[];
  forecasts: ForecastRow[];
  mc: McRow | null;
  fundamentals: FundamentalsRow | null;
  features: FeatureRow[];
  factor_history: FactorPoint[];
  prices: PricePoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SIGNAL_COLOR: Record<string, string> = {
  STRONG_BUY:  "text-emerald-400",
  BUY:         "text-positive",
  HOLD:        "text-amber-400",
  SELL:        "text-negative",
  STRONG_SELL: "text-red-500",
};
const SIGNAL_BG: Record<string, string> = {
  STRONG_BUY:  "bg-emerald-400/10 border-emerald-400/30",
  BUY:         "bg-positive/10 border-positive/30",
  HOLD:        "bg-amber-400/10 border-amber-400/30",
  SELL:        "bg-negative/10 border-negative/30",
  STRONG_SELL: "bg-red-500/10 border-red-500/30",
};

const FACTOR_META: Record<string, { label: string; desc: string; formula: string }> = {
  momentum_score: {
    label: "Momentum",
    desc: "Jegadeesh-Titman 12-1 month. Skips most recent month to avoid reversal.",
    formula: "ret(252d) − ret(21d)  →  cross-sectional z-score",
  },
  quality_score: {
    label: "Quality",
    desc: "QMJ composite (Asness 2019). Profitability 40% · Safety 30% · Growth 20% · Payout 10%.",
    formula: "z(ROE, ROIC, margins, leverage, CAGR)  →  within-group avg  →  z-score",
  },
  value_score: {
    label: "Value",
    desc: "All metrics converted to yield space before averaging — avoids PE vs EV/EBITDA scale mismatch.",
    formula: "mean(1/PE, 1/EV_EBITDA, FCF_yield, div_yield)  →  z-score",
  },
  regime_score: {
    label: "Regime",
    desc: "HMM posterior probability-weighted expected return. E[R] = Σ P(regime_i) × μ_i.",
    formula: "Σ P(state) × annualised_μ(state)  /  max_μ  →  normalised to [−3, 3]",
  },
  forecast_score: {
    label: "Forecast",
    desc: "LightGBM quantile regression P(return > 0), calibrated via Gaussian IQR fit.",
    formula: "(prob_up − 0.5) × 2  →  [−1, 1]",
  },
};

const REGIME_COLORS: Record<string, string> = {
  Bull:     "#22c55e",
  Bear:     "#ef4444",
  Range:    "#f59e0b",
  Crash:    "#dc2626",
  Recovery: "#3b82f6",
};

const HORIZON_LABEL: Record<number, string> = {
  5: "1w", 10: "2w", 21: "1m", 63: "3m", 126: "6m",
};

// ---------------------------------------------------------------------------
// Micro components
// ---------------------------------------------------------------------------

function ZBar({ value, max = 3 }: { value: number; max?: number }) {
  const pct = ((Math.max(-max, Math.min(max, value)) + max) / (2 * max)) * 100;
  const color = value >= 0.5 ? "bg-positive" : value <= -0.5 ? "bg-negative" : "bg-amber-400";
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="relative h-1.5 w-20 shrink-0 rounded-full bg-surface-2">
        <div className="absolute left-1/2 h-full w-px bg-border" />
        <div
          className={`absolute h-full rounded-full ${color}`}
          style={value >= 0
            ? { left: "50%", width: `${(pct - 50)}%` }
            : { left: `${pct}%`, width: `${50 - pct}%` }
          }
        />
      </div>
      <span className="font-mono text-xs tabular-nums">{value >= 0 ? "+" : ""}{value.toFixed(3)}</span>
    </div>
  );
}

function Pct({ v, digits = 1 }: { v: number | null; digits?: number }) {
  if (v == null || !isFinite(v)) return <span className="text-muted">—</span>;
  const color = v >= 0 ? "text-positive" : "text-negative";
  return <span className={`font-mono tabular-nums ${color}`}>{v >= 0 ? "+" : ""}{v.toFixed(digits)}%</span>;
}

function Num({ v, digits = 2, suffix = "" }: { v: number | null; digits?: number; suffix?: string }) {
  if (v == null || !isFinite(v)) return <span className="text-muted">—</span>;
  return <span className="font-mono tabular-nums">{v.toFixed(digits)}{suffix}</span>;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted">{children}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// Tiny sparkline via SVG
function Sparkline({ data, color = "#6366f1" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80; const h = 24;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
}

// Probability fan chart for forecast distribution
function FanChart({ row }: { row: ForecastRow }) {
  const fmt = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`;
  const probPct = Math.round(row.prob_up * 100);
  const barColor = row.prob_up > 0.55 ? "bg-positive" : row.prob_up < 0.45 ? "bg-negative" : "bg-amber-400";
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-semibold text-foreground">{HORIZON_LABEL[row.horizon_days] ?? `${row.horizon_days}d`}</span>
        <span className={`font-mono text-xs ${row.prob_up > 0.5 ? "text-positive" : "text-negative"}`}>
          P↑ {probPct}%
        </span>
      </div>
      {/* prob_up bar */}
      <div className="h-1 w-full rounded-full bg-surface">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${probPct}%` }} />
      </div>
      {/* quantile table */}
      <div className="grid grid-cols-5 gap-0.5 text-center text-xs">
        {(["p10","p25","p50","p75","p90"] as const).map((k) => (
          <div key={k} className="flex flex-col gap-0.5">
            <span className="text-muted">{k}</span>
            <span className={`font-mono tabular-nums ${(row[k] ?? 0) >= 0 ? "text-positive" : "text-negative"}`}>
              {fmt(row[k] ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Regime posterior bar
function RegimeBar({ label, prob }: { label: string; prob: number }) {
  const color = REGIME_COLORS[label] ?? "#888";
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted">{label}</span>
      <div className="relative h-3 flex-1 rounded-sm bg-surface-2 overflow-hidden">
        <div className="h-full rounded-sm transition-all" style={{ width: `${prob * 100}%`, backgroundColor: color, opacity: 0.8 }} />
      </div>
      <span className="w-12 text-right font-mono text-xs tabular-nums">{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel — full mathematical working for one symbol
// ---------------------------------------------------------------------------

function DetailPanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [featTab, setFeatTab] = useState<"all" | "vol" | "momentum" | "stat">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/engine/detail?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setData(json as DetailData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  // Load on mount
  useState(() => { void load(); });

  const sc = data?.scorecard;
  const fund = data?.fundamentals;
  const mc = data?.mc;
  const latestRegime = data?.regime_history?.[0];
  const factorSeries = [...(data?.factor_history ?? [])].reverse();

  const filteredFeatures = data?.features.filter((f) => {
    if (featTab === "vol")      return f.feature.includes("vol") || f.feature.includes("atr");
    if (featTab === "momentum") return f.feature.includes("return") || f.feature.includes("momentum") || f.feature.includes("rsi");
    if (featTab === "stat")     return f.feature.includes("vr_") || f.feature.includes("ou_") || f.feature.includes("hurst") || f.feature.includes("reg_");
    return true;
  }) ?? [];

  return (
    <div className="flex flex-col gap-0 rounded-xl border border-border bg-surface">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Link href={`/stocks/${symbol}`} className="font-mono font-semibold text-accent hover:underline">
            {symbol}
          </Link>
          {fund?.name && <span className="text-sm text-muted">{fund.name}</span>}
          {fund?.sector && <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{fund.sector}</span>}
          {sc && (
            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${SIGNAL_BG[sc.signal] ?? ""} ${SIGNAL_COLOR[sc.signal] ?? ""}`}>
              {sc.signal.replace("_", " ")}
            </span>
          )}
        </div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground">✕</button>
      </div>

      {loading && (
        <div className="px-5 py-8 text-center text-sm text-muted">Loading mathematical detail…</div>
      )}
      {error && (
        <div className="px-5 py-4 text-sm text-negative">{error}</div>
      )}

      {data && !loading && (
        <div className="grid gap-6 p-5 md:grid-cols-2">

          {/* ── Col 1 ── */}
          <div className="flex flex-col gap-6">

            {/* Factor z-scores */}
            <div className="flex flex-col gap-3">
              <SectionHeader>Factor z-scores (cross-sectional)</SectionHeader>
              {sc && Object.entries(FACTOR_META).map(([key, meta]) => {
                const val = sc[key as keyof ScorecardRow] as number;
                return (
                  <div key={key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <ZBar value={val} />
                    </div>
                    <p className="text-xs text-muted">{meta.desc}</p>
                    <code className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted">{meta.formula}</code>
                  </div>
                );
              })}
              {sc && (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">Composite</span>
                    <span className="text-xs text-muted">IC-weighted Σ wᵢ · zᵢ + 0.10 · MC_upside</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ZBar value={sc.composite_score} />
                    <span className="font-mono text-xs text-muted">conf {(sc.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
            </div>

            {/* Factor history sparklines */}
            {factorSeries.length > 0 && (
              <div className="flex flex-col gap-2">
                <SectionHeader>Factor history (90d sparklines)</SectionHeader>
                <div className="grid grid-cols-2 gap-2">
                  {(["momentum","quality","value","low_vol","revision","composite"] as const).map((k) => {
                    const vals = factorSeries.map((r) => r[k] ?? 0);
                    const last = vals[vals.length - 1];
                    const color = last >= 0 ? "#22c55e" : "#ef4444";
                    return (
                      <div key={k} className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs capitalize text-muted">{k.replace("_"," ")}</span>
                          <span className={`font-mono text-xs ${last >= 0 ? "text-positive" : "text-negative"}`}>
                            {last >= 0 ? "+" : ""}{last.toFixed(3)}
                          </span>
                        </div>
                        <Sparkline data={vals} color={color} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Regime */}
            {(data.regime_history.length > 0) && (
              <div className="flex flex-col gap-3">
                <SectionHeader>HMM Regime Posteriors</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  5-state Gaussian HMM trained on [log_return, realised_vol_5d, log_vol_ratio]. Baum-Welch EM.
                  State labels assigned by sorting mean return across states.
                </div>
                {latestRegime && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Current:</span>
                      <span
                        className="rounded px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: (REGIME_COLORS[latestRegime.regime_label] ?? "#888") + "22", color: REGIME_COLORS[latestRegime.regime_label] ?? "#888" }}
                      >
                        {latestRegime.regime_label}
                      </span>
                      <span className="text-xs text-muted">{latestRegime.date?.slice(0, 10)}</span>
                    </div>
                    {(["Bull","Bear","Range","Crash","Recovery"] as const).map((label) => {
                      const key = `prob_${label.toLowerCase()}` as keyof RegimePoint;
                      const prob = (latestRegime[key] as number) ?? 0;
                      return <RegimeBar key={label} label={label} prob={prob} />;
                    })}
                    <div className="mt-1 rounded bg-surface-2 px-2 py-1 text-xs text-muted">
                      Regime score = Σ P(state) × μ(state) / max_μ &nbsp;·&nbsp;
                      μ: Bull +18% / Bear −12% / Range +4% / Crash −35% / Recovery +22% (annualised)
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Col 2 ── */}
          <div className="flex flex-col gap-6">

            {/* Forecast distributions */}
            {data.forecasts.length > 0 && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Probabilistic Forecasts (Quantile Regression)</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  LightGBM quantile regression (α ∈ {"{0.10,0.25,0.50,0.75,0.90}"}). Walk-forward train/test split.
                  P↑ derived from Gaussian IQR fit: σ ≈ IQR/1.349, P(X&gt;0) = Φ(p50/σ).
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {data.forecasts.map((fc) => <FanChart key={fc.horizon_days} row={fc} />)}
                </div>
              </div>
            )}

            {/* MC Valuation */}
            {mc && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Monte Carlo DCF Valuation</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  50,000 paths. OU revenue growth (θ=0.30, σ=0.08, μ_lr=5%). FCF margin noise σ=0.05.
                  Year-level GBM shock exp(0.12ε − 0.0072). Terminal: Gordon Growth Model. WACC = CAPM.
                </div>
                <div className="grid grid-cols-5 gap-1 rounded-lg border border-border bg-surface p-3">
                  {(["intrinsic_p10","intrinsic_p25","intrinsic_p50","intrinsic_p75","intrinsic_p90"] as const).map((k, i) => {
                    const labels = ["P10","P25","P50","P75","P90"];
                    const v = mc[k];
                    return (
                      <div key={k} className="flex flex-col items-center gap-1">
                        <span className="text-xs text-muted">{labels[i]}</span>
                        <span className={`font-mono text-sm font-semibold ${i === 2 ? "text-foreground" : "text-muted"}`}>
                          ${v != null ? v.toFixed(0) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                    <span className="text-muted">WACC</span>
                    <span className="font-mono">{(mc.wacc * 100).toFixed(2)}%</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                    <span className="text-muted">Terminal g</span>
                    <span className="font-mono">{(mc.terminal_growth * 100).toFixed(2)}%</span>
                  </div>
                  {sc && (
                    <div className="col-span-2 flex items-center justify-between rounded border border-border bg-surface-2 px-3 py-2">
                      <span className="text-muted">Upside to P50</span>
                      <Pct v={sc.mc_upside * 100} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Kelly sizing */}
            {sc && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Kelly Position Sizing</SectionHeader>
                <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                  Fractional Kelly (0.25×): f = 0.25 × (p·b − q) / b, capped at 15%.
                  b = |p50 return| / |p50 return × 0.5|. p = prob_up from 21d forecast.
                </div>
                <div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-4">
                  <div className="flex flex-col">
                    <span className="text-2xl font-semibold font-mono">{(sc.kelly_fraction * 100).toFixed(1)}%</span>
                    <span className="text-xs text-muted">suggested position size</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted">0%</span><span className="text-muted">15% max</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-2">
                      <div
                        className={`h-full rounded-full ${sc.kelly_fraction > 0.08 ? "bg-positive" : sc.kelly_fraction > 0.03 ? "bg-amber-400" : "bg-muted"}`}
                        style={{ width: `${(sc.kelly_fraction / 0.15) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Fundamentals */}
            {fund && (
              <div className="flex flex-col gap-3">
                <SectionHeader>Fundamentals (Factor Inputs)</SectionHeader>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {([
                    ["Forward PE",    fund.forward_pe,            "x"],
                    ["EV/EBITDA",     fund.ev_to_ebitda,          "x"],
                    ["Rev Growth",    fund.revenue_growth_yoy,    "%"],
                    ["Rev CAGR 3y",   fund.revenue_cagr_3y,       "%"],
                    ["EPS Growth",    fund.eps_growth_yoy,        "%"],
                    ["EPS CAGR 3y",   fund.eps_cagr_3y,           "%"],
                    ["ROIC",          fund.roic,                  "%"],
                    ["ROE",           fund.roe,                   "%"],
                    ["Gross Margin",  fund.gross_margin,          "%"],
                    ["Op. Margin",    fund.operating_margin,      "%"],
                    ["FCF Margin",    fund.fcf_margin,            "%"],
                    ["D/E",           fund.debt_to_equity,        "x"],
                    ["Net Debt/EBITDA", fund.net_debt_to_ebitda,  "x"],
                    ["Current Ratio", fund.current_ratio,         "x"],
                    ["Div Yield",     fund.dividend_yield,        "%"],
                    ["Buyback Yield", fund.buyback_yield,         "%"],
                    ["Inst. Ownership", fund.institutional_ownership, "%"],
                    ["EPS Surprise",  fund.earnings_surprise_pct, "%"],
                  ] as [string, number | null, string][]).map(([label, v, suffix]) => (
                    <div key={label} className="flex items-center justify-between border-b border-border/40 py-1">
                      <span className="text-muted">{label}</span>
                      {v != null && isFinite(v)
                        ? <span className="font-mono tabular-nums">{v.toFixed(2)}{suffix}</span>
                        : <span className="text-muted">—</span>
                      }
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Full-width: Feature values ── */}
          <div className="col-span-full flex flex-col gap-3">
            <SectionHeader>Latest Feature Values (from price history)</SectionHeader>
            <div className="flex gap-1">
              {(["all","momentum","vol","stat"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setFeatTab(t)}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${featTab === t ? "bg-accent/20 text-accent" : "text-muted hover:bg-surface-2"}`}
                >
                  {t === "all" ? "All" : t === "momentum" ? "Momentum/Returns" : t === "vol" ? "Volatility" : "Statistical"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3 lg:grid-cols-4">
              {filteredFeatures.map((f) => (
                <div key={f.feature} className="flex items-center justify-between border-b border-border/30 py-1">
                  <span className="truncate font-mono text-xs text-muted">{f.feature}</span>
                  <span className={`font-mono tabular-nums ${f.value >= 0 ? "text-foreground" : "text-negative"}`}>
                    {f.value.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main scorecard page
// ---------------------------------------------------------------------------

export default function EnginePage() {
  const [scorecard, setScorecard]     = useState<ScorecardRow[]>([]);
  const [loading, setLoading]         = useState(false);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [runLog, setRunLog]           = useState<string | null>(null);
  const [symbolFilter, setSymbolFilter] = useState("");
  const [signalFilter, setSignalFilter] = useState("ALL");
  const [sortCol, setSortCol]         = useState<keyof ScorecardRow>("composite_score");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [selectedUniverse, setSelectedUniverse] = useState("nifty50");

  async function loadScorecard() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/engine");
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Failed");
      setScorecard((json as { scorecard: ScorecardRow[] }).scorecard);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setLoading(false); }
  }

  async function runEngine(noForecast: boolean) {
    setRunning(true); setRunLog(null); setError(null);
    try {
      const res = await fetch("/api/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe: selectedUniverse, noFetch: false, noForecast }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "Engine failed");
      setRunLog((json as { stdout?: string }).stdout ?? "Done.");
      await loadScorecard();
    } catch (e) { setError(e instanceof Error ? e.message : "Engine failed"); }
    finally { setRunning(false); }
  }

  function toggleSort(col: keyof ScorecardRow) {
    if (sortCol === col) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortCol(col); setSortDir("desc"); }
  }

  const filtered = scorecard
    .filter((r) => {
      if (signalFilter !== "ALL" && r.signal !== signalFilter) return false;
      if (symbolFilter && !r.symbol.includes(symbolFilter.toUpperCase())) return false;
      return true;
    })
    .sort((a, b) => {
      const av = typeof a[sortCol] === "number" ? (a[sortCol] as number) : 0;
      const bv = typeof b[sortCol] === "number" ? (b[sortCol] as number) : 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });

  const COLS: [keyof ScorecardRow, string][] = [
    ["composite_score", "Composite"],
    ["momentum_score",  "Momentum z"],
    ["quality_score",   "Quality z"],
    ["value_score",     "Value z"],
    ["regime_score",    "Regime"],
    ["forecast_score",  "Forecast"],
    ["mc_upside",       "MC Upside"],
    ["kelly_fraction",  "Kelly"],
  ];

  const signals = ["ALL","STRONG_BUY","BUY","HOLD","SELL","STRONG_SELL"];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-xs text-accent">quant/engine</p>
          <h1 className="text-2xl font-semibold tracking-tight">Systematic Scorecard</h1>
          <p className="text-sm text-muted">
            10-factor quantitative scoring across Nifty 50, Indian large/mid/small-cap,
            US markets, ETFs, and mutual funds. Universe fetched live via screener.
            Click any row for full mathematical working — regime, forecasts, MC valuation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedUniverse}
            onChange={(e) => setSelectedUniverse(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <optgroup label="India">
              <option value="nifty50">Nifty 50</option>
              <option value="india_largecap">India Large-Cap (~100)</option>
              <option value="india_midcap">India Mid-Cap (~100)</option>
              <option value="india_smallcap">India Small-Cap (~100)</option>
              <option value="full_india">India Large + Mid (~200)</option>
              <option value="india_best">India Best Recommendations (~200) ★</option>
            </optgroup>
            <optgroup label="US">
              <option value="us_largecap">US Large-Cap (~100)</option>
              <option value="us_midcap">US Mid-Cap (~100)</option>
              <option value="us_smallcap">US Small-Cap (~100)</option>
              <option value="us_growth">US Growth Tech (~80)</option>
              <option value="full_us">US Full (~250)</option>
            </optgroup>
            <optgroup label="Funds">
              <option value="etf">ETFs (~50)</option>
              <option value="mf">Mutual Funds (~30)</option>
            </optgroup>
            <optgroup label="Global">
              <option value="global">Global US + India (~220)</option>
            </optgroup>
          </select>
          <button onClick={loadScorecard} disabled={loading}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
            {loading ? "Loading…" : "Load Scorecard"}
          </button>
          <button onClick={() => void runEngine(true)} disabled={running}
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50">
            {running ? "Running…" : "Run Engine (fast)"}
          </button>
          <button onClick={() => void runEngine(false)} disabled={running}
            className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50">
            {running ? "Running…" : "Full Run + Forecasts"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-negative">{error}</div>
      )}
      {running && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
          Engine running [{selectedUniverse}] — OHLCV fetch → feature factory → HMM regime → cross-sectional factors → Monte Carlo DCF → quantile forecasts → Kelly sizing…
        </div>
      )}
      {runLog && (
        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-sm text-muted">Engine log</summary>
          <pre className="overflow-x-auto p-4 text-xs text-muted">{runLog}</pre>
        </details>
      )}

      {scorecard.length > 0 ? (
        <div className="flex flex-col gap-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <input type="text" placeholder="Filter symbol…" value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex flex-wrap gap-1">
              {signals.map((s) => (
                <button key={s} onClick={() => setSignalFilter(s)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                    signalFilter === s
                      ? s === "ALL" ? "border-accent bg-accent/10 text-accent" : `${SIGNAL_BG[s] ?? ""} ${SIGNAL_COLOR[s] ?? ""}`
                      : "border-border text-muted hover:bg-surface-2"
                  }`}>
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
            <span className="ml-auto text-xs text-muted">{filtered.length} symbols</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  {COLS.map(([col, label]) => (
                    <th key={col} onClick={() => toggleSort(col)}
                      className="cursor-pointer px-4 py-3 text-right font-medium hover:text-foreground">
                      {label}{sortCol === col ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Signal</th>
                  <th className="px-4 py-3 text-right font-medium">Conf</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((row) => (
                  <tr key={row.symbol}
                    className={`cursor-pointer bg-surface transition-colors hover:bg-surface-2 ${expanded === row.symbol ? "bg-surface-2" : ""}`}
                    onClick={() => setExpanded(expanded === row.symbol ? null : row.symbol)}
                  >
                      <td className="px-4 py-3">
                        <Link href={`/stocks/${row.symbol}`} className="font-mono font-semibold text-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          {row.symbol}
                        </Link>
                      </td>
                      {/* Composite with bar */}
                      <td className="px-4 py-3">
                        <ZBar value={row.composite_score} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.momentum_score >= 0 ? "+" : ""}{row.momentum_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.quality_score >= 0 ? "+" : ""}{row.quality_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.value_score >= 0 ? "+" : ""}{row.value_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.regime_score >= 0 ? "+" : ""}{row.regime_score.toFixed(3)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.forecast_score >= 0 ? "+" : ""}{row.forecast_score.toFixed(3)}</td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${row.mc_upside >= 0 ? "text-positive" : "text-negative"}`}>
                        {row.mc_upside >= 0 ? "+" : ""}{(row.mc_upside * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{(row.kelly_fraction * 100).toFixed(1)}%</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold ${SIGNAL_COLOR[row.signal] ?? "text-muted"}`}>
                          {row.signal.replace("_"," ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted">
                        {(row.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">
                        {expanded === row.symbol ? "▲ hide" : "▼ show"}
                      </td>
                  </tr>
                ))}
                {expanded && (
                  <tr key={`${expanded}-detail`}>
                    <td colSpan={COLS.length + 4} className="p-2">
                      <DetailPanel symbol={expanded} onClose={() => setExpanded(null)} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : !loading && !running ? (
        <div className="rounded-xl border border-border bg-surface p-12 text-center">
          <p className="text-muted">No scorecard data.</p>
          <p className="mt-1 text-sm text-muted">
            Click <strong className="text-foreground">Run Engine</strong> to initialise.
          </p>
        </div>
      ) : null}
    </main>
  );
}
