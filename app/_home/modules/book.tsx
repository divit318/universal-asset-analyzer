"use client";

/**
 * Book — "how is my book?" answered in one card (§4.1, P6).
 *
 * Merges the two portfolio vitals cards this redesign retired
 * (`portfolio-pulse` + `portfolio-performance`) so the glanceable invariant
 * holds: one card = one question. Health ring, money-weighted return vs. the
 * benchmark, cash weight, and today's P&L are all facets of that question, and
 * they were split across two cards in two rows before.
 *
 * A projection only: every number is read from the digest slices the retired
 * cards read (`portfolioPulse`, `performance`). No portfolio math here.
 */

import Link from "next/link";
import { toneClass } from "@/lib/format";
import type { PortfolioPulse } from "@/lib/home/contracts";
import { explainHealth } from "@/lib/home/explain";
import { getHomeModule } from "@/lib/home/registry";
import { fmtSignedPct, fmtSignedMoney } from "../_viz/format";
import { MetricDelta } from "../_viz/stamped";
import { ExplainableValue } from "../_atmosphere/explain-popover";
import { ModuleShell } from "../module-shell";
import { useHome, useHomeSlice } from "../home-provider";

const definition = getHomeModule("book");

/** grade band → data colour for the ring (§16 — data-only colour). */
function ringTone(grade: string | null): { stroke: string; text: string } {
  const g = (grade ?? "").charAt(0).toUpperCase();
  if (g === "A" || g === "B") return { stroke: "var(--positive)", text: "text-positive" };
  if (g === "C") return { stroke: "var(--warning)", text: "text-warning" };
  if (g === "D" || g === "F") return { stroke: "var(--negative)", text: "text-negative" };
  return { stroke: "var(--brand)", text: "text-foreground" };
}

/** A monochrome-track health ring, data-coloured by band. Reuses the ring
 *  aesthetic from the retired pulse radar without pulling a chart library. */
function HealthRing({ score, grade }: { score: number | null; grade: string | null }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const pct = score != null ? Math.max(0, Math.min(100, score)) / 100 : 0;
  const tone = ringTone(grade);
  return (
    <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center">
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="38" cy="38" r={R} fill="none" stroke="var(--edge-hairline)" strokeWidth="6" />
        <circle
          cx="38"
          cy="38"
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
        <span className={`text-lg font-bold leading-none ${tone.text}`}>{grade ?? "—"}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted">{score ?? "—"}/100</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-foreground", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
      {sub ? <span className="text-[10px] text-muted">{sub}</span> : null}
    </div>
  );
}

export function BookModule() {
  const pulse = useHomeSlice("portfolioPulse");
  const performance = useHomeSlice("performance");
  const changes = useHomeSlice("changes");
  const { refreshDigest } = useHome();

  // The change engine's health delta, when it found a material one — the Book
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
      isEmpty={(d: PortfolioPulse) => d.status === "empty"}
      emptyMessage="No holdings yet."
    >
      {(d) => {
        const perf = performance.data;
        const xirr = perf && perf.status !== "empty" ? perf.xirrPct : null;
        const bench = perf?.benchmark ?? null;
        return (
          <div className="flex flex-col gap-4">
            {/* Health + today's move. The ring is a click-to-decompose score. */}
            <div className="flex items-center gap-3">
              <ExplainableValue explanation={explainHealth(d)}>
                <HealthRing score={d.healthScore} grade={d.healthGrade} />
              </ExplainableValue>
              <div className="flex flex-col gap-0.5">
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
                <span className="text-[10px] uppercase tracking-wide text-muted">Day P&amp;L</span>
                <MetricDelta
                  metric={{ value: d.todayChangePct, basis: "day", asOf: d.asOf, source: "yahoo", sessionDate: d.sessionDate }}
                  className="text-xl font-semibold"
                />
                <span className="font-mono text-[11px] tabular-nums text-muted">{fmtSignedMoney(d.todayChangeDollar)}</span>
              </div>
            </div>

            {/* Return vs benchmark · cash. */}
            <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
              {/* Two different, both-correct measures of "return" — so each is
                  named for what it actually measures. XIRR is money-weighted and
                  annualized over the lot ledger; the fallback is cumulative
                  return on cost across the whole book, which is the exact number
                  /portfolio shows in its "Total return" tile. Labelling one of
                  them simply "Return" is what made Home and /portfolio look like
                  they disagreed. */}
              {xirr != null ? (
                <Stat
                  label="Return (XIRR)"
                  value={fmtSignedPct(xirr)}
                  tone={toneClass(xirr)}
                  sub={bench ? `annualized vs ${bench.symbol} ${fmtSignedPct(bench.benchmarkPct)}` : "annualized, money-weighted"}
                />
              ) : (
                <Stat
                  label="Return on cost"
                  value={d.totalReturnOnCostPct != null ? fmtSignedPct(d.totalReturnOnCostPct) : "—"}
                  tone={d.totalReturnOnCostPct != null ? toneClass(d.totalReturnOnCostPct) : "text-muted"}
                  sub="cumulative, whole book"
                />
              )}
              <Stat
                label="Cash"
                value={d.cashPct != null ? `${Math.round(d.cashPct)}%` : "—"}
                tone="text-foreground"
                sub={bench ? `excess ${fmtSignedPct(bench.excessPct)}` : undefined}
              />
            </div>

            <div className="flex items-center gap-3 border-t border-hairline pt-3 text-xs">
              <Link href="/portfolio" className="font-medium text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/40">
                Portfolio →
              </Link>
              <Link href="/portfolio?tab=performance" className="text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40">
                Attribution
              </Link>
            </div>
          </div>
        );
      }}
    </ModuleShell>
  );
}
