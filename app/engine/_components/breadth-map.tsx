/**
 * Market breadth — the shape of the whole scored universe, not a ranking of it.
 *
 * The desk's claim is that it analyses a market rather than a company, and this is
 * where that claim is cashed: the signal distribution across every name, the
 * composite score's spread, and a sector heatmap.
 *
 * The heatmap deliberately encodes *signal tilt*, not average composite. The
 * engine z-scores its factors within sector, so every sector's mean composite is
 * ~0 by construction and colouring by it would render pure rounding noise. Tilt
 * (how many of a sector's names cleared the actionable threshold) and dispersion
 * (how much the sector disagrees internally) are what survive sector
 * neutralisation and are therefore what get drawn.
 */

"use client";

import Link from "next/link";
import { CountUp } from "@/app/_components/count-up";
import { Reveal } from "@/app/_components/reveal";
import { signalTone, SIGNAL_LABEL, type Breadth } from "@/lib/engine-desk";
import { Derivation, Rule, fmtZ } from "./desk-primitives";

export function BreadthMap({
  breadth,
  onFilterSignal,
  activeSignal,
}: {
  breadth: Breadth;
  /** Jumps to the full scorecard pre-filtered to a tier. */
  onFilterSignal: (signal: string) => void;
  activeSignal: string;
}) {
  const maxCount = Math.max(...breadth.signal_distribution.map((d) => d.count), 1);
  const pct = breadth.composite_percentiles;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Signal distribution ── */}
        <div className="flex flex-col gap-2">
          <Rule trailing={<span className="text-label tabular-nums text-faint">{breadth.n_total} names</span>}>
            Signal distribution
          </Rule>
          <div className="flex flex-col gap-1.5 pt-1">
            {breadth.signal_distribution.map((d, i) => {
              const tone = signalTone(d.signal);
              const active = activeSignal === d.signal;
              return (
                <Reveal key={d.signal} index={i}>
                  <button
                    type="button"
                    onClick={() => onFilterSignal(active ? "ALL" : d.signal)}
                    aria-pressed={active}
                    className={`flex w-full items-center gap-3 rounded-control px-2 py-1 text-left transition-colors ${
                      active ? "bg-surface-3" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className={`w-[5.5rem] shrink-0 text-xs font-medium ${tone.text}`}>
                      {SIGNAL_LABEL[d.signal] ?? d.signal}
                    </span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded bg-surface-2">
                      <div
                        className={`absolute inset-y-0 left-0 animate-bar-fill rounded ${tone.bar}`}
                        style={{ ["--bar-value" as string]: `${(d.count / maxCount) * 100}%` } as React.CSSProperties}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                      {d.count}
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-label tabular-nums text-faint">
                      {((d.count / Math.max(1, breadth.n_total)) * 100).toFixed(0)}%
                    </span>
                  </button>
                </Reveal>
              );
            })}
          </div>
          <Derivation>
            Click a tier to filter the full scorecard below. A universe that is mostly Hold is the
            expected outcome — the thresholds are calibrated so only genuine outliers are actionable.
          </Derivation>
        </div>

        {/* ── Composite spread + participation ── */}
        <div className="flex flex-col gap-2">
          <Rule>Universe spread</Rule>
          <div className="grid grid-cols-3 gap-3 pt-1">
            {(["p10", "p50", "p90"] as const).map((k) => (
              <div key={k} className="flex flex-col gap-0.5 rounded-card border border-border bg-surface-2/40 p-3">
                <span className="text-label font-semibold uppercase tracking-widest text-muted/70">
                  {k.toUpperCase()}
                </span>
                <span
                  className={`font-mono text-base font-semibold tabular-nums ${(pct[k] ?? 0) >= 0 ? "text-positive" : "text-negative"}`}
                >
                  {fmtZ(pct[k])}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-2 flex flex-col gap-2.5">
            <ParticipationBar
              label="Positive momentum"
              pct={breadth.pct_positive_momentum}
              hint="Share of names with a momentum z above zero — the breadth behind any trend call"
            />
            <ParticipationBar label="Bullish signals" pct={breadth.pct_bullish} tone="positive" />
            <ParticipationBar label="Bearish signals" pct={breadth.pct_bearish} tone="negative" />
          </div>

          <Derivation>
            Composite z-score percentiles across the scored universe. A narrow spread means the model
            sees little to distinguish these names; a wide one means real dispersion to exploit.
          </Derivation>
        </div>
      </div>

      {/* ── Sector heatmap ── */}
      {breadth.sectors.length > 0 && (
        <div className="flex flex-col gap-2">
          <Rule>Sector tilt</Rule>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {breadth.sectors.map((s, i) => (
              <Reveal key={s.sector} index={i}>
                <SectorTile sector={s} />
              </Reveal>
            ))}
          </div>
          <Derivation>
            Colour is net signal tilt — bullish minus bearish names, as a share of the sector&apos;s
            scored names. Not average composite: the engine z-scores factors within sector, so every
            sector&apos;s mean composite is ~0 by construction and would show nothing.
          </Derivation>
        </div>
      )}
    </div>
  );
}

function ParticipationBar({
  label,
  pct,
  tone = "brand",
  hint,
}: {
  label: string;
  pct: number;
  tone?: "brand" | "positive" | "negative";
  hint?: string;
}) {
  const bar = tone === "positive" ? "bg-positive" : tone === "negative" ? "bg-negative" : "bg-brand";
  return (
    <div className="flex items-center gap-3" title={hint}>
      <span className="w-[8.5rem] shrink-0 text-xs text-muted">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`absolute inset-y-0 left-0 animate-bar-fill rounded-full ${bar}`}
          style={{ ["--bar-value" as string]: `${Math.min(100, pct)}%` } as React.CSSProperties}
        />
      </div>
      <CountUp
        value={pct}
        durationMs={650}
        format={(v) => `${v.toFixed(0)}%`}
        className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted"
      />
    </div>
  );
}

function SectorTile({ sector: s }: { sector: Breadth["sectors"][number] }) {
  // Tilt saturates at ±40pp: beyond that the sector is unambiguous and more
  // colour adds no information.
  const intensity = Math.min(1, Math.abs(s.net_tilt_pct) / 40);
  const hue = s.net_tilt_pct > 0 ? "var(--positive)" : s.net_tilt_pct < 0 ? "var(--negative)" : "var(--border)";

  return (
    <div
      className="flex flex-col gap-1.5 rounded-card border p-3 transition-transform duration-200 hover:-translate-y-0.5"
      style={{
        borderColor: `color-mix(in srgb, ${hue} ${20 + intensity * 45}%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${hue} ${intensity * 14}%, var(--surface))`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium leading-tight">{s.sector}</span>
        <span
          className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${
            s.net_tilt_pct > 0 ? "text-positive" : s.net_tilt_pct < 0 ? "text-negative" : "text-muted"
          }`}
        >
          {s.net_tilt_pct > 0 ? "+" : ""}
          {s.net_tilt_pct.toFixed(0)}%
        </span>
      </div>
      <div className="flex items-center justify-between text-label text-faint">
        <span>
          {s.n} names · {s.n_bullish}↑ {s.n_bearish}↓
        </span>
        <span title="Standard deviation of composite z within the sector — internal disagreement">
          σ {s.dispersion?.toFixed(2) ?? "—"}
        </span>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-label">
        <span className="text-faint">best</span>
        <Link href={`/stocks/${s.best_symbol}`} className="font-mono font-semibold text-brand hover:underline">
          {s.best_symbol} {fmtZ(s.best_composite)}
        </Link>
      </div>
    </div>
  );
}
