"use client";

import { useEffect, useRef, useState } from "react";
import { Compass, Database, Cpu, FileText, PieChart, Sparkles, Wallet, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { useSectionProgress, useReducedMotion } from "../motion/hooks";

/**
 * Compare — The Ledger, rebuilt (2026-08-11) from a ✓/✗ scoreboard into a
 * statement of design objectives. The old table claimed general assistants
 * "lack SEC filings" — indefensible in a world where they browse — and made
 * the section read as an attack. The new one compares what each CATEGORY of
 * tool is built for, in words, and lets UAA's architecture speak for itself.
 * Categories, not brand names, so the table cannot rot as vendors ship.
 *
 * Motion survives the rebuild: row rules draw ACROSS as you descend
 * (scroll-latched), the UAA column carries the slow brass leaf sweep (the
 * one looping effect on the page), and the UAA cell text is set in
 * foreground ink while the neighbouring categories sit muted — hierarchy by
 * tone, not by checkmark asymmetry.
 *
 * No-JS / reduced motion: the [data-comp-anim] gate is never set, so every
 * cell renders in its final state. Below 768px the table becomes one stacked
 * card per dimension with three labelled cells (fits 375px).
 */
const COLUMNS = ["UAA", "General AI chat", "Institutional terminals"] as const;

interface CompareRow {
  icon: LucideIcon;
  label: string;
  /** One cell per column, same order as COLUMNS. */
  cells: [string, string, string];
}

const ROWS: CompareRow[] = [
  {
    icon: Compass,
    label: "Built as",
    cells: ["A research terminal on your hardware", "A general-purpose assistant", "An enterprise data platform"],
  },
  {
    icon: Database,
    label: "Your research lives",
    cells: ["On your disk, one SQLite file", "On the provider's servers", "On vendor infrastructure"],
  },
  {
    icon: Cpu,
    label: "Numbers computed by",
    cells: ["Deterministic engines, on your machine", "The language model, in prose", "Licensed vendor systems"],
  },
  {
    icon: FileText,
    label: "Provenance",
    cells: ["Every figure keeps source and date", "Citations, when the mode provides them", "Vendor-verified, inside the platform"],
  },
  {
    icon: PieChart,
    label: "Portfolio context",
    cells: ["Computed from your actual lots", "Whatever you paste into the chat", "Enterprise portfolio modules"],
  },
  {
    icon: Sparkles,
    label: "The AI layer",
    cells: ["Optional — your provider, your account", "The product itself", "Bundled vendor assistants"],
  },
  {
    icon: Wallet,
    label: "Cost to run",
    cells: ["Free; your AI provider bills you directly", "Free tiers to ~$20+/month", "Enterprise contracts"],
  },
];

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
      if (p > 0.18 + i * 0.05) row.dataset.drawn = "1";
    });
  });

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
          <div className="rounded-[20px] border border-border bg-surface/50 px-5 py-12 sm:px-10">
            <SectionHeader
              eyebrow="Compare"
              headingId={headingId}
              segments={[{ text: "Three tools," }, { text: "three different jobs.", tone: "accent" }]}
              lead={
                <>
                  General assistants and institutional terminals are excellent at what they are
                  built for. UAA is built for something else: research you can audit, on hardware
                  you own.
                </>
              }
              className="items-center"
            />

            {/* Desktop/tablet table */}
            <div
              ref={tableRef}
              data-comp-anim={animArmed ? "" : undefined}
              className="mt-mk-lead hidden md:block"
            >
              <table className="w-full table-fixed border-separate border-spacing-0 text-mk-body">
                <caption className="sr-only">
                  Design objectives of UAA compared with general AI chat apps and institutional
                  terminals
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[19%] p-3 text-left font-medium text-muted" />
                    {COLUMNS.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`p-3 text-left font-semibold ${
                          c === "UAA"
                            ? "w-[29%] rounded-t-card border-x border-t border-brand bg-brand-muted text-brand"
                            : "w-[26%] text-muted"
                        }`}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row, ri) => (
                    <tr key={row.label} data-comp-row className="group align-top">
                      <th
                        scope="row"
                        className="relative border-t border-transparent p-3 text-left font-normal text-foreground transition-colors group-hover:bg-surface-2/70"
                      >
                        {/* The row rule: draws ACROSS, left to right. */}
                        <span
                          aria-hidden="true"
                          className="absolute inset-x-0 top-0 h-px origin-left bg-hairline transition-transform duration-[240ms] ease-out [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:scale-x-0"
                        />
                        <span className="flex items-center gap-2.5 text-mk-small font-medium">
                          <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                          {row.label}
                        </span>
                      </th>
                      {row.cells.map((cell, ci) => {
                        const uaa = COLUMNS[ci] === "UAA";
                        return (
                          <td
                            key={COLUMNS[ci]}
                            className={`relative border-t border-transparent p-3 text-left transition-colors ${
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
                            <span
                              style={{ transitionDelay: `${180 + ci * 80}ms` }}
                              className={`block text-mk-small transition-opacity duration-[400ms] [[data-comp-anim]_[data-comp-row]:not([data-drawn])_&]:opacity-0 ${
                                uaa ? "font-medium text-foreground" : "text-muted"
                              }`}
                            >
                              {cell}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: one stacked card per dimension (readable at 375px). */}
            <ul className="mt-mk-lead flex flex-col gap-3 md:hidden">
              {ROWS.map((row) => (
                <li key={row.label} className="rounded-card border border-hairline bg-surface-2/50 p-4">
                  <p className="flex items-center gap-2.5 text-mk-body font-medium text-foreground">
                    <row.icon className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.75} aria-hidden="true" />
                    {row.label}
                  </p>
                  <div className="mt-3 flex flex-col gap-1.5">
                    {row.cells.map((cell, i) => {
                      const uaa = COLUMNS[i] === "UAA";
                      return (
                        <div
                          key={COLUMNS[i]}
                          className={`rounded-control px-3 py-2 ${uaa ? "border border-brand/40 bg-brand-muted" : "bg-surface-3/50"}`}
                        >
                          <p className={`text-micro font-medium uppercase tracking-wide ${uaa ? "text-brand" : "text-muted"}`}>
                            {COLUMNS[i]}
                          </p>
                          <p className={`mt-0.5 text-mk-small ${uaa ? "font-medium text-foreground" : "text-muted"}`}>{cell}</p>
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>

            {/* Honesty caption: the most credible sentence in the section. */}
            <div className="mt-mk-lead flex flex-col items-center gap-1.5">
              <p className="text-center text-caption text-muted">
                Categories, not scoreboards: each column describes a class of product as publicly
                documented as of <span className="font-mono tabular-nums">{today}</span>.
              </p>
            </div>
          </div>
    </SectionShell>
  );
}
