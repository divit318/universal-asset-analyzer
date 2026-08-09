"use client";

import { useRef } from "react";
import {
  CandlestickChart,
  FileText,
  SlidersHorizontal,
  PieChart,
  Sparkles,
  AudioLines,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { IconTile } from "../primitives/icon-tile";
import { ParticleField } from "../primitives/particle-field";
import { useSectionProgress, useReducedMotion } from "../motion/hooks";

/**
 * Solution — the Braid (second half of Movement II). The five currents
 * re-braid here through the right gutter,
 * scroll-scrubbed (ink/movements/fracture.ts), and the braid resolves into the
 * sparkline of the "Market performance" card: the ink becomes the product's
 * own chart. The five feature rows illuminate in sequence as the braid
 * passes their scroll thresholds — once each, latched, never replayed.
 *
 * No-JS and reduced motion: rows render fully lit (illumination only dims
 * below threshold after hydration, and only when motion is allowed).
 */
const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: CandlestickChart, title: "Market data", description: "Prices, charts, and fundamentals from public sources." },
  { icon: FileText, title: "SEC financials", description: "Filing data, income statements, and more." },
  { icon: SlidersHorizontal, title: "Dynamic screeners", description: "Build and scan with any metric." },
  { icon: PieChart, title: "Portfolio analytics", description: "Risk, performance, and attribution." },
  { icon: Sparkles, title: "In-app AI analyst", description: "Narrated insights, tailored to you." },
];

/* Hand-authored index rows: name, sparkline path (48x16 box), level, delta. */
const INDICES = [
  { name: "S&P 500", path: "M0 12 L8 10 L16 11 L24 7 L32 8 L40 4 L48 5", level: "5,299.70", delta: "+1.12%", up: true },
  { name: "NASDAQ 100", path: "M0 13 L8 11 L16 12 L24 8 L32 9 L40 5 L48 3", level: "18,573.13", delta: "+1.35%", up: true },
  { name: "VIX", path: "M0 6 L8 9 L16 7 L24 10 L32 9 L40 12 L48 11", level: "13.42", delta: "-2.30%", up: false },
];

function MarketsPanel() {
  return (
    <div className="rounded-card border border-hairline bg-surface-2/60 p-4">
      <p className="text-mk-small font-semibold text-foreground">Markets at a glance</p>
      <ul className="mt-3 flex flex-col divide-y divide-hairline">
        {INDICES.map((ix) => (
          <li key={ix.name} className="flex items-center gap-3 py-2.5">
            <span className="w-20 shrink-0 text-mk-small text-muted">{ix.name}</span>
            <svg viewBox="0 0 48 16" className="h-4 w-12 shrink-0 text-brand" aria-hidden="true">
              <path d={ix.path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="ml-auto text-right">
              <span className="block font-mono text-mk-small font-medium tabular-nums text-foreground">{ix.level}</span>
              <span className={`block font-mono text-caption tabular-nums ${ix.up ? "text-positive" : "text-negative"}`}>
                {ix.delta}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PerformancePanel() {
  return (
    <div className="rounded-card border border-hairline bg-surface-2/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-mk-small font-semibold text-foreground">Market performance</p>
        <span className="flex items-center gap-1 rounded-control border border-hairline bg-surface-3 px-2 py-0.5 font-mono text-caption tabular-nums text-muted">
          6M
          <ChevronDown className="h-3 w-3" strokeWidth={2} />
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex flex-col justify-between py-0.5 text-right font-mono text-micro tabular-nums text-muted">
          <span>600</span>
          <span>550</span>
          <span>500</span>
          <span>450</span>
        </div>
        {/* The ink braid resolves INTO this sparkline (ink target). */}
        <svg
          viewBox="0 0 260 80"
          data-ink-target="solution-sparkline"
          className="h-24 w-full text-brand"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            data-draw-path
            d="M0 66 L18 58 L34 62 L52 40 L70 46 L88 30 L106 38 L124 44 L142 34 L160 40 L178 28 L196 34 L214 22 L232 28 L252 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="252" cy="14" r="3.5" fill="currentColor" />
        </svg>
      </div>
      <div className="mt-1.5 flex justify-between pl-8 font-mono text-micro tabular-nums text-muted">
        {["Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
    </div>
  );
}

function BriefPanel() {
  return (
    <div className="relative overflow-hidden rounded-card border border-hairline bg-surface-2/60 p-4">
      <ParticleField variant="card-interior" className="inset-x-0 bottom-0 h-2/3 w-full" />
      <div className="relative flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 text-brand">
          <AudioLines className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-mk-small font-semibold text-foreground">AI Analyst Brief</p>
          <p className="mt-1 max-w-md text-mk-small text-muted">
            AI-narrated market and portfolio insights, personalized to what matters most.
          </p>
        </div>
        {/* No audio narration exists in the product, so no play affordance:
            a "Read brief" text link stands in (decorative inside the mockup). */}
        <span className="shrink-0 self-center text-mk-small font-medium text-brand underline decoration-brand/40 underline-offset-4">
          Read brief
        </span>
      </div>
    </div>
  );
}

/** Feature rows that illuminate, once each, as the braid passes them. */
function FeatureList() {
  const listRef = useRef<HTMLUListElement | null>(null);
  const reduced = useReducedMotion();

  useSectionProgress(listRef, (p) => {
    const list = listRef.current;
    if (!list) return;
    const rows = list.querySelectorAll<HTMLElement>("[data-solution-row]");
    rows.forEach((row, i) => {
      // Latched: rows light once and stay lit on every later scroll pass.
      if (row.dataset.lit === "1") return;
      if (p > 0.32 + i * 0.07) row.dataset.lit = "1";
    });
  });

  const dim = reduced ? "" : "[&:not([data-lit])]:opacity-55";
  const rule = reduced
    ? ""
    : "[[data-solution-row]:not([data-lit])_&]:scale-x-0";

  return (
    <Reveal delay={280} className="w-full">
      <ul ref={listRef} className="flex w-full flex-col">
        {FEATURES.map((f, i) => (
          <li
            key={f.title}
            data-solution-row
            className={`relative flex items-center gap-4 ${i === 0 ? "pb-4" : "py-4"} transition-opacity duration-500 ${dim}`}
          >
            <IconTile icon={f.icon} shape="circle" />
            <div>
              <p className="text-mk-body font-semibold text-foreground">{f.title}</p>
              <p className="text-mk-small text-muted">{f.description}</p>
            </div>
            {i < FEATURES.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute bottom-0 left-0 h-px w-full origin-left bg-brand/35 transition-transform duration-300 ease-out ${rule}`}
              />
            )}
          </li>
        ))}
      </ul>
    </Reveal>
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
          <TwoToneHeadline
            id={headingId}
            align="left"
            className="mt-mk-eyebrow"
            segments={[
              { text: "Meet the Universal", block: true },
              { text: "Asset Analyzer", block: true },
              { text: ".", tone: "accent", tight: true },
            ]}
          />
        </Reveal>
        <Reveal delay={180}>
          <p data-lead className="mt-mk-headline max-w-measure-prose text-pretty text-mk-lead text-muted">
            One app for all your investment research, with AI narration on your own key.
          </p>
        </Reveal>
      </div>

      {/* Column discipline: feature list LEFT, the Lens's ink zone CENTRE (a
          real element, continuous with the Problem section's centre column),
          dashboard RIGHT. The lens resolves into the dashboard's sparkline. */}
      <div className="mt-mk-lead grid items-center gap-12 lg:grid-cols-[33fr_34fr_33fr] lg:gap-6">
        <FeatureList />

        <div aria-hidden="true" data-ink-target="solution-ink" className="hidden h-[460px] w-full lg:block" />

        {/* Right column: the illustrative dashboard. The amber glow ramps in
            over 900ms after landing. */}
        <Reveal delay={280}>
          <div
            role="img"
            aria-label="Illustrative UAA dashboard: markets at a glance with index levels and sparklines, a market performance chart, and an AI Analyst Brief panel."
            className="relative w-full rounded-[20px] border border-brand/25 bg-surface p-4 shadow-glow-brand transition-[box-shadow] delay-700 duration-[900ms] [[data-reveal=hidden]_&]:shadow-none [[data-reveal=hidden]_&]:delay-0"
          >
            <div aria-hidden="true" className="grid gap-3">
              <MarketsPanel />
              <PerformancePanel />
              <BriefPanel />
            </div>
            <svg
              data-illustrative
              aria-hidden="true"
              className="pointer-events-none absolute bottom-[11px] right-[11px] h-[9px] w-[76px] opacity-30"
              viewBox="0 0 76 9"
            >
              <text x="76" y="8" textAnchor="end" className="fill-foreground font-sans" fontSize="8" letterSpacing="1.5">
                ILLUSTRATIVE
              </text>
            </svg>
          </div>
        </Reveal>
      </div>
    </SectionShell>
  );
}
