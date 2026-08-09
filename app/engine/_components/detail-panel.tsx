/**
 * One name's full mathematical working.
 *
 * The desk's escape hatch from "trust the score": every factor z, the HMM
 * posterior, the quantile forecasts, the Monte Carlo valuation distribution, the
 * Kelly derivation, and the raw feature values that fed them — each shown with
 * the formula that produced it.
 *
 * This is not Research Hub's company view and does not try to be. There is no
 * price chart, no news, no filings, no AI narrative; those live at /research and
 * are one click away. What is here is only the arithmetic behind this name's
 * position in the engine's ranking.
 */

"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { LoadingMark } from "@/app/_components/loading-mark";
import { useDataset } from "@/lib/platform/client/use-dataset";
import { useTheme } from "@/app/_components/theme";
import {
  FACTOR_META,
  regimeColor,
  REGIME_ORDER,
  WEIGHTED_FACTORS,
  scoreKey,
  signalTone,
  SIGNAL_LABEL,
  type ScorecardRow,
} from "@/lib/engine-desk";
import { Derivation, ProbBand, ProbMeter, Rule, Sparkline, ZBar, fmtPct, fmtZ } from "./desk-primitives";
import { EngineErrorState } from "./error-state";

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
  p10: number; p25: number; p50: number; p75: number; p90: number;
  prob_up: number;
}
interface McRow {
  intrinsic_p10: number; intrinsic_p25: number; intrinsic_p50: number;
  intrinsic_p75: number; intrinsic_p90: number;
  wacc: number; terminal_growth: number;
}
interface FundamentalsRow {
  name: string; sector: string;
  forward_pe: number | null; ev_to_ebitda: number | null;
  revenue_growth_yoy: number | null; revenue_cagr_3y: number | null;
  eps_growth_yoy: number | null; eps_cagr_3y: number | null;
  roic: number | null; roe: number | null;
  gross_margin: number | null; operating_margin: number | null;
  debt_to_equity: number | null; net_debt_to_ebitda: number | null;
  current_ratio: number | null; fcf_margin: number | null;
  dividend_yield: number | null; buyback_yield: number | null;
  institutional_ownership: number | null; earnings_surprise_pct: number | null;
}
interface FeatureRow { feature: string; value: number }
interface FactorPoint {
  date: string;
  momentum: number; quality: number; value: number;
  low_vol: number; revision: number; composite: number;
}

interface DetailData {
  symbol: string;
  scorecard: ScorecardRow | null;
  regime_history: RegimePoint[];
  forecasts: ForecastRow[];
  mc: McRow | null;
  fundamentals: FundamentalsRow | null;
  features: FeatureRow[];
  factor_history: FactorPoint[];
  error?: string;
}

const HORIZON_LABEL: Record<number, string> = { 5: "1w", 10: "2w", 21: "1m", 63: "3m", 126: "6m" };
type FeatureTab = "all" | "momentum" | "vol" | "stat";

export function DetailPanel({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const theme = useTheme().theme;
  const [featTab, setFeatTab] = useState<FeatureTab>("all");

  // Through useDataset rather than a hand-rolled effect: switching the expanded row
  // aborts the previous symbol's in-flight request, so a slow response for the row
  // the user just closed can never land and overwrite the one they opened.
  const fetcher = useCallback(async (signal: AbortSignal) => {
    const res = await fetch(`/api/engine/detail?symbol=${encodeURIComponent(symbol)}`, { signal });
    const json = (await res.json()) as DetailData & { error?: string };
    // A 504 still carries a usable empty shell plus a reason — surface the reason
    // rather than a bare failure, since "no snapshot yet" is actionable.
    if (!res.ok && !json.symbol) throw new Error(json.error ?? "Failed to load detail");
    return json;
  }, [symbol]);

  const { data, error: fetchError, isInitialLoading, refresh } = useDataset<DetailData>("engineDetail", symbol, fetcher);

  const status: "loading" | "ready" | "error" = isInitialLoading
    ? "loading"
    : fetchError && data == null
      ? "error"
      : "ready";
  // A partial payload's own `error` field is a caveat on real data, not a failure.
  const error = fetchError ?? data?.error ?? null;

  const sc = data?.scorecard;
  const fund = data?.fundamentals;
  const mc = data?.mc;
  const latestRegime = data?.regime_history?.[0];
  const factorSeries = [...(data?.factor_history ?? [])].reverse();
  const tone = sc ? signalTone(sc.signal) : null;

  const features = (data?.features ?? []).filter((f) => {
    if (featTab === "vol") return /vol|atr/.test(f.feature);
    if (featTab === "momentum") return /return|momentum|rsi/.test(f.feature);
    if (featTab === "stat") return /vr_|ou_|hurst|reg_/.test(f.feature);
    return true;
  });

  const bandScale = Math.max(
    0.05,
    ...(data?.forecasts ?? []).flatMap((f) => [Math.abs(f.p10 ?? 0), Math.abs(f.p90 ?? 0)]),
  );

  return (
    <div className="animate-fade-rise overflow-hidden rounded-card border border-brand/30 bg-surface">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-2.5">
        <Link href={`/stocks/${symbol}`} className="font-mono text-sm font-semibold text-brand hover:underline">
          {symbol}
        </Link>
        {fund?.name && <span className="truncate text-xs text-muted">{fund.name}</span>}
        {fund?.sector && (
          <span className="shrink-0 rounded bg-surface-3 px-2 py-0.5 text-label text-muted">{fund.sector}</span>
        )}
        {sc && tone && (
          <span className={`shrink-0 rounded border px-2 py-0.5 text-label font-semibold uppercase ${tone.chip} ${tone.text}`}>
            {SIGNAL_LABEL[sc.signal] ?? sc.signal}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <Link href={`/research?symbol=${encodeURIComponent(symbol)}`} className="text-xs text-brand hover:underline">
            Research ↗
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close detail"
            className="rounded-control p-1 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2.5 py-10 text-sm text-muted">
          <LoadingMark size={18} />
          Reading the engine&apos;s working for {symbol}…
        </div>
      )}

      {status === "error" && (
        <div className="p-4">
          <EngineErrorState
            title={`Couldn't read the engine's working for ${symbol}`}
            error={error ?? "Failed to load detail"}
            onRetry={refresh}
          />
        </div>
      )}

      {status === "ready" && data && (
        <div className="flex flex-col gap-6 p-4">
          {error && (
            <p className="rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              {error}
            </p>
          )}

          {!sc && !error && (
            <p className="py-4 text-center text-sm text-muted">
              No engine detail on file for {symbol} — it was not part of the last scored universe.
            </p>
          )}

          <div className="grid gap-6 xl:grid-cols-2">
            {/* ── Factor attribution ── */}
            {sc && (
              <div className="flex flex-col gap-3">
                <Rule>Factor attribution</Rule>
                <div className="flex flex-col gap-2.5">
                  {WEIGHTED_FACTORS.map((factor) => {
                    const meta = FACTOR_META[factor];
                    const value = (sc as unknown as Record<string, number>)[scoreKey(factor)] ?? 0;
                    return (
                      <div key={factor} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-xs font-medium">{meta?.label ?? factor}</span>
                          <ZBar value={value} />
                        </div>
                        <p className="text-caption leading-snug text-muted">{meta?.desc}</p>
                        <code className="rounded bg-surface-2 px-2 py-0.5 font-mono text-label text-faint">
                          {meta?.formula}
                        </code>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-2/60 px-3 py-2.5">
                  <div className="flex flex-col">
                    <span className="text-label font-semibold uppercase tracking-widest text-muted/70">
                      Composite
                    </span>
                    <span className="text-caption text-faint">IC-weighted Σ wᵢ·zᵢ</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <ZBar value={sc.composite_score} />
                    <span className="font-mono text-label tabular-nums text-muted">
                      conf {(sc.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Forecast distributions ── */}
            <div className="flex flex-col gap-3">
              {data.forecasts.length > 0 ? (
                <>
                  <Rule>Probabilistic forecast</Rule>
                  <Derivation>
                    LightGBM quantile regression (α ∈ {"{0.10, 0.25, 0.50, 0.75, 0.90}"}), walk-forward
                    train/test split. P(up) from a Gaussian IQR fit: σ ≈ IQR/1.349, P(X&gt;0) = Φ(p50/σ).
                    Shared axis ±{(bandScale * 100).toFixed(0)}%.
                  </Derivation>
                  <div className="flex flex-col gap-2.5">
                    {data.forecasts.map((fc) => (
                      <div key={fc.horizon_days} className="flex items-center gap-3">
                        <span className="w-8 shrink-0 font-mono text-xs font-semibold">
                          {HORIZON_LABEL[fc.horizon_days] ?? `${fc.horizon_days}d`}
                        </span>
                        <div className="flex-1">
                          <ProbBand p10={fc.p10} p50={fc.p50} p90={fc.p90} scale={bandScale} />
                        </div>
                        <span className="w-20 shrink-0 text-right font-mono text-label tabular-nums text-muted">
                          {fmtPct(fc.p50)} med
                        </span>
                        <span
                          className={`w-14 shrink-0 text-right font-mono text-xs tabular-nums ${fc.prob_up > 0.5 ? "text-positive" : "text-negative"}`}
                        >
                          P↑ {(fc.prob_up * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                sc && (
                  <>
                    <Rule>Probabilistic forecast</Rule>
                    <p className="py-3 text-xs text-faint">
                      No forecasts for this name — the quantile stage is skipped in a fast run.
                    </p>
                  </>
                )
              )}

              {/* Kelly */}
              {sc && (
                <div className="mt-1 flex flex-col gap-2">
                  <Rule>Position sizing</Rule>
                  <Derivation>
                    Fractional Kelly (0.25×): f = 0.25 × (p·b − q)/b, capped at 15%. b from the 21-day
                    median return, p = P(up).
                  </Derivation>
                  <div className="flex items-center gap-4 rounded-card border border-border bg-surface-2/40 p-3">
                    <div className="flex flex-col">
                      <span className="font-mono text-xl font-bold tabular-nums">
                        {(sc.kelly_fraction * 100).toFixed(1)}%
                      </span>
                      <span className="text-label text-faint">of capital</span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <ProbMeter prob={sc.kelly_fraction / 0.15} height="h-2" trailing={<span className="w-11 shrink-0 text-right text-label text-faint">15% cap</span>} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ── Regime ── */}
            {latestRegime && (
              <div className="flex flex-col gap-3">
                <Rule
                  trailing={
                    <span className="text-label text-faint">{latestRegime.date?.slice(0, 10)}</span>
                  }
                >
                  HMM regime posterior
                </Rule>
                <Derivation>
                  5-state Gaussian HMM over [log return, 5d realised vol, log vol ratio], Baum-Welch EM.
                  State labels assigned by sorting mean return across states.
                </Derivation>
                <div className="flex flex-col gap-2">
                  {REGIME_ORDER.map((label) => {
                    const key = `prob_${label.toLowerCase()}` as keyof RegimePoint;
                    const prob = (latestRegime[key] as number) ?? 0;
                    return (
                      <ProbMeter
                        key={label}
                        prob={prob}
                        color={regimeColor(label, theme)}
                        height="h-2.5"
                        label={
                          <span className={label === latestRegime.regime_label ? "font-semibold text-foreground" : ""}>
                            {label}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Monte Carlo valuation ── */}
            {mc && (
              <div className="flex flex-col gap-3">
                <Rule>Monte Carlo DCF</Rule>
                <Derivation>
                  50,000 paths. OU revenue growth (θ=0.30, σ=0.08, μ_lr=5%), FCF-margin noise σ=0.05,
                  year-level GBM shock exp(0.12ε − 0.0072). Terminal: Gordon Growth. WACC via CAPM.
                </Derivation>
                <div className="grid grid-cols-5 gap-1 rounded-card border border-border bg-surface-2/40 p-3">
                  {(["intrinsic_p10", "intrinsic_p25", "intrinsic_p50", "intrinsic_p75", "intrinsic_p90"] as const).map(
                    (k, i) => (
                      <div key={k} className="flex flex-col items-center gap-0.5">
                        <span className="text-label text-faint">{["P10", "P25", "P50", "P75", "P90"][i]}</span>
                        <span
                          className={`font-mono text-sm tabular-nums ${i === 2 ? "font-semibold text-foreground" : "text-muted"}`}
                        >
                          {mc[k] != null ? mc[k].toFixed(0) : "—"}
                        </span>
                      </div>
                    ),
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <MiniStat label="WACC" value={`${(mc.wacc * 100).toFixed(2)}%`} />
                  <MiniStat label="Terminal g" value={`${(mc.terminal_growth * 100).toFixed(2)}%`} />
                  {sc && (
                    <MiniStat
                      label="Upside to P50"
                      value={fmtPct(sc.mc_upside)}
                      tone={sc.mc_upside >= 0 ? "text-positive" : "text-negative"}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ── Factor history ── */}
            {factorSeries.length > 1 && (
              <div className="flex flex-col gap-3">
                <Rule>Factor history · {factorSeries.length} runs</Rule>
                <div className="grid grid-cols-2 gap-2">
                  {(["momentum", "quality", "value", "low_vol", "revision", "composite"] as const).map((k) => {
                    const vals = factorSeries.map((r) => r[k] ?? 0);
                    const last = vals[vals.length - 1];
                    return (
                      <div
                        key={k}
                        className="flex items-center justify-between rounded-card border border-border bg-surface-2/40 px-3 py-2"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="text-label capitalize text-muted">{k.replace("_", " ")}</span>
                          <span className={`font-mono text-xs tabular-nums ${last >= 0 ? "text-positive" : "text-negative"}`}>
                            {fmtZ(last, 3)}
                          </span>
                        </div>
                        <Sparkline data={vals} color={last >= 0 ? "var(--positive)" : "var(--negative)"} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Fundamentals (as factor inputs) ── */}
            {fund && (
              <div className="flex flex-col gap-3">
                <Rule>Factor inputs</Rule>
                <div className="grid grid-cols-2 gap-x-5 gap-y-0.5 text-xs">
                  {(
                    [
                      ["Forward PE", fund.forward_pe, "x"],
                      ["EV/EBITDA", fund.ev_to_ebitda, "x"],
                      ["Rev growth", fund.revenue_growth_yoy, "%"],
                      ["Rev CAGR 3y", fund.revenue_cagr_3y, "%"],
                      ["EPS growth", fund.eps_growth_yoy, "%"],
                      ["EPS CAGR 3y", fund.eps_cagr_3y, "%"],
                      ["ROIC", fund.roic, "%"],
                      ["ROE", fund.roe, "%"],
                      ["Gross margin", fund.gross_margin, "%"],
                      ["Op. margin", fund.operating_margin, "%"],
                      ["FCF margin", fund.fcf_margin, "%"],
                      ["D/E", fund.debt_to_equity, "x"],
                      ["Net debt/EBITDA", fund.net_debt_to_ebitda, "x"],
                      ["Current ratio", fund.current_ratio, "x"],
                      ["Div yield", fund.dividend_yield, "%"],
                      ["Buyback yield", fund.buyback_yield, "%"],
                      ["Inst. ownership", fund.institutional_ownership, "%"],
                      ["EPS surprise", fund.earnings_surprise_pct, "%"],
                    ] as [string, number | null, string][]
                  ).map(([label, v, suffix]) => (
                    <div key={label} className="flex items-center justify-between border-b border-border/40 py-1">
                      <span className="text-muted">{label}</span>
                      {v != null && Number.isFinite(v) ? (
                        <span className="font-mono tabular-nums">
                          {v.toFixed(2)}
                          {suffix}
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Raw features ── */}
          {data.features.length > 0 && (
            <div className="flex flex-col gap-2">
              <Rule
                trailing={
                  <div className="flex gap-0.5">
                    {(["all", "momentum", "vol", "stat"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setFeatTab(t)}
                        className={`rounded-control px-2 py-0.5 text-label font-medium transition-colors ${
                          featTab === t ? "bg-brand/15 text-brand" : "text-muted hover:bg-surface-2"
                        }`}
                      >
                        {t === "all" ? "All" : t === "momentum" ? "Returns" : t === "vol" ? "Vol" : "Statistical"}
                      </button>
                    ))}
                  </div>
                }
              >
                Feature values
              </Rule>
              <div className="grid grid-cols-2 gap-x-5 gap-y-0 text-xs sm:grid-cols-3 lg:grid-cols-4">
                {features.map((f) => (
                  <div key={f.feature} className="flex items-center justify-between border-b border-border/30 py-1">
                    <span className="truncate font-mono text-label text-muted" title={f.feature}>
                      {f.feature}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums">{f.value.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-control border border-border bg-surface-2/40 px-2.5 py-1.5">
      <span className="text-label text-faint">{label}</span>
      <span className={`font-mono tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}
