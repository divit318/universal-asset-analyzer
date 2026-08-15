"use client";

/**
 * I · STATE — the masthead strip and the pulse filament.
 *
 * The strip is the book's state in one line: value, today, window vs
 * benchmark, total return, cash, alignment. The filament below it is the
 * digest's real equity curve (return index, 100 = window start) with the
 * benchmark as a ghost line — drawn on arrival, scrubbable, terminus
 * breathing at "now". No number here is computed client-side beyond
 * display math on engine outputs.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { OPEN_PALETTE_EVENT } from "@/app/_components/command-palette";
import { CountUp } from "@/app/_components/count-up";
import { EASE_OUT, PLOT_DRAW_MS, prefersReducedMotion } from "@/app/_components/motion";
import { Skeleton } from "@/app/_components/ui";
import type { EquityCurve, PortfolioPulse } from "@/lib/home/contracts";
import { fmtMoney, fmtSignedMoney, fmtSignedPct, fmtTodayDate } from "../_viz/format";
import { useHome, useHomeSlice } from "../home-provider";

/* ------------------------------------------------------------------ */
/* The strip                                                           */
/* ------------------------------------------------------------------ */

function toneClass(v: number | null | undefined): string {
  if (v == null || v === 0) return "";
  return v > 0 ? "text-positive" : "text-negative";
}

/**
 * One cell of the book strip. Every metric — the value included — is a peer
 * in a single hairline-divided row: label above, figure below, shared
 * baseline. The state of the book in one horizontal read.
 */
function Cell({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-l border-hairline pl-6 first:border-l-0 first:pl-0" title={title}>
      <dt className="whitespace-nowrap text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="whitespace-nowrap font-mono text-[15px] leading-none tabular-nums">{children}</dd>
    </div>
  );
}

function StateStrip({ pulse, curve }: { pulse: PortfolioPulse; curve: EquityCurve | null }) {
  const perf = useHomeSlice("performance").data;
  const excess =
    curve?.portfolioPct != null && curve.benchmarkPct != null
      ? curve.portfolioPct - curve.benchmarkPct
      : null;
  // "At high" only when the window's last portfolio index IS its maximum — a
  // derivable fact of the curve, not a claim.
  const atHigh = useMemo(() => {
    const pts = curve?.points ?? [];
    if (pts.length < 2) return false;
    const last = pts[pts.length - 1].portfolio;
    return last >= Math.max(...pts.map((p) => p.portfolio));
  }, [curve]);

  const align = pulse.alignmentScore;

  return (
    <dl className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-5">
      <Cell label="The book">
        <span className="text-[26px] font-medium tracking-[-0.02em]">
          <CountUp value={pulse.totalValue} format={(v) => fmtMoney(v)} durationMs={900} />
        </span>
      </Cell>

      <Cell
        label="Today"
        title={
          pulse.dayCoveragePct != null && pulse.dayCoveragePct < 95
            ? `The day move could price ${Math.round(pulse.dayCoveragePct)}% of the book`
            : undefined
        }
      >
        <span className={toneClass(pulse.todayChangeDollar)}>{fmtSignedMoney(pulse.todayChangeDollar)}</span>{" "}
        <span className="text-[12.5px] text-muted">
          {fmtSignedPct(pulse.todayChangePct)}
          {pulse.dayCoveragePct != null && pulse.dayCoveragePct < 95 ? "*" : ""}
        </span>
      </Cell>

      {curve && curve.portfolioPct != null ? (
        <Cell label={`${curve.windowDays}D vs ${curve.benchmarkSymbol}`}>
          <span className={toneClass(curve.portfolioPct)}>{fmtSignedPct(curve.portfolioPct)}</span>
          {excess != null ? (
            <span className="text-[12.5px] text-muted"> {fmtSignedPct(excess, 1).replace("%", "pp")}</span>
          ) : null}
        </Cell>
      ) : null}

      {perf && perf.status === "ok" ? (
        <Cell label="Total return">
          <span className={toneClass(perf.totalReturnPct)}>{fmtSignedPct(perf.totalReturnPct)}</span>
        </Cell>
      ) : null}

      {pulse.cashPct != null ? <Cell label="Cash">{pulse.cashPct.toFixed(1)}%</Cell> : null}

      {atHigh ? (
        <Cell label="State">
          <span className="text-[12.5px] tracking-[0.08em] text-brand">{curve?.windowDays}D HIGH</span>
        </Cell>
      ) : null}

      {align != null ? (
        <div className="ml-auto flex flex-col gap-2 border-l border-hairline pl-6 max-md:ml-0">
          <dt className="whitespace-nowrap text-[9.5px] font-medium uppercase tracking-[0.16em] text-muted">
            Alignment · vs your policy
          </dt>
          <dd className="flex items-center gap-2.5">
            <span
              className="relative h-[3px] w-[84px] rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, color-mix(in srgb, var(--warning) 70%, transparent), color-mix(in srgb, var(--brand) 70%, transparent) 55%, color-mix(in srgb, var(--positive) 55%, transparent))",
              }}
              aria-hidden="true"
            >
              <i
                className="absolute top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rotate-45 bg-brand-strong shadow-[0_0_8px_color-mix(in_srgb,var(--brand)_35%,transparent)] transition-[left] duration-(--duration-draw) ease-(--ease-out)"
                style={{ left: `${align}%` }}
              />
            </span>
            <span className="whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.1em] text-brand tabular-nums">
              {align} · {pulse.alignmentLabel ?? ""}
            </span>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* The pulse filament                                                  */
/* ------------------------------------------------------------------ */

const PAD_T = 18;
const PAD_B = 26;

function tickLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`))
    .toUpperCase();
}

function Filament({ curve }: { curve: EquityCurve }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const youRef = useRef<SVGPathElement | null>(null);
  const benchRef = useRef<SVGPathElement | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [areaIn, setAreaIn] = useState(false);
  const drawnRef = useRef(false);

  const pts = curve.points;
  const n = pts.length;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    if (!dims || n < 2) return null;
    const { w, h } = dims;
    const all = pts.flatMap((p) => (p.benchmark != null ? [p.portfolio, p.benchmark] : [p.portfolio]));
    const min = Math.min(...all);
    const max = Math.max(...all);
    const span = max - min || 1;
    const x = (i: number) => (i / (n - 1)) * w;
    const y = (v: number) => PAD_T + (1 - (v - min) / span) * (h - PAD_T - PAD_B);
    const line = (get: (p: (typeof pts)[number]) => number | null) => {
      let d = "";
      pts.forEach((p, i) => {
        const v = get(p);
        if (v == null) return;
        d += `${d ? " L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      });
      return d;
    };
    return { w, h, x, y, youD: line((p) => p.portfolio), benchD: line((p) => p.benchmark) };
  }, [dims, pts, n]);

  // The one deliberate "being drawn" moment — the plot-draw sweep, run once.
  useEffect(() => {
    if (!geom || drawnRef.current) return;
    drawnRef.current = true;
    if (prefersReducedMotion()) {
      const raf = requestAnimationFrame(() => setAreaIn(true));
      return () => cancelAnimationFrame(raf);
    }
    for (const [ref, delay] of [
      [youRef, 120],
      [benchRef, 240],
    ] as const) {
      const p = ref.current;
      if (!p) continue;
      const len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
      const anim = p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
        duration: PLOT_DRAW_MS,
        delay,
        easing: EASE_OUT,
        fill: "forwards",
      });
      anim.onfinish = () => {
        p.style.strokeDasharray = "none";
        p.style.strokeDashoffset = "0";
      };
    }
    const t = window.setTimeout(() => setAreaIn(true), 900);
    return () => window.clearTimeout(t);
  }, [geom]);

  if (!geom) return <div ref={hostRef} className="h-[168px] max-md:h-[120px]" />;

  const { w, h, x, y, youD, benchD } = geom;
  const last = pts[n - 1];
  const lastX = x(n - 1);
  const lastY = y(last.portfolio);
  const si = scrub;
  const sp = si != null ? pts[si] : null;

  return (
    <div
      ref={hostRef}
      className={`relative h-[168px] max-md:h-[120px] ${si != null ? "is-scrubbing" : ""}`}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        setScrub(Math.round(ratio * (n - 1)));
      }}
      onPointerLeave={() => setScrub(null)}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="block h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id="tdy-fil-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="color-mix(in srgb, var(--brand) 10%, transparent)" />
            <stop offset="1" stopColor="transparent" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="tdy-fil-grid" x1={f * w} y1={PAD_T} x2={f * w} y2={h - PAD_B} />
        ))}
        {/* Baseline at index 100 — the window's start. */}
        <line
          className="tdy-fil-grid"
          x1={0}
          y1={y(100)}
          x2={w}
          y2={y(100)}
          strokeDasharray="2 5"
        />
        <path
          className={`tdy-fil-area ${areaIn ? "is-in" : ""}`}
          d={`${youD} L ${w} ${h - PAD_B} L 0 ${h - PAD_B} Z`}
          fill="url(#tdy-fil-grad)"
        />
        {benchD ? <path ref={benchRef} className="tdy-fil-bench" d={benchD} /> : null}
        <path ref={youRef} className="tdy-fil-you" d={youD} />
        {si != null && sp ? (
          <>
            <line className="tdy-fil-cross" x1={x(si)} y1={PAD_T} x2={x(si)} y2={h - PAD_B} />
            {sp.benchmark != null ? (
              <circle className="tdy-fil-node" r={2.5} cx={x(si)} cy={y(sp.benchmark)} fill="color-mix(in srgb, var(--foreground) 40%, transparent)" />
            ) : null}
            <circle className="tdy-fil-node" r={3} cx={x(si)} cy={y(sp.portfolio)} fill="var(--brand-strong)" />
          </>
        ) : null}
        <circle className="tdy-fil-halo" r={8} cx={lastX} cy={lastY} />
        <circle r={3} cx={lastX} cy={lastY} fill="var(--brand-strong)" />
        <text className="fill-faint font-mono text-[9px] tracking-[0.12em]" x={2} y={h - 8}>
          {tickLabel(pts[0].date)}
        </text>
        <text className="fill-faint font-mono text-[9px] tracking-[0.12em]" x={w / 2} y={h - 8} textAnchor="middle">
          {tickLabel(pts[Math.floor((n - 1) / 2)].date)}
        </text>
        <text className="fill-faint font-mono text-[9px] tracking-[0.12em]" x={w - 2} y={h - 8} textAnchor="end">
          {tickLabel(last.date)}
        </text>
      </svg>

      {si != null && sp ? (
        <div
          className="pointer-events-none absolute top-1.5 z-[5] -translate-x-1/2 whitespace-nowrap rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 font-mono text-[10.5px] tracking-[0.06em] text-muted tabular-nums"
          style={{ left: Math.min(w - 90, Math.max(90, x(si))) }}
          role="status"
        >
          {tickLabel(sp.date)} · <b className="font-medium text-foreground">YOU {fmtSignedPct(sp.portfolio - 100, 1)}</b>
          {sp.benchmark != null ? (
            <>
              {" "}
              · {curve.benchmarkSymbol} {fmtSignedPct(sp.benchmark - 100, 1)}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Masthead                                                            */
/* ------------------------------------------------------------------ */

export function Masthead() {
  const pulse = useHomeSlice("portfolioPulse");
  const curveSlice = useHomeSlice("equityCurve");
  const { digest, refreshDigest } = useHome();
  const curve = curveSlice.data && curveSlice.data.points.length >= 2 ? curveSlice.data : null;

  const briefTime = digest.data
    ? new Date(digest.data.generatedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })
    : null;

  return (
    <section id="tdy-state" aria-label="Portfolio state" className="border-b border-hairline pt-9">
      <div className="tdy-shell">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <p className="flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
            <span className="tdy-eyebrow-diamond" aria-hidden="true" />
            {fmtTodayDate("long")}
          </p>
          <p className="flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
            <span>
              {pulse.data?.sessionNote ? `${pulse.data.sessionNote} · ` : ""}
              {briefTime ? `DIGEST ${briefTime}` : ""}
              {digest.revalidating ? " · REFRESHING" : ""}
            </span>
            {/* The palette's discovery cue — quiet, and a real button. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
              className="group flex items-center gap-1.5 tracking-[0.14em] transition-colors duration-(--duration-base) hover:text-muted"
              aria-label="Open the command palette"
            >
              <kbd className="rounded-[3px] border border-hairline px-1 py-px font-mono text-[9px] text-muted transition-colors duration-(--duration-base) group-hover:border-brand/35 group-hover:text-brand">
                ⌘K
              </kbd>
              <span>jump anywhere</span>
            </button>
          </p>
        </div>

        {pulse.status === "loading" ? (
          <div className="mt-7 flex flex-col gap-3" aria-hidden>
            <Skeleton height="h-3" width="w-16" />
            <Skeleton height="h-10" width="w-64" />
          </div>
        ) : pulse.status === "error" && !pulse.data ? (
          <div className="mt-7 text-sm text-muted">
            Couldn’t load your book.{" "}
            <button type="button" onClick={refreshDigest} className="font-medium text-brand hover:underline">
              Retry
            </button>
          </div>
        ) : pulse.data && pulse.data.status === "empty" ? (
          <div className="mt-7">
            <p className="font-serif text-xl text-muted">
              No portfolio yet — the ledger opens when the book does.
            </p>
            <a href="/portfolio" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">
              Add your first position →
            </a>
          </div>
        ) : pulse.data ? (
          <StateStrip pulse={pulse.data} curve={curve} />
        ) : null}
      </div>

      {/* Full-bleed filament: the portfolio's line, edge to edge. */}
      <figure
        className="tdy-bleed relative mt-8"
        aria-label={
          curve
            ? `Portfolio return index over the last ${curve.windowDays} days versus ${curve.benchmarkSymbol}`
            : "Portfolio return curve"
        }
      >
        {curve ? (
          <>
            <figcaption className="absolute -top-1.5 right-7 z-[2] flex gap-4 font-mono text-[10px] tracking-[0.1em] text-muted tabular-nums">
              <span>
                <i className="mr-1.5 mb-[3px] inline-block h-[1.5px] w-3 bg-brand align-middle" aria-hidden="true" />
                YOU {curve.portfolioPct != null ? fmtSignedPct(curve.portfolioPct, 1) : "—"}
              </span>
              {curve.benchmarkPct != null ? (
                <span>
                  <i className="mr-1.5 mb-[3px] inline-block h-px w-3 bg-foreground/30 align-middle" aria-hidden="true" />
                  {curve.benchmarkSymbol} {fmtSignedPct(curve.benchmarkPct, 1)}
                </span>
              ) : null}
              <span className="text-faint">{curve.windowDays}D</span>
            </figcaption>
            <Filament curve={curve} />
          </>
        ) : (
          <div className="h-[168px] max-md:h-[120px]">
            {curveSlice.status === "loading" ? <Skeleton height="h-full" width="w-full" /> : null}
          </div>
        )}
      </figure>
    </section>
  );
}
