import { LineChart, FileText, Table, MessageSquare, Newspaper, Target, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { EyebrowRule } from "../primitives/ornamental-eyebrow";
import { IconTile } from "../primitives/icon-tile";
import { ParticleField } from "../primitives/particle-field";

/**
 * Problem — five fragmented-tool cards over the connecting particle streams
 * (brightest in the gaps BETWEEN cards: the mess between the tools is the
 * argument), closed by the rhetorical-turn pill.
 *
 * Signature (3.3): cards enter with a slight rotation settle (±1.5° max,
 * fixed pseudo-random per card, resolving to 0) so the scatter reads as
 * physical; the streams then brighten 200ms after the last card lands.
 * Card bodies carry a 2-line min-height so all five bottoms align.
 */
const TOOLS: { icon: LucideIcon; title: string; description: string; tilt: string }[] = [
  { icon: LineChart, title: "Yahoo Finance", description: "Price data, charts, and market insights.", tilt: "[[data-reveal=hidden]_&]:-rotate-[1.5deg]" },
  { icon: FileText, title: "EDGAR filings", description: "Raw filings buried in PDFs and text.", tilt: "[[data-reveal=hidden]_&]:rotate-[1.2deg]" },
  { icon: Table, title: "Spreadsheets", description: "Manual models and scattered calculations.", tilt: "[[data-reveal=hidden]_&]:-rotate-[0.8deg]" },
  { icon: MessageSquare, title: "ChatGPT", description: "Answers, but no direct access to your data.", tilt: "[[data-reveal=hidden]_&]:rotate-[1.5deg]" },
  { icon: Newspaper, title: "News sites", description: "Noise, opinions, and information overload.", tilt: "[[data-reveal=hidden]_&]:-rotate-[1.2deg]" },
];

export function Problem({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <SectionHeader
        eyebrow="The problem"
        headingId={headingId}
        segments={[
          { text: "Why does research feel", block: true },
          { text: "so fragmented?", tone: "accent", block: true },
        ]}
        afterHeadline={<EyebrowRule className="mt-mk-headline w-full" />}
        lead={
          <>
            Every day you hop between Yahoo Finance, EDGAR PDFs, spreadsheets, and ChatGPT. All
            that data, and still hours go by without a single insight.
          </>
        }
        className="items-center"
      />

      {/* Cards over the connecting streams. */}
      <div className="relative mt-mk-lead w-full">
        <Reveal delay={280 + 4 * 70 + 200} className="absolute inset-x-0 top-1/2 hidden h-72 -translate-y-1/2 md:block">
          <ParticleField variant="streams" className="inset-0 h-full w-full" />
        </Reveal>

        <Reveal
          delay={280}
          stagger={70}
          className="relative grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5"
          childClassName="h-full"
        >
          {TOOLS.map((tool) => (
            <div
              key={tool.title}
              className={`flex h-full flex-col gap-4 rounded-panel border border-hairline bg-gradient-to-b from-surface-2/90 to-surface/90 p-7 transition-[border-color] duration-[200ms] hover:border-foreground/15 ${tool.tilt}`}
            >
              <IconTile icon={tool.icon} shape="circle" />
              <div>
                <h3 className="font-serif text-lg font-semibold text-foreground">{tool.title}</h3>
                <p className="mt-2 min-h-12 text-mk-body text-muted">{tool.description}</p>
              </div>
            </div>
          ))}
        </Reveal>
      </div>

      {/* The rhetorical turn. */}
      <Reveal delay={280} className="mt-12 flex justify-center">
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
    </SectionShell>
  );
}
