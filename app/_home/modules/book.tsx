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
import { getHomeModule } from "@/lib/home/registry";
import { fmtSignedPct, fmtSignedMoney } from "../_viz/format";
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
  const { refreshDigest } = useHome();

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
            {/* Health + today's move. */}
            <div className="flex items-center gap-3">
              <HealthRing score={d.healthScore} grade={d.healthGrade} />
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-muted">Day P&amp;L</span>
                <span className={`font-mono text-xl font-semibold tabular-nums ${d.todayChangePct >= 0 ? "text-positive" : "text-negative"}`}>
                  {fmtSignedPct(d.todayChangePct)}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-muted">{fmtSignedMoney(d.todayChangeDollar)}</span>
              </div>
            </div>

            {/* Return vs benchmark · cash. */}
            <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3">
              {xirr != null ? (
                <Stat
                  label="Return (XIRR)"
                  value={fmtSignedPct(xirr)}
                  tone={toneClass(xirr)}
                  sub={bench ? `vs ${bench.symbol} ${fmtSignedPct(bench.benchmarkPct)}` : "annualized"}
                />
              ) : (
                <Stat
                  label="Return"
                  value={perf ? fmtSignedPct(perf.totalReturnPct) : "—"}
                  tone={perf ? toneClass(perf.totalReturnPct) : "text-muted"}
                  sub="since inception"
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
