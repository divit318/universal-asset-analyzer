/**
 * Model health — the engine reporting on itself.
 *
 * A systematic model that won't tell you when it has stopped working is worse
 * than no model, so this section is deliberately blunt: the live information
 * coefficient measured against realized forward returns, whether that clears the
 * floor, and which inputs are stale. When IC is DEGRADED the panel says so in
 * plain language instead of rendering a green number.
 *
 * Distinct from Model Validation below: this is *continuous* self-monitoring from
 * the engine's own signal log and costs nothing to display. Validation is an
 * on-demand study that goes and fetches prices.
 */

"use client";

import { CountUp } from "@/app/_components/count-up";
import { Reveal } from "@/app/_components/reveal";
import { Derivation, Rule } from "./desk-primitives";

export interface OosMetrics {
  live_IC: number | null;
  hit_rate: number | null;
  strong_buy_alpha: number | null;
  sharpe_live: number | null;
  n_obs: number;
  ic_quality: "HIGH" | "MEDIUM" | "LOW" | "DEGRADED" | "INSUFFICIENT";
  data_health: {
    generated_at?: string;
    n_symbols_scored?: number;
    nse_status?: Record<string, string>;
    stale_fundamentals?: string[];
    live_oos?: Record<string, number | null>;
  } | null;
}

const QUALITY: Record<OosMetrics["ic_quality"], { dot: string; text: string; label: string; note: string }> = {
  HIGH: {
    dot: "bg-emerald-400", text: "text-emerald-400", label: "Signal reliable",
    note: "Rank correlation with realized forward returns is comfortably above the floor. Position sizing can be taken at face value.",
  },
  MEDIUM: {
    dot: "bg-warning", text: "text-warning", label: "Signal usable, with caution",
    note: "The model is predicting, but weakly. Treat the ranking as a shortlist rather than a decision.",
  },
  LOW: {
    dot: "bg-warning", text: "text-warning", label: "Signal weak",
    note: "Barely distinguishable from noise over the measured window. Do not size from the Kelly fractions.",
  },
  DEGRADED: {
    dot: "bg-red-500", text: "text-negative", label: "Signal degraded",
    note: "Information coefficient has gone negative — over this window the ranking was inverted. The model needs review before its output is actioned.",
  },
  INSUFFICIENT: {
    dot: "bg-border", text: "text-muted", label: "Not enough data to judge",
    note: "Fewer than 20 scored signals have a realized forward return yet. Health becomes measurable as the signal log fills in.",
  },
};

export function ModelHealth({ metrics }: { metrics: OosMetrics }) {
  const q = QUALITY[metrics.ic_quality] ?? QUALITY.INSUFFICIENT;
  const stale = metrics.data_health?.stale_fundamentals ?? [];

  const tiles = [
    {
      label: "Live IC",
      value: metrics.live_IC,
      format: (v: number) => v.toFixed(4),
      tone: (v: number) => (v >= 0.06 ? "text-positive" : v >= 0.02 ? "text-warning" : "text-negative"),
      hint: "Spearman rank correlation between composite score and realized 21-day forward return",
    },
    {
      label: "Hit rate",
      value: metrics.hit_rate,
      format: (v: number) => `${(v * 100).toFixed(1)}%`,
      tone: (v: number) => (v >= 0.55 ? "text-positive" : v >= 0.5 ? "text-warning" : "text-negative"),
      hint: "Share of Strong Buy calls whose forward return was positive",
    },
    {
      label: "Strong Buy alpha",
      value: metrics.strong_buy_alpha,
      format: (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`,
      tone: (v: number) => (v >= 0 ? "text-positive" : "text-negative"),
      hint: "Mean forward return of Strong Buy names minus the universe mean",
    },
    {
      label: "Live Sharpe",
      value: metrics.sharpe_live,
      format: (v: number) => v.toFixed(3),
      tone: (v: number) => (v >= 0.5 ? "text-positive" : v >= 0.3 ? "text-warning" : "text-negative"),
      hint: "Annualised mean/σ of realized 21-day forward returns in the log",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Verdict first — the number grid means nothing without the judgement. */}
      <div
        className={`flex flex-col gap-1.5 rounded-card border p-4 ${
          metrics.ic_quality === "DEGRADED"
            ? "border-negative/40 bg-negative/5"
            : metrics.ic_quality === "HIGH"
              ? "border-positive/30 bg-positive/5"
              : "border-border bg-surface-2/40"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${q.dot} ${metrics.ic_quality === "DEGRADED" ? "animate-pulse" : ""}`} />
          <span className={`text-sm font-semibold ${q.text}`}>{q.label}</span>
          {metrics.n_obs > 0 && (
            <span className="ml-auto font-mono text-label tabular-nums text-faint">
              {metrics.n_obs} observations · 84d rolling
            </span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted">{q.note}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t, i) => (
          <Reveal
            key={t.label}
            index={i}
            className="flex flex-col gap-0.5 rounded-card border border-border bg-surface p-3"
            title={t.hint}
          >
            <span className="text-label font-semibold uppercase tracking-widest text-muted/70">{t.label}</span>
            {t.value != null && Number.isFinite(t.value) ? (
              <CountUp
                value={t.value}
                durationMs={700}
                format={t.format}
                className={`font-mono text-base font-semibold tabular-nums ${t.tone(t.value)}`}
              />
            ) : (
              <span className="font-mono text-base text-faint">—</span>
            )}
          </Reveal>
        ))}
      </div>

      {/* Input health — a model is only as honest as what it was fed. */}
      <div className="flex flex-col gap-2">
        <Rule>Input health</Rule>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted">
          {metrics.data_health?.n_symbols_scored != null && (
            <span>
              <span className="font-mono tabular-nums text-foreground">
                {metrics.data_health.n_symbols_scored}
              </span>{" "}
              names scored
            </span>
          )}
          {stale.length > 0 ? (
            <span className="text-warning" title={stale.slice(0, 40).join(", ")}>
              {stale.length} name{stale.length === 1 ? "" : "s"} on stale fundamentals
            </span>
          ) : (
            <span className="text-positive">No stale fundamentals</span>
          )}
          {metrics.data_health?.generated_at && (
            <span className="text-faint">
              health report {new Date(metrics.data_health.generated_at).toLocaleString()}
            </span>
          )}
        </div>
        <Derivation>
          Measured from the engine&apos;s own signal log, which records every scored signal and fills in
          its realized 21-day forward return once that window has elapsed. Nothing here is a backtest —
          these are live, out-of-sample outcomes of calls the engine actually made.
        </Derivation>
      </div>
    </div>
  );
}
