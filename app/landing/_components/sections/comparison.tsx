"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldCheck, Shield, Database, FileText, TrendingUp, Lock, Sparkles, Check, X, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { useSectionProgress, useReducedMotion } from "../motion/hooks";

/**
 * Compare — The Ledger, in Movement IV's Silence: ZERO canvas ink. The
 * section is carried entirely by DOM and SVG; the table builds as you
 * descend:
 *   - column rules draw DOWNWARD, staggered left to right by 100ms
 *   - row rules draw ACROSS, staggered top to bottom, scroll-latched
 *   - checkmarks STROKE in like ink (a real two-segment path draw, 240ms)
 *   - X marks do not animate: they fade in flat, gray, 50% alpha, 400ms.
 *     The asymmetry is the argument.
 *   - the UAA column carries a slow brass leaf sweep (6s travel / 14s
 *     period), the one looping effect on the page
 *
 * No-JS / reduced motion: the [data-comp-anim] gate is never set, so every
 * cell renders in its final state. Below 768px the table becomes one stacked
 * card per feature with four labelled cells (fits 375px).
 */
const COMPETITORS = ["UAA", "ChatGPT", "Perplexity", "Bloomberg"] as const;

const ROWS: { icon: LucideIcon; label: string; has: boolean[] }[] = [
  { icon: Shield, label: "Local-first: your data on your device", has: [true, false, false, false] },
  { icon: Database, label: "Research data stored on your device", has: [true, false, false, false] },
  { icon: FileText, label: "SEC filings & fundamentals", has: [true, false, false, true] },
  { icon: TrendingUp, label: "Portfolio & valuation engines", has: [true, false, false, true] },
  { icon: Lock, label: "No subscription required", has: [true, false, false, false] },
];

/** A checkmark that strokes in like ink: two segments, 240ms, ease-out. */
function InkCheck({ uaa, delay }: { uaa: boolean; delay: number }) {
  return (
    <>
      <svg viewBox="0 0 16 16" className={`mx-auto h-4 w-4 ${uaa ? "text-brand" : "text-foreground"}`} aria-hidden="true">
        <path
          d="M3 8.5 L6.5 12 L13 4.5"
          pathLength={1}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transitionDelay: `${delay}ms` }}
          className="transition-[stroke-dashoffset] duration-[240ms] ease-out [stroke-dasharray:1] [stroke-dashoffset:0] [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:[stroke-dashoffset:1]"
        />
      </svg>
      <span className="sr-only">Yes</span>
    </>
  );
}

/** An X that does NOT animate: a flat, gray fade. No rendering care. */
function FlatX() {
  return (
    <>
      <X
        className="mx-auto h-4 w-4 text-foreground opacity-50 transition-opacity duration-[400ms] [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:opacity-0"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className="sr-only">No</span>
    </>
  );
}

/** Static cell for the mobile stacked cards (always final state). */
function StaticCell({ has, uaa }: { has: boolean; uaa: boolean }) {
  return has ? (
    <>
      <Check className={`mx-auto h-4 w-4 ${uaa ? "text-brand" : "text-foreground"}`} strokeWidth={2.5} aria-hidden="true" />
      <span className="sr-only">Yes</span>
    </>
  ) : (
    <>
      <X className="mx-auto h-4 w-4 text-foreground opacity-50" strokeWidth={2} aria-hidden="true" />
      <span className="sr-only">No</span>
    </>
  );
}

export function Comparison({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long" });
  const tableRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const [animArmed, setAnimArmed] = useState(false);

  useEffect(() => {
    if (reduced) return;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- final state
       must render first (SSR/no-JS), then the draw choreography arms. */
    setAnimArmed(true);
  }, [reduced]);

  useSectionProgress(tableRef, (p) => {
    const box = tableRef.current;
    if (!box) return;
    // Scroll-latched: rows rule themselves in as the reader descends.
    box.querySelectorAll<HTMLElement>("[data-comp-row]").forEach((row, i) => {
      if (row.dataset.drawn === "1") return;
      if (p > 0.22 + i * 0.055) row.dataset.drawn = "1";
    });
  });

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
          <div className="rounded-[20px] border border-border bg-surface/50 px-5 py-12 sm:px-10">
            <SectionHeader
              eyebrow="Compare"
              headingId={headingId}
              segments={[{ text: "How UAA" }, { text: "stacks up", tone: "accent" }]}
            />

            {/* Desktop/tablet table */}
            <div
              ref={tableRef}
              data-comp-anim={animArmed ? "" : undefined}
              className="mt-mk-lead hidden md:block"
            >
              <table className="w-full border-separate border-spacing-0 text-mk-body">
                <caption className="sr-only">
                  Feature comparison of UAA against ChatGPT, Perplexity, and Bloomberg
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="p-3 text-left font-medium text-muted" />
                    {COMPETITORS.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`relative p-3 text-center font-semibold ${
                          c === "UAA"
                            ? "rounded-t-card border-x border-t border-brand bg-brand-muted text-brand"
                            : "text-muted"
                        }`}
                      >
                        {c === "UAA" ? (
                          <span className="flex items-center justify-center gap-1.5">
                            <ShieldCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                            UAA
                          </span>
                        ) : (
                          c
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, ri) => (
                    <tr key={row.label} data-comp-row className="group">
                      <th
                        scope="row"
                        className="relative border-t border-transparent p-3 text-left font-normal text-foreground transition-colors group-hover:bg-surface-2/70"
                      >
                        {/* The row rule: draws ACROSS, left to right. */}
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-px origin-left bg-hairline transition-transform duration-[240ms] ease-out [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:scale-x-0"
                        />
                        <span className="flex items-center gap-2.5">
                          <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                          {row.label}
                        </span>
                      </th>
                      {row.has.map((has, ci) => {
                        const uaa = COMPETITORS[ci] === "UAA";
                        return (
                          <td
                            key={COMPETITORS[ci]}
                            className={`relative border-t border-transparent p-3 text-center transition-colors ${
                              uaa
                                ? `overflow-hidden border-x border-brand bg-brand-muted ${ri === ROWS.length - 1 ? "rounded-b-card border-b" : ""}`
                                : "group-hover:bg-surface-2/70"
                            }`}
                          >
                            {/* Row rule continues across this cell (staggered by column). */}
                            <span
                              aria-hidden="true"
                              style={{ transitionDelay: `${ci * 100}ms` }}
                              className={`absolute inset-x-0 top-0 h-px origin-left transition-transform duration-[240ms] ease-out [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:scale-x-0 ${uaa ? "bg-brand/30" : "bg-hairline"}`}
                            />
                            {/* Column rule: draws DOWNWARD, staggered left to right. */}
                            {!uaa && (
                              <span
                                aria-hidden="true"
                                style={{ transitionDelay: `${100 + ci * 100}ms` }}
                                className="absolute bottom-0 left-0 top-0 w-px origin-top bg-hairline/70 transition-transform duration-[240ms] ease-out [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:scale-y-0"
                              />
                            )}
                            {/* The brass leaf sweep: one soft light travelling the
                                UAA column, sequenced cell to cell. */}
                            {uaa && (
                              <span
                                aria-hidden="true"
                                style={{ animationDelay: `${1200 + ri * 950}ms` }}
                                className="pointer-events-none absolute inset-x-0 top-0 h-full animate-mk-leaf-sweep bg-gradient-to-b from-transparent via-brand/12 to-transparent motion-reduce:animate-none motion-reduce:opacity-0"
                              />
                            )}
                            {has ? <InkCheck uaa={uaa} delay={240 + ci * 60} /> : <FlatX />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: one stacked card per feature (readable at 375px). */}
            <ul className="mt-mk-lead flex flex-col gap-3 md:hidden">
              {ROWS.map((row) => (
                <li key={row.label} className="rounded-card border border-hairline bg-surface-2/50 p-4">
                  <p className="flex items-center gap-2.5 text-mk-body font-medium text-foreground">
                    <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                    {row.label}
                  </p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {row.has.map((has, i) => (
                      <div
                        key={COMPETITORS[i]}
                        className={`flex flex-col items-center gap-1 rounded-control px-1 py-2 ${
                          COMPETITORS[i] === "UAA" ? "border border-brand/40 bg-brand-muted" : "bg-surface-3/50"
                        }`}
                      >
                        <span className={`text-micro font-medium ${COMPETITORS[i] === "UAA" ? "text-brand" : "text-muted"}`}>
                          {COMPETITORS[i]}
                        </span>
                        <StaticCell has={has} uaa={COMPETITORS[i] === "UAA"} />
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>

            {/* Closing pill + honesty caption: the most credible sentence on
                the page, faded in last, unanimated. */}
            <div className="mt-mk-lead flex flex-col items-center gap-3">
              <p className="flex items-center gap-2.5 rounded-full border border-border bg-surface px-5 py-3 text-center text-mk-small text-foreground">
                <Sparkles className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} aria-hidden="true" />
                <span>
                  UAA combines the power of AI with the <span className="text-brand">privacy</span> and{" "}
                  <span className="text-brand">depth</span> serious investors demand.
                </span>
              </p>
              <p className="text-caption text-muted">
                Comparison reflects publicly documented capabilities as of{" "}
                <span className="font-mono tabular-nums">{today}</span>.
              </p>
            </div>
          </div>
    </SectionShell>
  );
}
