"use client";

import { Target } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow, EyebrowRule } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { IconTile } from "../primitives/icon-tile";
import { FragmentationDiagram } from "./problem-diagram";

/**
 * Problem — two columns sharing one top edge: the argument on the left (the
 * hero's column width, so the page keeps one left edge), and the
 * fragmentation diagram on the right (problem-diagram.tsx) — five labelled
 * tool islands whose connections are drawn but severed. The diagram absorbs
 * the old tool list and replaces the decorative ink shards; it is the
 * section's evidence, not its ornament.
 */
export function Problem({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <div className="grid items-start gap-12 lg:grid-cols-[52fr_48fr] lg:gap-8">
        {/* LEFT: the argument. */}
        <div className="flex flex-col items-start">
          <Reveal delay={0}>
            <OrnamentalEyebrow variant="left">The problem</OrnamentalEyebrow>
          </Reveal>
          <Reveal delay={90}>
            <TwoToneHeadline
              id={headingId}
              align="left"
              className="mt-mk-eyebrow"
              segments={[
                { text: "Why does research feel", block: true },
                { text: "so fragmented?", tone: "accent", block: true },
              ]}
            />
          </Reveal>
          <Reveal delay={140}>
            <EyebrowRule className="mt-mk-headline w-full max-w-64" />
          </Reveal>
          <Reveal delay={180}>
            <p data-lead className="mt-mk-headline text-pretty text-mk-lead text-muted">
              Every day you hop between Yahoo Finance, EDGAR PDFs, spreadsheets, and ChatGPT. All
              that data, and still hours go by without a single insight.
            </p>
          </Reveal>

          <Reveal delay={280} className="mt-10">
            <div className="flex items-center gap-4 rounded-full border border-brand/20 bg-surface/80 py-3 pl-3 pr-7">
              <IconTile icon={Target} shape="circle" />
              <div>
                <p className="text-mk-body font-medium text-foreground">
                  Fragmented tools. Scattered data. Lost insights.
                </p>
                <p className="text-mk-body text-brand">There has to be a better way.</p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* RIGHT: the evidence. Five islands, no completed connection. */}
        <FragmentationDiagram />
      </div>
    </SectionShell>
  );
}
