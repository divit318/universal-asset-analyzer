"use client";

import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
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
        {/* LEFT: the argument. min-w-0 lets the grid track constrain the
            column, so the nowrap ledger values below truncate their notes
            instead of blowing the track out past the viewport on phones. */}
        <div className="flex min-w-0 flex-col items-start">
          <Reveal delay={0}>
            <OrnamentalEyebrow variant="left">The problem</OrnamentalEyebrow>
          </Reveal>
          <Reveal delay={90}>
            {/* Two lines, split at the phrase boundary, so the brass carries
                one complete idea ("feel so fragmented?") and "so" can never
                orphan. The explicit segment break holds the rag at every
                viewport; the column is sized so neither line rewraps. */}
            <TwoToneHeadline
              id={headingId}
              align="left"
              className="mt-mk-eyebrow"
              segments={[
                { text: "Why does research", block: true },
                { text: "feel so fragmented?", tone: "accent", block: true },
              ]}
            />
          </Reveal>
          <Reveal delay={180}>
            <p data-lead className="mt-mk-headline max-w-[44ch] text-pretty text-mk-lead text-muted">
              The data is all there. It just lives in five places that have never heard of each
              other.
            </p>
          </Reveal>

          {/* The cost, stated as the workflow it is: no invented statistic,
              just the hops every figure actually makes. */}
          <Reveal delay={280}>
            <div className="mt-mk-lead border-l-2 border-brand/40 pl-5">
              <p className="max-w-[30ch] font-serif text-xl font-semibold text-foreground">
                By the third copy-paste, the source is gone.
              </p>
              <p className="mt-2 max-w-[44ch] text-mk-body text-muted">
                Chart to sheet, sheet to chat, chat to memo. Every hop strips the number of where
                it came from.
              </p>
            </div>
          </Reveal>

          {/* The claim, demonstrated on one number: the same quote the Yahoo
              island opposite is showing (NVDA 891.42), decaying hop by hop.
              Provenance fades typographically — exact mono with a full chain,
              then pasted, then rounded, then a memory. The rows share the
              callout's left rule so ledger and claim read as one argument. */}
          <div className="mt-6 w-full max-w-[44ch] border-l-2 border-hairline pl-5" aria-hidden="true">
            {(
              [
                { hop: "terminal", value: "NVDA 891.42", note: "NASDAQ · 15:59:58 · full chain", dim: "opacity-100", mark: "bg-brand" },
                { hop: "sheet", value: "891.42", note: "=B7 · pasted, source detached", dim: "opacity-80", mark: "bg-brand/50" },
                { hop: "chat", value: "≈891", note: "rounded · undated", dim: "opacity-60", mark: "bg-muted/50" },
                { hop: "memo", value: "about 890", note: "a memory of a number", dim: "opacity-40", mark: "bg-transparent" },
              ] as const
            ).map((row, i) => (
              <Reveal key={row.hop} delay={380 + i * 90}>
                <div className={`flex items-baseline gap-3 py-1 font-mono text-mk-small tabular-nums ${row.dim}`}>
                  <span className="w-[9ch] shrink-0 text-micro uppercase tracking-widest text-muted">{row.hop}</span>
                  <span className="flex items-baseline gap-1.5 whitespace-nowrap font-semibold text-foreground">
                    <span className={`inline-block h-1 w-1 shrink-0 translate-y-[-1px] rotate-45 ${row.mark}`} />
                    {row.value}
                  </span>
                  <span className="min-w-0 truncate text-micro text-muted">{row.note}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* RIGHT: the evidence. Five islands, no completed connection. */}
        <FragmentationDiagram />
      </div>
    </SectionShell>
  );
}
