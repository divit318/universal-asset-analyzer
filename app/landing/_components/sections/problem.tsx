"use client";

import { LineChart, FileText, Table, MessageSquare, Newspaper, Target, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow, EyebrowRule } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { IconTile } from "../primitives/icon-tile";
import { setInkParam } from "../ink/engine";

/**
 * Problem — the Five Shards (ink/movements/shards.ts). Column discipline:
 * heading and copy in the LEFT column, the ink zone is the CENTRE column (a
 * real element), and the five labelled tools are the RIGHT column. The five
 * shards are five structurally different geometries, one per tool: a
 * sawtooth ticker, a page of dense text, a strict lattice, a closed loop
 * going nowhere, and a dispersing burst.
 *
 * Hovering a tool raises its shard to full core brightness and drops the
 * other four to 15%: the cost of attention-switching, felt in the hand.
 */
const TOOLS: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: LineChart, title: "Yahoo Finance", description: "Price data, charts, and market insights." },
  { icon: FileText, title: "EDGAR filings", description: "Raw filings buried in PDFs and text." },
  { icon: Table, title: "Spreadsheets", description: "Manual models and scattered calculations." },
  { icon: MessageSquare, title: "ChatGPT", description: "Answers, but no direct access to your data." },
  { icon: Newspaper, title: "News sites", description: "Noise, opinions, and information overload." },
];

export function Problem({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <div className="grid items-center gap-10 lg:grid-cols-[33fr_34fr_33fr] lg:gap-6">
        {/* LEFT text zone: the argument. */}
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

          {/* The rhetorical turn: the shards briefly try to align here. */}
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

        {/* CENTRE ink zone: the five shards live here and nowhere else. */}
        <div
          aria-hidden="true"
          data-ink-target="problem-ink"
          className="hidden h-[760px] w-full lg:block"
        />

        {/* RIGHT text zone: the five tools, one per shard. */}
        <Reveal delay={280} stagger={70} as="ul" className="flex flex-col">
          {TOOLS.map((tool, i) => (
            <li
              key={tool.title}
              data-problem-item
              onMouseEnter={() => setInkParam("problem.hover", i)}
              onMouseLeave={() => setInkParam("problem.hover", -1)}
              className={`flex items-start gap-4 py-4 transition-colors duration-200 hover:text-foreground ${
                i < TOOLS.length - 1 ? "border-b border-hairline" : ""
              }`}
            >
              <IconTile icon={tool.icon} shape="circle" />
              <div>
                <h3 className="font-serif text-lg font-semibold text-foreground">{tool.title}</h3>
                <p className="mt-1 text-mk-body text-muted">{tool.description}</p>
              </div>
            </li>
          ))}
        </Reveal>
      </div>
    </SectionShell>
  );
}
