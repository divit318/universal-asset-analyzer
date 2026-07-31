/**
 * The desk's opening statement: what market the model thinks we are in, how sure
 * it is, why, and what that implies for positioning.
 *
 * This is the section that separates the Quant Engine from every other module.
 * Research Hub opens with a company; Compare opens with a matchup; Screener opens
 * with a filter. The desk opens with a *market state* — one regime, five
 * posteriors, an implied expected return, and a stance — because the engine's
 * question is "what is the market creating today", not "what about this name".
 */

"use client";

import { CountUp } from "@/app/_components/count-up";
import { REGIME_COLOR, REGIME_ORDER, type Breadth, type RegimeBrief } from "@/lib/engine-desk";
import { Derivation, ProbMeter, RegimeChip, Rule, fmtPct } from "./desk-primitives";

export function RegimeHero({
  regime,
  breadth,
  latestDate,
  nSymbols,
}: {
  regime: RegimeBrief | null;
  breadth: Breadth;
  latestDate: string;
  nSymbols: number;
}) {
  const accent = regime?.label ? REGIME_COLOR[regime.label] ?? "var(--brand)" : "var(--brand)";
  const netTilt = breadth.pct_bullish - breadth.pct_bearish;

  return (
    <div
      className="relative overflow-hidden rounded-card border bg-surface shadow-card"
      style={{ borderColor: `${accent}40` }}
    >
      {/* Regime-tinted wash — the page's colour temperature *is* the market state,
          so the reader knows the regime before reading a word. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ background: `radial-gradient(120% 100% at 0% 0%, ${accent} 0%, transparent 60%)` }}
      />

      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
        {/* ── Left: the call ── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-label font-semibold uppercase tracking-widest text-muted/70">
              Market regime
            </span>
            <RegimeChip label={regime?.label ?? null} size="lg" />
            {regime && regime.days_in_regime > 0 && (
              <span className="text-xs text-muted">
                held {regime.days_in_regime} session{regime.days_in_regime === 1 ? "" : "s"}
              </span>
            )}
          </div>

          {regime ? (
            <>
              <p className="max-w-2xl text-sm leading-relaxed text-foreground">{regime.explanation}</p>
              <p className="max-w-2xl text-sm leading-relaxed text-muted">
                <span className="font-medium text-foreground">Stance: </span>
                {regime.stance}
              </p>

              {/* Three numbers that turn the regime into something actionable. */}
              <div className="grid grid-cols-3 gap-3 pt-1">
                <HeroFigure
                  label="Implied return"
                  hint="Σ P(state) × annualised μ(state)"
                  value={
                    <CountUp
                      value={regime.expected_annual_return ?? 0}
                      durationMs={700}
                      format={(v) => fmtPct(v, 1)}
                      className={(regime.expected_annual_return ?? 0) >= 0 ? "text-positive" : "text-negative"}
                    />
                  }
                />
                <HeroFigure
                  label="Agreement"
                  hint={`${regime.n_symbols} names' own HMM agree with the modal state`}
                  value={
                    <CountUp value={regime.breadth_pct} durationMs={700} format={(v) => `${v.toFixed(0)}%`} />
                  }
                />
                <HeroFigure
                  label="Net tilt"
                  hint={`${breadth.n_bullish} bullish vs ${breadth.n_bearish} bearish of ${breadth.n_total} scored`}
                  value={
                    <CountUp
                      value={netTilt}
                      durationMs={700}
                      format={(v) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
                      className={netTilt >= 0 ? "text-positive" : "text-negative"}
                    />
                  }
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              No regime detected yet — the HMM runs as part of a full engine pass. Run the engine to
              populate this.
            </p>
          )}

          <Derivation>
            {nSymbols} names scored on {latestDate}. Regime is a 5-state Gaussian HMM over
            [log return, 5d realised vol, log vol ratio], fit per name by Baum-Welch EM; the market
            call above is the modal state across the universe with posteriors averaged.
          </Derivation>
        </div>

        {/* ── Right: the full posterior ── */}
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-2/50 p-4">
          <Rule
            trailing={
              regime?.confidence != null ? (
                <span className="font-mono text-xs tabular-nums text-muted">
                  peak {(regime.confidence * 100).toFixed(0)}%
                </span>
              ) : undefined
            }
          >
            State posterior
          </Rule>

          {regime ? (
            <div className="flex flex-col gap-2">
              {REGIME_ORDER.map((label) => {
                const prob = regime.probabilities[`prob_${label.toLowerCase()}`] ?? 0;
                const mu = regime.mu[label];
                const isModal = label === regime.label;
                return (
                  <div key={label} className={isModal ? "" : "opacity-70"}>
                    <ProbMeter
                      prob={prob}
                      color={REGIME_COLOR[label]}
                      height="h-2.5"
                      label={
                        <span className={isModal ? "font-semibold text-foreground" : ""}>{label}</span>
                      }
                      trailing={
                        <span className="flex w-[4.5rem] shrink-0 items-baseline justify-end gap-1.5">
                          <span className="font-mono text-xs tabular-nums">
                            {((prob ?? 0) * 100).toFixed(0)}%
                          </span>
                          {/* The μ each state contributes — makes the implied
                              return above reproducible by hand. */}
                          <span className="font-mono text-label tabular-nums text-faint">
                            {mu != null ? `${mu > 0 ? "+" : ""}${(mu * 100).toFixed(0)}` : ""}
                          </span>
                        </span>
                      }
                    />
                  </div>
                );
              })}
              <Derivation>
                Right column is each state&apos;s annualised μ in %. The implied return is these
                weighted by their probabilities.
              </Derivation>
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-faint">No posterior available</p>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroFigure({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className="flex flex-col gap-0.5" title={hint}>
      <span className="text-label font-semibold uppercase tracking-widest text-muted/70">{label}</span>
      <span className="font-mono text-xl font-bold tabular-nums">{value}</span>
    </div>
  );
}
