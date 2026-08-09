"use client";

import type { LandingSection } from "../../landing-config";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "../../landing-config";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { TrustStrip } from "../primitives/trust-strip";
import { PipelineRow } from "../pipeline-row";
import { HeroField } from "../hero-field";
import { Reveal } from "../motion/reveal";
import { openAuthModal } from "../auth-modal";

/**
 * Hero — the filament field is FULL-BLEED: its canvas spans the entire hero
 * body edge to edge (hero-field.tsx), behind the text, and the ribbon
 * bleeds off both the left and right viewport edges. The text keeps its
 * left ~38% column (the headline sets as exactly two lines at every
 * breakpoint); legibility is guaranteed by the spine passing below the
 * text block, the thin dim entry, and a left-edge scrim. Column discipline
 * remains in force for every other section — this full-bleed treatment is
 * the hero's alone. Beneath the hero body, the 01 to 05 pipeline is a
 * DETACHED typographic row (pipeline-row.tsx), spatially independent of
 * the field. The trust strip closes the section.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section id={section.id} aria-labelledby={headingId} className="scroll-mt-22 overflow-hidden border-b border-hairline pt-14 sm:pt-16">
      {/* The hero body: full-bleed field behind, text column in front. */}
      <div className="relative pb-64 lg:pb-0">
        <HeroField />
        <div data-measure="content" className="relative mx-auto w-full max-w-measure-content px-mk-pad">
          <div className="grid items-center gap-10 lg:grid-cols-[38fr_62fr] lg:gap-8">
          <div className="flex flex-col items-start">
            <Reveal delay={0}>
              <OrnamentalEyebrow variant="left">
                <span className="text-muted">Evidence in ink.</span> <span>Verdicts in brass.</span>
              </OrnamentalEyebrow>
            </Reveal>

            <Reveal delay={90}>
              {/* Sized so the two lines set cleanly in the 38% column at
                  every breakpoint: two clean lines, never four fragments. */}
              <TwoToneHeadline
                as="h1"
                id={headingId}
                size="hero-split"
                align="left"
                className="mt-mk-eyebrow"
                segments={[
                  { text: "Every figure computed.", block: true },
                  { text: "Every claim traced.", tone: "accent", block: true },
                ]}
              />
            </Reveal>

            <Reveal delay={180}>
              <p data-lead className="mt-mk-headline max-w-measure-prose text-pretty text-mk-lead text-muted">
                Stop juggling a dozen investing tools. UAA is one research terminal where deterministic
                engines compute every metric and the analysis only explains what they found, and every
                figure traces back to its source, in a database <span className="text-brand">you own</span>.
              </p>
            </Reveal>

            <Reveal delay={280}>
              <div className="mt-10 flex flex-col items-start gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => openAuthModal("signup")}
                  className="group inline-flex h-12 items-center justify-center gap-2 rounded-control bg-brand px-7 text-sm font-semibold text-background outline-none transition-[background-color,border-color,transform] duration-[120ms] hover:-translate-y-px hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {PRIMARY_ACTION}
                  <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px]">
                    →
                  </span>
                </button>
                <a
                  href="#demo"
                  className="inline-flex h-12 items-center justify-center gap-1.5 rounded-control border border-border bg-surface px-7 text-sm font-semibold text-foreground outline-none transition-[background-color,border-color,transform] duration-[120ms] hover:-translate-y-px hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  {SECONDARY_ACTION}
                  <span aria-hidden="true">↓</span>
                </a>
              </div>
            </Reveal>
          </div>

          {/* Height spacer: keeps the hero body at illustration scale on
              desktop. The field itself is full-bleed behind this grid. */}
          <div aria-hidden="true" className="relative hidden h-[460px] w-full lg:block xl:h-[540px]" />
          </div>
        </div>
      </div>

      <div data-measure="content" className="mx-auto w-full max-w-measure-content px-mk-pad">
        {/* The detached pipeline row: full width, typographic, independent. */}
        <Reveal delay={360} className="mt-10 border-t border-hairline pt-8">
          <PipelineRow />
        </Reveal>

        <Reveal delay={420} className="pb-mk-group pt-10">
          <TrustStrip variant="contained" />
        </Reveal>
      </div>
    </section>
  );
}
