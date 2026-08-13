"use client";

import { Fragment } from "react";
import {
  LineChart,
  FileText,
  Table,
  MessageSquare,
  Newspaper,
  type LucideIcon,
} from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { TrustStrip } from "../primitives/trust-strip";

/**
 * Solution. Three zones: the trace demonstration LEFT (one real metric
 * shown with its full provenance chain, replacing the old feature list),
 * the Streams ink zone CENTRE (ink/movements/streams.ts: the Problem
 * section's five severed sources, now joined, converging into the product),
 * and the product panel RIGHT, which the streams land on at its port.
 *
 * No-JS and reduced motion: everything renders in its settled, fully
 * visible state (Reveal semantics; the streams render converged).
 */
/**
 * The five stream sources: EXACTLY the Problem section's five islands
 * (problem-diagram.tsx NODES): same names, same order, same icons. The
 * reader who just scrolled past the severed islands recognises them here,
 * now joined. Do not substitute feature names; these are inputs.
 */
const SOURCES: { icon: LucideIcon; label: string }[] = [
  { icon: LineChart, label: "Yahoo Finance" },
  { icon: FileText, label: "EDGAR filings" },
  { icon: Table, label: "Spreadsheets" },
  { icon: MessageSquare, label: "ChatGPT" },
  { icon: Newspaper, label: "News sites" },
];

/**
 * The trace demonstration: ONE real metric with its full provenance chain.
 * Every value below is a real fact from Apple's FY2025 Form 10-K as filed
 * with the SEC (accession 0000320193-25-000079, filed 2025-10-31, period
 * ended 2025-09-27), read from EDGAR's XBRL companyconcept API, the same
 * source lib/statements.ts computes from, with the same derivation
 * (freeCashFlow = opCashFlow − capex). Baked static by design: the landing
 * page never fetches. If these numbers are ever edited, they must be
 * re-verified against the filing, not invented.
 */
const TRACE = {
  metric: "Free cash flow",
  scope: "AAPL · FY2025",
  figure: "$98.8B",
  rows: [
    { op: "", label: "Operating cash flow", tag: "us-gaap:NetCashProvidedByUsedInOperatingActivities", value: "111,482" },
    { op: "\u2212", label: "Capital expenditure", tag: "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment", value: "12,715" },
    { op: "=", label: "Free cash flow", tag: "derived deterministically, $ millions", value: "98,767" },
  ],
  source: "Apple Inc. Form 10-K, fiscal year ended Sep 27, 2025",
  filed: "Filed Oct 31, 2025 · SEC EDGAR · 0000320193-25-000079",
};

/** The five capability names, demoted to supporting context (Phase 3.4):
 *  a compact inline row, no icons, no divided list. */
const FEATURES = ["Market data", "SEC financials", "Dynamic screeners", "Portfolio analytics", "In-app AI analyst"];

/**
 * The panel's five-year series: real figures from Apple's 10-K filings.
 * FY2021 and FY2022 facts are from accession 0000320193-23-000106 (filed
 * 2023-11-03); FY2023 through FY2025 from 0000320193-25-000079 (filed
 * 2025-10-31). Free cash flow = operating cash flow minus capex, the same
 * derivation lib/statements.ts ships. Values in $ billions, one decimal.
 */
const PANEL_YEARS = [
  { fy: "FY21", revenue: 365.8, fcf: 93.0 },
  { fy: "FY22", revenue: 394.3, fcf: 111.4 },
  { fy: "FY23", revenue: 383.3, fcf: 99.6 },
  { fy: "FY24", revenue: 391.0, fcf: 108.8 },
  { fy: "FY25", revenue: 416.2, fcf: 98.8 },
];
const PANEL_SCALE = 420; // axis max, $B

/** FY2025 margins, derived from the same filing (of revenue 416,161):
 *  gross 195,201 · operating 133,050 · net 112,010, all $M. */
const PANEL_MARGINS = [
  { label: "Gross", value: "46.9%" },
  { label: "Operating", value: "32.0%" },
  { label: "Net", value: "26.9%" },
];

/**
 * ResearchPanel: a rendering of the Research Hub's financial-trend surface
 * (app/research/_components/charts.tsx RevenueFcfChart, whose title and
 * subtitle are quoted verbatim), populated with the real series above. The
 * FY25 free cash flow bar is the SAME number the trace demo derives: the
 * panel shows the screen where that number lives. Palette stays brass and
 * slate; nothing here is a gain or a loss, so the green/red pair the old
 * fabricated markets card needed is gone with it.
 */
function ResearchPanel() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {/* Chrome: where in the product this surface lives. */}
      <div className="flex items-baseline justify-between px-1">
        <p className="font-mono text-caption text-muted">Research Hub</p>
        <p className="font-mono text-caption text-foreground">
          AAPL <span className="text-muted">· Apple Inc.</span>
        </p>
      </div>

      {/* The product's tab row, Financials active. */}
      <div className="flex gap-4 border-b border-hairline px-1 pb-2 text-mk-small text-muted">
        <span>Conviction</span>
        <span className="relative font-medium text-foreground">
          Financials
          <span className="absolute inset-x-0 -bottom-[9px] h-px bg-brand" />
        </span>
        <span>Ownership</span>
      </div>

      {/* RevenueFcfChart, re-set in the landing palette. */}
      <div className="rounded-card border border-hairline bg-surface-2/60 p-4">
        <p className="text-mk-small font-semibold text-foreground">Revenue &amp; free cash flow</p>
        <p className="mt-0.5 text-caption text-muted">$ billions, by fiscal year</p>
        <div className="mt-3 flex h-32 items-end gap-3">
          {PANEL_YEARS.map((y) => (
            <div key={y.fy} className="flex h-full flex-1 items-end justify-center gap-1">
              <div
                className="w-1/2 rounded-t-xs bg-brand/35"
                style={{ height: `${(y.revenue / PANEL_SCALE) * 128}px` }}
              />
              <div className="relative w-1/2">
                {y.fy === "FY25" && (
                  <span className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-micro font-medium tabular-nums text-brand">
                    98.8
                  </span>
                )}
                <div
                  className={`w-full rounded-t-xs ${y.fy === "FY25" ? "bg-brand-strong" : "bg-brand/75"}`}
                  style={{ height: `${(y.fcf / PANEL_SCALE) * 128}px` }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-3">
          {PANEL_YEARS.map((y) => (
            <span key={y.fy} className="flex-1 text-center font-mono text-micro tabular-nums text-muted">
              {y.fy}
            </span>
          ))}
        </div>
        <div className="mt-3 flex gap-4 border-t border-hairline pt-2.5 text-caption text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-brand/35" /> Revenue
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-xs bg-brand/75" /> Free cash flow
          </span>
        </div>
      </div>

      {/* MarginTrendChart's headline stats, FY2025. */}
      <div className="rounded-card border border-hairline bg-surface-2/60 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-mk-small font-semibold text-foreground">Margins</p>
          <p className="text-caption text-muted">FY2025, % of revenue</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {PANEL_MARGINS.map((m) => (
            <div key={m.label} className="rounded-control bg-surface-3/60 px-2.5 py-2">
              <p className="text-micro uppercase tracking-wide text-muted">{m.label}</p>
              <p className="mt-0.5 font-mono text-mk-body font-semibold tabular-nums text-foreground">{m.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * TraceDemo: description replaced with demonstration. One real figure, its
 * inputs, the filing they came from, and the filing date, laid out so the
 * derivation is visible: the number is computed, not asserted. The chain
 * reveals downward from the figure to the source (Reveal stagger, once,
 * final state under no-JS and reduced motion). Deliberately NOT the
 * Problem section's icon-badge list structure: a spined ledger block.
 */
function TraceDemo() {
  return (
    <div className="w-full min-w-0 max-w-100">
      <Reveal delay={280} stagger={90}>
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-caption uppercase tracking-[0.14em] text-muted">
          One number, back to its filing
          <span className="normal-case tracking-normal text-brand">{TRACE.scope}</span>
        </p>
        <p className="mt-4 font-mono text-[3rem] font-semibold leading-none tabular-nums text-foreground">
          {TRACE.figure}
        </p>
        <p className="mt-3 text-mk-small text-muted">
          {TRACE.metric}. Not quoted from a website: computed from the filing&apos;s own facts,
          with every input shown below.
        </p>

        {/* The derivation: the arithmetic itself, on a brass spine. */}
        <dl className="mt-6 flex flex-col gap-3.5 border-l border-brand/40 pl-4">
          {TRACE.rows.map((row) => (
            <div key={row.label} className="flex items-start gap-2">
              <dt className="flex min-w-0 flex-1 flex-col">
                <span className="text-mk-small text-foreground">
                  <span aria-hidden="true" className="mr-1.5 inline-block w-3 font-mono text-brand">
                    {row.op}
                  </span>
                  {row.label}
                </span>
                <span className="truncate pl-4.5 font-mono text-micro text-muted">{row.tag}</span>
              </dt>
              <dd
                className={`shrink-0 font-mono text-mk-small font-medium tabular-nums ${
                  row.op === "=" ? "text-brand" : "text-foreground"
                }`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        {/* The source: filing, date, accession. The end of the chain. */}
        <div className="mt-5 border-l border-hairline pl-4">
          <p className="text-mk-small text-foreground">{TRACE.source}</p>
          <p className="mt-0.5 font-mono text-micro text-muted">{TRACE.filed}</p>
        </div>

        {/* The five capabilities, demoted to one supporting line. Spaces
            around the interpuncts give the line its wrap points; each name
            itself never breaks. */}
        <p className="mt-7 border-t border-hairline pt-5 text-mk-small leading-relaxed text-muted">
          {FEATURES.map((f, i) => (
            <Fragment key={f}>
              {i > 0 && <span aria-hidden="true" className="text-brand">{" · "}</span>}
              <span className="whitespace-nowrap">{f}</span>
            </Fragment>
          ))}
        </p>
      </Reveal>
    </div>
  );
}

export function Solution({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      {/* Header spans the full measure so the forced two-line break renders
          as exactly two lines at 1440/1280/1024 (harness-verified). */}
      <div className="flex flex-col items-start">
        <Reveal delay={0}>
          <OrnamentalEyebrow variant="left">The solution</OrnamentalEyebrow>
        </Reveal>
        <Reveal delay={90}>
          {/* The section is already labelled THE SOLUTION, so the headline
              asserts the mechanism the graphic shows; the product name
              carries the subhead instead. */}
          <TwoToneHeadline
            id={headingId}
            align="left"
            className="mt-mk-eyebrow"
            segments={[
              { text: "Five sources in.", block: true },
              { text: "One workbench out.", tone: "accent", block: true },
            ]}
          />
        </Reveal>
        <Reveal delay={180}>
          <p data-lead className="mt-mk-headline max-w-measure-prose text-pretty text-mk-lead text-muted">
            The Universal Asset Analyzer joins all five in one workbench, where each number arrives
            with the chain that produced it.
          </p>
        </Reveal>
      </div>

      {/* Column discipline: trace demo LEFT, the Streams' ink zone CENTRE
          (a real element), product panel RIGHT. The five streams enter at
          the zone's left edge, labelled with the Problem section's five
          sources, and converge into the panel's port on its left edge. */}
      <div className="mt-mk-lead grid items-start gap-12 lg:grid-cols-[33fr_34fr_33fr] lg:gap-6">
        <TraceDemo />

        <div aria-hidden="true" data-ink-ignore className="relative hidden h-[500px] w-full lg:block">
          <div data-ink-target="solution-ink" className="absolute inset-0" />
          {/* Stream origin labels: mono, small, low opacity, pinned to the
              five lane origins. Decorative repetition of the Problem
              section's five sources (already named there for AT users).
              The streams' origins are inset past the label column
              (streams.ts INSET), so the scatter never drowns the text. */}
          {SOURCES.map((s, i) => (
            <span
              key={s.label}
              className="absolute left-0 flex -translate-y-1/2 items-center gap-1.5 font-mono text-caption tracking-wide text-muted"
              style={{ top: `${(i + 0.5) * 20}%` }}
            >
              <s.icon className="h-3.5 w-3.5 text-brand opacity-80" strokeWidth={1.75} />
              {s.label}
            </span>
          ))}
        </div>

        {/* Right column: the product panel. The amber glow ramps in over
            900ms after landing. Real content, so no ILLUSTRATIVE watermark:
            the caption below states exactly what the panel is instead. */}
        <Reveal delay={280}>
          {/* Below lg the canvas streams have no legible runway, so the
              convergence collapses to this static variant: the same five
              labels, joined by curves that pour into the panel below. */}
          <div aria-hidden="true" className="mb-2 flex items-center gap-3 lg:hidden">
            <ul className="flex shrink-0 flex-col gap-2.5">
              {SOURCES.map((s) => (
                <li key={s.label} className="flex items-center gap-1.5 font-mono text-caption tracking-wide text-muted">
                  <s.icon className="h-3.5 w-3.5 text-brand opacity-80" strokeWidth={1.75} />
                  {s.label}
                </li>
              ))}
            </ul>
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="h-36 min-w-0 flex-1 text-brand"
            >
              {[6, 28, 50, 72, 94].map((y) => (
                <path
                  key={y}
                  d={`M 0 ${y} C 38 ${y}, 70 ${y * 0.32 + 60}, 90 96`}
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity="0.45"
                  strokeWidth="1.25"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <circle cx="90" cy="96" r="2.5" fill="currentColor" fillOpacity="0.8" />
            </svg>
          </div>
          <div
            role="img"
            aria-label="UAA Research Hub, Financials tab for Apple: revenue and free cash flow by fiscal year 2021 to 2025 with FY2025 margins, every figure derived from SEC filings."
            className="relative w-full rounded-[20px] border border-brand/25 bg-surface p-4 shadow-glow-brand transition-[box-shadow] delay-700 duration-[900ms] [[data-reveal=hidden]_&]:shadow-none [[data-reveal=hidden]_&]:delay-0"
          >
            {/* The port: where the five streams land. A small brass notch on
                the panel's left edge, aligned with the convergence apex. */}
            <span
              aria-hidden="true"
              data-ink-target="solution-port"
              className="absolute -left-px top-[42%] hidden h-8 w-1 -translate-y-1/2 rounded-full bg-brand/70 lg:block"
            />
            <ResearchPanel />
          </div>
          <p className="mt-2.5 px-1 text-right font-mono text-micro text-muted">
            Rendered view of the Research Hub. All figures from Apple&apos;s 10-K filings.
          </p>
        </Reveal>
      </div>

      {/* The four trust claims close the section: they substantiate "one
          intelligent analysis workbench" — how it is built (local-first,
          deterministic) and how it is paid for (your key, no subscription).
          Bare here: a quiet typographic footer to the argument above, not
          the hero's bordered pill. */}
      <Reveal delay={360} className="mt-mk-lead border-t border-hairline pt-mk-group">
        <TrustStrip variant="bare" />
      </Reveal>
    </SectionShell>
  );
}
