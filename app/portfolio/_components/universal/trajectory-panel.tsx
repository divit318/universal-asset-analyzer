"use client";

/**
 * Trajectory — is this book improving or deteriorating, and did my last change help?
 *
 * Two things here that no other part of the page could say.
 *
 * 1. DRIFT. Every other number was a point-in-time reading, so a stable target and
 *    a steadily concentrating book looked identical. The alignment score and the
 *    largest-asset-class weight are both contribution-invariant, which makes them
 *    the honest trend lines to lead with.
 *
 * 2. SELF-GRADING. The Decision Center issues advice with a measured expected
 *    impact. Until now nothing ever went back and checked the realised one. A
 *    recommendation engine that never reports its own misses is a suggestion box.
 *
 * Deliberately NOT plotted: portfolio value. It rises when you deposit money — in
 * the real ledger it went from $510k to $9.26M in one step — and a value line that
 * blends contributions with returns is the most common lie in retail portfolio
 * software.
 */

import { Card, Badge } from "@/app/_components/ui";
import type { PortfolioTrajectory, TrajectoryPoint } from "@/lib/portfolio/history";
import {
  TrajectoryChart,
  type TrajectorySeriesPoint,
  type TrajectoryTone,
} from "./trajectory-chart";

function delta(v: number | null, suffix: string): { text: string; tone: TrajectoryTone } {
  if (v == null || Math.abs(v) < 0.05) return { text: "unchanged", tone: "neutral" };
  return {
    text: `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${suffix}`,
    tone: v > 0 ? "positive" : "negative",
  };
}

function Metric({
  label,
  now,
  d,
  series,
  scale,
  format,
  /** For concentration, UP is bad — so the arrow's colour must be inverted. */
  higherIsBetter = true,
  hint,
}: {
  label: string;
  now: string;
  d: { text: string; tone: TrajectoryTone };
  series: TrajectorySeriesPoint[];
  scale: "absolute" | "relative";
  format: (v: number) => string;
  higherIsBetter?: boolean;
  hint: string;
}) {
  const tone: TrajectoryTone =
    d.tone === "neutral" ? "neutral" : higherIsBetter ? d.tone : d.tone === "positive" ? "negative" : "positive";
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-muted";

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface/40 p-3">
      <span className="text-[10px] uppercase tracking-wider text-muted/70">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-base font-bold tabular-nums text-foreground">{now}</span>
        <span className={`font-mono text-[11px] font-semibold tabular-nums ${toneClass}`}>{d.text}</span>
      </div>
      <TrajectoryChart points={series} tone={tone} scale={scale} format={format} />
      <span className="text-[10px] leading-snug text-muted/70">{hint}</span>
    </div>
  );
}

export function TrajectoryPanel({ trajectory }: { trajectory: PortfolioTrajectory | null }) {
  if (!trajectory || trajectory.points.length < 2) {
    return (
      <Card className="flex flex-col gap-1 p-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Trajectory</h3>
        <p className="text-[11px] leading-relaxed text-muted/70">
          Not enough history yet. A snapshot is recorded either side of every change you
          execute, so trend lines and the outcome of each change appear once you have made
          one — rather than being back-filled from an assumption.
        </p>
      </Card>
    );
  }

  const t = trajectory;
  const points: TrajectoryPoint[] = t.points;
  const last = points[points.length - 1];
  const lastChange = t.changes[0] ?? null;
  const scoreSeries = points.map((p) => ({ t: Date.parse(p.at), v: p.score }));
  const concentrationSeries = points.map((p) => ({ t: Date.parse(p.at), v: p.topAssetClassWeight }));

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Trajectory</h3>
          <p className="mt-1 text-[11px] text-muted/70">
            Where this portfolio has moved over {t.windowDays === 0 ? "the recorded history" : `${t.windowDays} days`},
            across {points.length} recorded states.
          </p>
        </div>
        <Badge variant={t.scoreDelta == null || Math.abs(t.scoreDelta) < 1 ? "neutral" : t.scoreDelta > 0 ? "positive" : "warning"}>
          {t.scoreDelta == null || Math.abs(t.scoreDelta) < 1
            ? "Stable"
            : t.scoreDelta > 0
              ? "Improving"
              : "Deteriorating"}
        </Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Metric
          label="Portfolio alignment"
          now={`${last.score}`}
          d={delta(t.scoreDelta, "")}
          series={scoreSeries}
          scale="absolute"
          format={(v) => v.toFixed(0)}
          hint={
            t.scoreDefinitionChanged
              ? "Earlier points used the retired universal health score; newer ones score against your own policy. The step between regimes is a definition change, not a portfolio change."
              : "Full 0-100 scale and a real time axis, so a few points read as a few points."
          }
        />
        <Metric
          label="Largest asset class"
          now={`${last.topAssetClassWeight.toFixed(1)}%`}
          d={delta(t.concentrationDelta, "pp")}
          series={concentrationSeries}
          scale="relative"
          format={(v) => `${v.toFixed(1)}%`}
          higherIsBetter={false}
          hint="Concentration drift. Rising means the book is narrowing, whether or not you chose that."
        />
      </div>

      {/* ── Self-grading ─────────────────────────────────────────────────────
          The engine reports the outcome of the user's own last change, including
          when it went the wrong way. This is the accountability the Decision
          Center lacked: expected impact was always stated, realised impact never
          was. */}
      {lastChange && (
        <div
          className={`flex flex-col gap-1.5 rounded-lg border p-3.5 ${
            lastChange.regressed ? "border-warning/30 bg-warning/[0.05]" : "border-border bg-surface/40"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              Your most recent change
            </span>
            <Badge variant={lastChange.regressed ? "warning" : lastChange.scoreDelta > 0 ? "positive" : "neutral"}>
              {lastChange.regressed
                ? "Left the book less aligned"
                : lastChange.scoreDelta > 0
                  ? "Improved alignment"
                  : "Roughly neutral"}
            </Badge>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            On {new Date(lastChange.at).toLocaleDateString()}, the alignment score moved{" "}
            <strong className="text-foreground">
              {lastChange.scoreBefore} → {lastChange.scoreAfter}
            </strong>{" "}
            and the largest asset class moved{" "}
            <strong className="text-foreground">
              {lastChange.concentrationBefore.toFixed(1)}% → {lastChange.concentrationAfter.toFixed(1)}%
            </strong>
            .{" "}
            {lastChange.regressed
              ? "Worth reviewing: the change moved the book further from your own stated policy. That can be a deliberate trade-off — taking concentration risk for expected return — but it should be a choice, not a surprise."
              : "Recorded automatically either side of the execution, so this is the realised outcome rather than the projection."}
          </p>
        </div>
      )}

      {t.changes.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted/70">
            Change history ({t.changes.length})
          </span>
          <ul className="flex flex-col gap-1">
            {t.changes.slice(0, 6).map((c) => (
              <li key={c.at} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-muted">{new Date(c.at).toLocaleDateString()}</span>
                <span className="flex items-center gap-3 font-mono tabular-nums">
                  <span className={c.scoreDelta > 0 ? "text-positive" : c.scoreDelta < 0 ? "text-negative" : "text-muted"}>
                    align {c.scoreDelta > 0 ? "+" : ""}{c.scoreDelta}
                  </span>
                  <span className={c.concentrationDelta < 0 ? "text-positive" : c.concentrationDelta > 0 ? "text-negative" : "text-muted"}>
                    conc {c.concentrationDelta > 0 ? "+" : ""}{c.concentrationDelta.toFixed(1)}pp
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-muted/60">
        Portfolio value is deliberately not plotted here: it rises when you add money, so a
        value line blends contributions with returns. Alignment and concentration are unaffected
        by deposits, which is what makes them readable as trends. For return over time, see
        Performance.
      </p>
    </Card>
  );
}
