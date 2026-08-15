"use client";

/**
 * V · THE BOOK — where you stand.
 *
 * Three hairline columns, no cards: Alignment (the engine's own themes,
 * weight-shared, breaches flagged), the session's P&L attribution
 * (stamped contributions, residual disclosed), and the top of the book
 * (composition sleeves + largest positions) with Radar — ideas entering
 * the pipeline, ranked by fit — beneath it. Bars and rings draw when the
 * section arrives.
 */

import Link from "next/link";
import { CountUp } from "@/app/_components/count-up";
import { withFromToday } from "@/lib/home/attention";
import type { PortfolioPulse } from "@/lib/home/contracts";
import { fmtSignedMoney, fmtSignedPct } from "../_viz/format";
import { useHome, useHomeSlice } from "../home-provider";
import { Eyebrow, useArrival } from "./primitives";

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

function ColTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <h3 className="mb-4 text-[13px] font-semibold">
      {children} {sub ? <span className="text-xs font-normal text-faint">{sub}</span> : null}
    </h3>
  );
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

function AlignmentCol({ pulse }: { pulse: PortfolioPulse }) {
  const factors = pulse.alignmentFactors;
  return (
    <div>
      <ColTitle sub="vs your policy">Alignment</ColTitle>
      {pulse.alignmentScore == null ? (
        <p className="text-sm leading-relaxed text-muted">
          Not scorable yet — the engine needs more of the book priced.{" "}
          <Link href="/portfolio" className="text-brand hover:underline">
            Open portfolio →
          </Link>
        </p>
      ) : (
        <>
          <div className="mb-4 flex items-baseline gap-1.5">
            <span className="font-mono text-[34px] leading-none text-brand tabular-nums">
              <CountUp value={pulse.alignmentScore} format={(v) => String(Math.round(v))} />
            </span>
            <span className="font-mono text-xs text-faint">/ 100</span>
            {pulse.alignmentLabel ? (
              <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {pulse.alignmentLabel}
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-[11px]">
            {factors.map((f, i) => (
              <li key={f.label} className="grid grid-cols-[92px_1fr_auto_30px] items-center gap-3">
                <span className="truncate text-[12.5px] text-muted">{f.label}</span>
                <span className="relative h-[3px] rounded-full bg-surface-2">
                  {f.score != null ? (
                    <i
                      className={`tdy-bar absolute inset-0 rounded-full ${
                        f.score < 50 ? "bg-warning" : "bg-brand"
                      }`}
                      style={{ "--w": f.score / 100, "--d": `${i * 70}ms` } as React.CSSProperties}
                    />
                  ) : null}
                </span>
                <span className="font-mono text-[8.5px] tracking-[0.14em] text-faint">
                  {f.score == null ? (f.unratedReason === "opted_out" ? "OPTED OUT" : "UNRATED") : f.score < 50 ? "LOW" : ""}
                </span>
                <span className="text-right font-mono text-xs tabular-nums">{f.score ?? "—"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-faint">
            {pulse.topMismatch ?? "No policy mismatches worth a line."}
            {!pulse.alignmentConfirmed ? (
              <>
                {" "}
                Scored against assumed defaults —{" "}
                <Link href="/portfolio" className="text-brand hover:underline">
                  confirm your policy
                </Link>
                .
              </>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

function AttributionCol({ pulse }: { pulse: PortfolioPulse }) {
  const rows = pulse.topContributors;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.dayDollar)));
  const sessionLabel = pulse.sessionDate
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
        new Date(`${pulse.sessionDate}T12:00:00Z`),
      )
    : "Session";

  return (
    <div>
      <ColTitle sub="attribution">{sessionLabel}’s P&L</ColTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No priced day moves this session.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <li key={r.symbol} className="grid grid-cols-[52px_1fr_auto] items-center gap-3.5">
              <Link
                href={withFromToday(`/research?symbol=${encodeURIComponent(r.symbol)}`)}
                className="font-mono text-[11.5px] text-muted hover:text-brand"
                title={r.name}
              >
                {r.symbol}
              </Link>
              <span className="relative h-[3px] overflow-hidden rounded-full bg-surface-2">
                <i
                  className={`tdy-bar absolute inset-0 rounded-full ${
                    r.dayDollar < 0 ? "bg-negative/70" : "bg-positive/70"
                  }`}
                  style={{ "--w": Math.abs(r.dayDollar) / maxAbs, "--d": `${i * 60}ms` } as React.CSSProperties}
                />
              </span>
              <span className={`font-mono text-xs tabular-nums ${r.dayDollar < 0 ? "text-negative" : "text-positive"}`}>
                {fmtSignedMoney(r.dayDollar)}
              </span>
            </li>
          ))}
          {pulse.topContributorsResidualBps != null && Math.abs(pulse.topContributorsResidualBps) >= 1 ? (
            <li className="grid grid-cols-[52px_1fr_auto] items-center gap-3.5 text-faint">
              <span className="font-mono text-[11.5px]">REST</span>
              <span />
              <span className="font-mono text-xs tabular-nums">
                {pulse.topContributorsResidualBps > 0 ? "+" : "−"}
                {Math.abs(pulse.topContributorsResidualBps).toFixed(0)} bps
              </span>
            </li>
          ) : null}
        </ul>
      )}

      {pulse.sleeves.length > 0 ? (
        <>
          <ColTitle sub="by asset class">
            <span className="mt-8 inline-block">Composition</span>
          </ColTitle>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded" role="img" aria-label="Portfolio composition by sleeve">
            {pulse.sleeves.map((s, i) => (
              <span
                key={s.key}
                className="tdy-bar rounded-[1px]"
                style={
                  {
                    flex: s.pct,
                    background: `color-mix(in srgb, var(--brand) ${Math.max(18, 90 - i * 18)}%, var(--surface-3))`,
                    "--d": `${i * 60}ms`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
            {pulse.sleeves.map((s, i) => (
              <li key={s.key} className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted tabular-nums">
                <i
                  className="h-2 w-2 rounded-[2px]"
                  style={{ background: `color-mix(in srgb, var(--brand) ${Math.max(18, 90 - i * 18)}%, var(--surface-3))` }}
                  aria-hidden="true"
                />
                {s.label} {s.pct.toFixed(1)}%
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function PositionsCol({ pulse }: { pulse: PortfolioPulse }) {
  const positions = pulse.topPositions;
  const opps = useHomeSlice("opportunityFeed");
  const maxWt = Math.max(1, ...positions.map((p) => p.weightPct));
  const items = (opps.data?.opportunities ?? []).slice(0, 3);

  return (
    <div>
      <ColTitle sub="top of book">Positions</ColTitle>
      {positions.length === 0 ? (
        <p className="text-sm text-muted">No priced positions yet.</p>
      ) : (
        <table className="w-full border-collapse font-mono text-xs tabular-nums">
          <thead>
            <tr className="border-b border-hairline text-left text-[9px] tracking-[0.16em] text-faint">
              <th scope="col" className="pb-2.5 font-medium">SYM</th>
              <th scope="col" className="pb-2.5 font-medium">WT</th>
              <th scope="col" className="pb-2.5" aria-hidden="true" />
              <th scope="col" className="pb-2.5 text-right font-medium">DAY</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={p.symbol} className="border-b border-hairline transition-colors duration-(--duration-base) hover:bg-surface/70">
                <td className="py-2 pr-2">
                  <Link href={withFromToday(`/research?symbol=${encodeURIComponent(p.symbol)}`)} className="hover:text-brand" title={p.name}>
                    {p.symbol}
                  </Link>
                </td>
                <td className="py-2 pr-2">{p.weightPct.toFixed(1)}%</td>
                <td className="w-[74px] py-2 pr-2">
                  <span
                    className="tdy-bar block h-0.5 rounded-full bg-brand/35"
                    style={{ "--w": p.weightPct / maxWt, "--d": `${i * 60}ms`, width: "100%" } as React.CSSProperties}
                  />
                </td>
                <td className={`py-2 text-right ${p.dayChangePct == null ? "text-faint" : p.dayChangePct < 0 ? "text-negative" : "text-positive"}`}>
                  {p.dayChangePct == null ? "—" : fmtSignedPct(p.dayChangePct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ColTitle sub="entering the pipeline">
        <span className="mt-8 inline-block">Radar</span>
      </ColTitle>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {opps.status === "loading" ? "Scanning…" : "No candidates clear the fit bar right now."}
        </p>
      ) : (
        <ul className="flex flex-col">
          {items.map((o, i) => (
            <li
              key={o.symbol}
              className="group -mx-2.5 flex items-start gap-4 rounded-lg px-2.5 py-3.5 transition-colors duration-(--duration-base) first:pt-1 hover:bg-surface/70 [&+&]:border-t [&+&]:border-hairline"
            >
              <svg
                viewBox="0 0 34 34"
                className="h-[34px] w-[34px] flex-none -rotate-90"
                aria-hidden="true"
                style={{ "--c": RING_C.toFixed(2), "--o": (RING_C * (1 - Math.min(100, o.combinedScore) / 100)).toFixed(2), "--d": `${i * 90}ms` } as React.CSSProperties}
              >
                <circle cx="17" cy="17" r={RING_R} fill="none" stroke="var(--surface-3)" strokeWidth="2" />
                <circle className="tdy-ring-fg" cx="17" cy="17" r={RING_R} />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="flex justify-between gap-3 text-xs">
                  <span className="font-mono font-medium">{o.symbol}</span>
                  <span className="font-mono text-faint tabular-nums">
                    FIT {Math.round(o.combinedScore)}
                    {o.fitTier ? ` · ${o.fitTier.toUpperCase()}` : ""}
                  </span>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-faint">
                  {o.fitDetail ?? (o.absoluteScore != null ? `${o.fitSummary}, quality ${Math.round(o.absoluteScore)}/100` : o.fitSummary)}
                </p>
                <Link
                  href={withFromToday(`/research?symbol=${encodeURIComponent(o.symbol)}`)}
                  className="mt-2 inline-flex translate-y-[3px] items-center gap-1.5 text-[11px] font-semibold text-brand opacity-0 transition-[opacity,transform] duration-(--duration-base) group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100"
                >
                  Open in Research <span aria-hidden="true">→</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

export function BookSection() {
  const pulseSlice = useHomeSlice("portfolioPulse");
  const { refreshDigest } = useHome();
  const [ref, inView] = useArrival<HTMLDivElement>();
  const pulse = pulseSlice.data;

  return (
    <section id="tdy-book" aria-labelledby="tdy-book-h" className="border-b border-hairline py-14 max-md:py-10">
      <div className="tdy-shell">
        <Eyebrow
          id="tdy-book-h"
          note={
            pulse && pulse.dayCoveragePct != null && pulse.dayCoveragePct < 95
              ? `DAY MOVE PRICES ${Math.round(pulse.dayCoveragePct)}% OF BOOK`
              : pulse && !pulse.alignmentConfirmed
                ? "POLICY: ASSUMED DEFAULTS"
                : "POLICY OF RECORD"
          }
        >
          The book — where you stand
        </Eyebrow>

        {pulseSlice.status === "error" && !pulse ? (
          <p className="mt-6 text-sm text-muted">
            Couldn’t read the book.{" "}
            <button type="button" onClick={refreshDigest} className="font-medium text-brand hover:underline">
              Retry
            </button>
          </p>
        ) : pulse && pulse.status === "empty" ? (
          <p className="mt-6 font-serif text-lg text-muted">
            The book is empty — positions, alignment and attribution appear once you{" "}
            <Link href="/portfolio" className="text-brand hover:underline">
              add holdings
            </Link>
            .
          </p>
        ) : pulse ? (
          <div ref={ref} className={`mt-8 grid grid-cols-3 gap-13 max-lg:grid-cols-2 max-lg:gap-10 max-md:grid-cols-1 ${inView ? "is-in" : ""}`}>
            <AlignmentCol pulse={pulse} />
            <AttributionCol pulse={pulse} />
            <PositionsCol pulse={pulse} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
