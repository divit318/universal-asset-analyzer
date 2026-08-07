/**
 * Factor Lab — which factors are currently carrying the signal, and how that has
 * rotated.
 *
 * This is the section that proves the engine is adaptive rather than a fixed
 * formula. The weights are re-derived from realized information coefficient every
 * run, so what the composite *is* changes over time. Screener's composite scorer
 * uses fixed dimension weights by design; showing the rotation here is the
 * clearest possible statement that these are two different products.
 *
 * The weight-evolution chart is hand-drawn SVG rather than Recharts on purpose:
 * it is a stacked normalised band over ≤60 points with no interaction, and
 * mounting a ResponsiveContainer for it would reintroduce the documented 0×0
 * first-paint measure hazard for no benefit.
 */

"use client";

import { CountUp } from "@/app/_components/count-up";
import { Reveal } from "@/app/_components/reveal";
import { useTheme } from "@/app/_components/theme";
import { Badge } from "@/app/_components/ui";
import { FACTOR_META, WEIGHTED_FACTORS, type FactorWeights } from "@/lib/engine-desk";
import { Derivation, Rule, fmtZ } from "./desk-primitives";

/** Distinct hues per factor, reused by both the weight bars and the evolution
 *  band so a colour means the same factor in both. Theme-paired: the dark set
 *  is the original; the light set deepens each hue for a white canvas
 *  (2026-08-08 light-mode audit — #f59e0b value sat at 2.0:1 on white). */
const FACTOR_COLOR_DARK: Record<string, string> = {
  momentum: "#38bdf8",
  quality: "#22c55e",
  value: "#f59e0b",
  low_vol: "#a78bfa",
  revision: "#f472b6",
  regime: "#2dd4bf",
  mc_upside: "#fb923c",
};
const FACTOR_COLOR_LIGHT: Record<string, string> = {
  momentum: "#0369a1",
  quality: "#15803d",
  value: "#b45309",
  low_vol: "#7c3aed",
  revision: "#db2777",
  regime: "#0f766e",
  mc_upside: "#ad4a08",
};

function useFactorColors(): Record<string, string> {
  return useTheme().theme === "light" ? FACTOR_COLOR_LIGHT : FACTOR_COLOR_DARK;
}

export function FactorLab({ weights }: { weights: FactorWeights }) {
  const factorColor = useFactorColors();
  const current = weights.current;
  const live = WEIGHTED_FACTORS.map((f) => ({
    factor: f,
    label: FACTOR_META[f]?.label ?? f,
    weight: typeof current[f] === "number" ? (current[f] as number) : null,
  })).filter((w) => w.weight != null && w.weight > 0);

  const total = live.reduce((s, w) => s + (w.weight ?? 0), 0) || 1;
  const ranked = [...live].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));

  return (
    <div className="flex flex-col gap-5">
      {/* Provenance banner — an IC-derived weighting and a cold-start default are
          very different claims, and conflating them would be the dishonest option. */}
      <div className="flex flex-wrap items-center gap-3">
        {weights.source === "ic" ? (
          <Badge variant="brand">IC-derived · {weights.n_runs} run{weights.n_runs === 1 ? "" : "s"} on file</Badge>
        ) : (
          <Badge variant="warning">Cold-start defaults</Badge>
        )}
        {weights.top_factor && (
          <span className="text-sm text-muted">
            Highest predictive power right now:{" "}
            <span className="font-semibold text-foreground">
              {FACTOR_META[weights.top_factor]?.label ?? weights.top_factor}
            </span>
          </span>
        )}
      </div>

      {weights.source === "default" && (
        <Derivation>
          No run has persisted its derived weights yet, so these are the documented starting weights.
          Run the engine once and this panel switches to the weighting the model actually computed
          from realized IC, plus its history.
        </Derivation>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ── Current weighting ── */}
        <div className="flex flex-col gap-2">
          <Rule>Current weighting</Rule>
          <div className="flex flex-col gap-2 pt-1">
            {ranked.map((w, i) => (
              <Reveal key={w.factor} index={i} className="flex items-center gap-3">
                <span className="w-[5.5rem] shrink-0 text-xs text-muted" title={FACTOR_META[w.factor]?.desc}>
                  {w.label}
                </span>
                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 animate-bar-fill rounded-full"
                    style={{
                      backgroundColor: factorColor[w.factor],
                      // Scaled to the largest weight, not to 100%, so the shape of
                      // the weighting is visible rather than five short stubs.
                      ["--bar-value" as string]: `${((w.weight ?? 0) / (ranked[0].weight ?? 1)) * 100}%`,
                    } as React.CSSProperties}
                  />
                </div>
                <CountUp
                  value={((w.weight ?? 0) / total) * 100}
                  durationMs={650}
                  format={(v) => `${v.toFixed(0)}%`}
                  className="w-9 shrink-0 text-right font-mono text-xs tabular-nums"
                />
              </Reveal>
            ))}
          </div>
          <Derivation>
            Weights normalised to the sum shown. Each factor&apos;s weight is proportional to the rank
            correlation between its z-score and realized forward return over the trailing window, so a
            factor that stops predicting loses weight automatically.
          </Derivation>
        </div>

        {/* ── Rotation ── */}
        <div className="flex flex-col gap-2">
          <Rule
            trailing={
              weights.history.length > 1 ? (
                <span className="text-label tabular-nums text-faint">{weights.history.length} runs</span>
              ) : undefined
            }
          >
            Leadership rotation
          </Rule>

          {weights.history.length > 1 ? (
            <>
              <WeightEvolution history={weights.history} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
                {ranked.map((w) => (
                  <span key={w.factor} className="flex items-center gap-1.5 text-caption text-muted">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-sm"
                      style={{ backgroundColor: factorColor[w.factor] }}
                    />
                    {w.label}
                  </span>
                ))}
              </div>

              {weights.shifts.length > 0 && (
                <div className="mt-2 flex flex-col gap-1">
                  {weights.shifts.map((s) => (
                    <div key={s.factor} className="flex items-center gap-2 text-xs">
                      <span className="w-[5.5rem] shrink-0 text-muted">
                        {FACTOR_META[s.factor]?.label ?? s.factor}
                      </span>
                      <span className="font-mono tabular-nums text-faint">{s.from.toFixed(2)}</span>
                      <span className="text-faint">→</span>
                      <span className="font-mono tabular-nums text-foreground">{s.to.toFixed(2)}</span>
                      <span
                        className={`font-mono tabular-nums ${s.delta >= 0 ? "text-positive" : "text-negative"}`}
                      >
                        {fmtZ(s.delta)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-xs text-faint">
              Rotation history builds up one point per engine run — this chart appears from the second
              run onward.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Normalised stacked band of factor weight through time. Each column sums to
 * 100%, so the graphic answers "what share of the signal did each factor carry"
 * rather than "what was the raw weight", which is the question that survives the
 * weights being renormalised between runs.
 */
function WeightEvolution({ history }: { history: FactorWeights["history"] }) {
  const factorColor = useFactorColors();
  const W = 100;
  const H = 34;
  const factors = WEIGHTED_FACTORS.filter((f) =>
    history.some((row) => typeof row[f] === "number" && (row[f] as number) > 0),
  );
  if (factors.length === 0) return null;

  const columns = history.map((row) => {
    const vals = factors.map((f) => (typeof row[f] === "number" ? Math.max(0, row[f] as number) : 0));
    const sum = vals.reduce((s, v) => s + v, 0) || 1;
    return vals.map((v) => v / sum);
  });

  // Cumulative offsets per column, then one polygon per factor spanning the
  // series — a stacked area without a charting library.
  const bands = factors.map((factor, fi) => {
    const top: string[] = [];
    const bottom: string[] = [];
    columns.forEach((col, ci) => {
      const x = columns.length === 1 ? 0 : (ci / (columns.length - 1)) * W;
      const below = col.slice(0, fi).reduce((s, v) => s + v, 0);
      const above = below + col[fi];
      top.push(`${x},${H - above * H}`);
      bottom.push(`${x},${H - below * H}`);
    });
    return { factor, points: [...top, ...bottom.reverse()].join(" ") };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-28 w-full animate-fade-rise rounded-card border border-border bg-surface-2/40"
      role="img"
      aria-label="Factor weight share over recent engine runs"
    >
      {bands.map((b) => (
        <polygon key={b.factor} points={b.points} fill={factorColor[b.factor]} opacity={0.85} />
      ))}
    </svg>
  );
}
