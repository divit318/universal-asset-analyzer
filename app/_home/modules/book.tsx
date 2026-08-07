"use client";

/**
 * Portfolio Health — "how is my book?" answered in one card (§4.1, P6).
 *
 * Merges the two portfolio vitals cards this redesign retired
 * (`portfolio-pulse` + `portfolio-performance`) so the glanceable invariant
 * holds: one card = one question. Six bands, top to bottom: header (shell),
 * the grade ring + day P&L hero, return-vs-benchmark + cash, the 90-day
 * portfolio-vs-SPY return index, today's top contributors, and the footer's
 * two links.
 *
 * A projection only: every number is read from digest slices
 * (`portfolioPulse`, `performance`, `equityCurve`). No portfolio math here.
 */

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { CSSProperties } from "react";
import { toneClass } from "@/lib/format";
import type { EquityCurve, PortfolioPulse } from "@/lib/home/contracts";
import { explainHealth } from "@/lib/home/explain";
import { getHomeModule } from "@/lib/home/registry";
import { fmtSignedPct, fmtSignedMoney, gradeTone } from "../_viz/format";
import { MetricDelta, shortSessionDate, shortTime } from "../_viz/stamped";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";
import { Skeleton } from "@/app/_components/ui";

const definition = getHomeModule("book");

/** The shared type scale's section label (11px / 600 / caps / 0.09em / 55%). */
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.09em] text-foreground/55";
/** Every number on the page renders in the mono face with tabular figures. */
const NUM = "font-mono tabular-nums";

/** "+12.4 bps" / "−6.1 bps", true minus for alignment. */
function fmtBps(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)} bps`;
}

/** A monochrome-track health ring, data-coloured by band. 96px, 6px stroke,
 *  filled arc from 12 o'clock clockwise over a 12%-foreground track. */
function HealthRing({ score, grade }: { score: number | null; grade: string | null }) {
  const R = 44;
  const C = 2 * Math.PI * R;
  const pct = score != null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const tone = gradeTone(grade);
  return (
    <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
      <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="48" cy="48" r={R} fill="none" stroke="color-mix(in srgb, var(--foreground) 12%, transparent)" strokeWidth="6" />
        <circle
          cx="48"
          cy="48"
          r={R}
          fill="none"
          stroke={tone.stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-semibold leading-none text-foreground">{grade ?? "—"}</span>
        <span className={`${NUM} mt-1 text-[11px] leading-none text-muted`}>{score ?? "—"} / 100</span>
      </div>
    </div>
  );
}

/** Deterministic monogram — no company-logo asset or API exists in this
 *  codebase, and hand-authoring trademark SVGs is off the table. Identity
 *  colour comes from the categorical chart palette, never gain/loss tones. */
const MONOGRAM_TONES = [
  "bg-chart-1/15 text-chart-1",
  "bg-chart-2/15 text-chart-2",
  "bg-chart-3/15 text-chart-3",
  "bg-chart-4/15 text-chart-4",
  "bg-chart-5/15 text-chart-5",
];

function Monogram({ symbol }: { symbol: string }) {
  const idx = [...symbol].reduce((s, c) => s + c.charCodeAt(0), 0) % MONOGRAM_TONES.length;
  return (
    <span
      aria-hidden
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${MONOGRAM_TONES[idx]}`}
    >
      {symbol.charAt(0)}
    </span>
  );
}

/**
 * The 90-day comparison: two normalized lines sharing one scale, no axes, no
 * legend — just an endpoint label per line. The portfolio line is toned by its
 * own direction (§16 — a falling line is never green); the benchmark keeps the
 * palette's steel blue as an identity colour. Endpoint labels sit in a
 * reserved right gutter, positioned via CSS vars (the `--accent-line`
 * pattern), so they can never clip.
 */
function ComparisonSparkline({ curve }: { curve: EquityCurve }) {
  const H = 72;
  const W = 300; // nominal; x stretches to fit, strokes stay 1.5px via vector-effect
  const PAD = 3;

  const port = curve.points.map((p) => p.portfolio);
  const bench = curve.points.map((p) => p.benchmark).filter((v): v is number => v != null);
  const all = [...port, ...bench];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const y = (v: number) => PAD + (H - PAD * 2) - ((v - min) / span) * (H - PAD * 2);
  const x = (i: number) => (i / (curve.points.length - 1)) * W;

  const path = (pick: (p: (typeof curve.points)[number]) => number | null) => {
    let d = "";
    curve.points.forEach((p, i) => {
      const v = pick(p);
      if (v == null) return;
      d += `${d ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    });
    return d.trim();
  };

  const last = curve.points[curve.points.length - 1];
  const portTone = curve.portfolioPct != null && curve.portfolioPct < 0 ? "negative" : "positive";
  const portStroke = portTone === "negative" ? "var(--negative)" : "var(--positive)";
  const portText = portTone === "negative" ? "text-negative" : "text-positive";

  const labelVars = {
    "--spark-port-y": `${y(last.portfolio).toFixed(0)}px`,
    "--spark-bench-y": last.benchmark != null ? `${y(last.benchmark).toFixed(0)}px` : "0px",
  } as CSSProperties;

  return (
    <div className="relative pr-16" style={labelVars}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-[72px] w-full" preserveAspectRatio="none" aria-hidden>
        {bench.length >= 2 ? (
          <path
            d={path((p) => p.benchmark)}
            fill="none"
            stroke="var(--chart-2)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <path
          d={path((p) => p.portfolio)}
          fill="none"
          stroke={portStroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {curve.portfolioPct != null ? (
        <span className={`${NUM} absolute right-0 top-[var(--spark-port-y)] -translate-y-1/2 text-sm leading-none ${portText}`}>
          {fmtSignedPct(curve.portfolioPct)}
        </span>
      ) : null}
      {curve.benchmarkPct != null ? (
        <span className={`${NUM} absolute right-0 top-[var(--spark-bench-y)] -translate-y-1/2 text-sm leading-none text-chart-2`}>
          {fmtSignedPct(curve.benchmarkPct)}
        </span>
      ) : null}
    </div>
  );
}

export function BookModule() {
  const pulse = useHomeSlice("portfolioPulse");
  const performance = useHomeSlice("performance");
  const equityCurve = useHomeSlice("equityCurve");
  const changes = useHomeSlice("changes");
  const { refreshDigest } = useHome();

  // The change engine's health delta, when it found a material one — the card
  // shows state, but "state + how it moved since you left" is what a returning
  // user actually needs to know.
  const healthChange = changes.data?.changes.find((c) => c.kind === "health") ?? null;

  const unmet = pulse.data?.status === "empty" ? ("portfolio" as const) : null;

  return (
    <ModuleShell
      definition={definition}
      state={pulse}
      unmet={unmet}
      minHeight={200}
      onRefresh={refreshDigest}
      variant="display"
      headerCaption={
        pulse.data?.asOf ? (
          <>
            Updated <span className={NUM}>{shortTime(pulse.data.asOf)}</span>
          </>
        ) : null
      }
      isEmpty={(d: PortfolioPulse) => d.status === "empty"}
      emptyMessage="No holdings yet."
    >
      {(d) => {
        const perf = performance.data;
        const xirr = perf && perf.status !== "empty" ? perf.xirrPct : null;
        const bench = perf?.benchmark ?? null;
        const curve = equityCurve.data;
        const contributors = d.topContributors;
        return (
          <div className="flex h-full flex-col">
            {/* ── Band 2 · hero — the grade ring and today's P&L ── */}
            <div className="flex items-center gap-5 border-b border-foreground/8 pb-5 pt-2">
              <ExplainableValue explanation={explainHealth(d)} underline={false}>
                <HealthRing score={d.healthScore} grade={d.healthGrade} />
              </ExplainableValue>
              <div className="flex min-w-0 flex-col gap-1">
                {healthChange ? (
                  <span
                    className={`w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      healthChange.tone === "improved" ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative"
                    }`}
                    title={healthChange.detail}
                  >
                    {healthChange.tone === "improved" ? "▲" : "▼"} health since last visit
                  </span>
                ) : null}
                <span className={LABEL}>Day P&amp;L</span>
                <span className="flex items-baseline gap-3">
                  <MetricDelta
                    metric={{ value: d.todayChangePct, basis: "day", asOf: d.asOf, source: "yahoo", sessionDate: d.sessionDate }}
                    className="text-[30px] font-semibold leading-none"
                    suppressSessionLabel
                  />
                  <span className={`${NUM} text-sm leading-none ${toneClass(d.todayChangeDollar)}`}>
                    {fmtSignedMoney(d.todayChangeDollar)}
                  </span>
                </span>
                {d.sessionDate ? (
                  <span className={`${NUM} text-sm text-foreground/60`}>{shortSessionDate(d.sessionDate)}</span>
                ) : null}
              </div>
            </div>

            {/* ── Band 3 · return vs benchmark · cash ── */}
            <div className="border-b border-foreground/8 py-5">
              {/* Two different, both-correct measures of "return" — so each is
                  named for what it actually measures. XIRR is money-weighted and
                  annualized over the lot ledger; the fallback is cumulative
                  return on cost across the whole book, which is the exact number
                  /portfolio shows in its "Total return" tile. Labelling one of
                  them simply "Return" is what made Home and /portfolio look like
                  they disagreed. The benchmark line — including the EXCESS
                  return — describes the XIRR comparison, so it lives here, never
                  under cash. */}
              <div className="grid grid-cols-[3fr_2fr]">
                <div className="flex min-w-0 flex-col gap-1 pr-5">
                  <span className={LABEL}>{xirr != null ? "Return (XIRR)" : "Return on cost"}</span>
                  {xirr != null ? (
                    <span className={`${NUM} text-[26px] font-semibold leading-none ${toneClass(xirr)}`}>
                      {fmtSignedPct(xirr)}
                    </span>
                  ) : (
                    <span
                      className={`${NUM} text-[26px] font-semibold leading-none ${
                        d.totalReturnOnCostPct != null ? toneClass(d.totalReturnOnCostPct) : "text-muted"
                      }`}
                    >
                      {d.totalReturnOnCostPct != null ? fmtSignedPct(d.totalReturnOnCostPct) : "—"}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1 border-l border-foreground/8 pl-5">
                  <span className={LABEL}>Cash</span>
                  <span className={`${NUM} text-[26px] font-semibold leading-none text-foreground`}>
                    {d.cashPct != null ? `${Math.round(d.cashPct)}%` : "—"}
                  </span>
                </div>
              </div>
              {/* One line, left-aligned under the XIRR value. */}
              <p className="mt-1 whitespace-nowrap text-sm leading-snug text-foreground/72">
                {xirr != null ? (
                  bench ? (
                    <>
                      vs {bench.symbol} <span className={NUM}>{fmtSignedPct(bench.benchmarkPct)}</span>, excess{" "}
                      <span className={NUM}>{fmtSignedPct(bench.excessPct)}</span>
                    </>
                  ) : (
                    "annualized, money-weighted"
                  )
                ) : (
                  "cumulative, whole book"
                )}
              </p>
            </div>

            {/* ── Band 4 · the 90-day return index vs the benchmark ── */}
            <div className="flex flex-col gap-2 border-b border-foreground/8 py-6">
              <span className={LABEL}>
                <span className={NUM}>90</span>-day vs {curve?.benchmarkSymbol ?? "SPY"}
                {curve?.status === "ok" && curve.coveragePct != null && curve.coveragePct < 95 ? (
                  <span className="ml-2 normal-case tracking-normal text-foreground/40">
                    prices <span className={NUM}>{curve.coveragePct}%</span> of book
                  </span>
                ) : null}
              </span>
              {curve && curve.status === "ok" && curve.points.length >= 2 ? (
                <ComparisonSparkline curve={curve} />
              ) : equityCurve.status === "loading" || equityCurve.revalidating ? (
                <Skeleton height="h-[72px]" />
              ) : (
                <p className="flex h-[72px] items-center text-sm text-foreground/60">
                  Not enough priced history to draw yet.
                </p>
              )}
            </div>

            {/* ── Band 5 · today's top contributors, in bps of the book ── */}
            <div className="flex flex-col gap-3.5 border-b border-foreground/8 py-5">
              <span className={LABEL}>Top contributors (today)</span>
              {contributors.length > 0 ? (
                contributors.map((c) => (
                  <div key={c.symbol} className="flex items-center gap-2">
                    <Monogram symbol={c.symbol} />
                    <span className={`${NUM} shrink-0 text-sm font-semibold text-foreground`}>{c.symbol}</span>
                    <span className="min-w-0 truncate text-sm text-foreground/60">{c.name}</span>
                    <span className={`${NUM} ml-auto shrink-0 text-sm ${toneClass(c.bps)}`}>{fmtBps(c.bps)}</span>
                  </div>
                ))
              ) : pulse.status === "loading" || pulse.revalidating ? (
                <>
                  <Skeleton height="h-5" />
                  <Skeleton height="h-5" width="w-11/12" />
                  <Skeleton height="h-5" width="w-4/5" />
                </>
              ) : (
                <p className="text-sm text-foreground/60">No live day moves to attribute.</p>
              )}
            </div>

            {/* ── Band 6 · footer — the card's two destinations ── */}
            <div className="mt-auto grid grid-cols-2 divide-x divide-foreground/8 pt-5 text-sm">
              <Link
                href="/portfolio"
                className="inline-flex items-center justify-center gap-1.5 font-medium text-brand outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Open portfolio <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
              <Link
                href="/portfolio?tab=performance"
                className="inline-flex items-center justify-center gap-1.5 text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Attribution <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
              </Link>
            </div>
          </div>
        );
      }}
    </ModuleShell>
  );
}
