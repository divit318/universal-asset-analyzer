"use client";

import type { LandingSection } from "../../landing-config";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "../../landing-config";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { PipelineRow } from "../pipeline-row";
import { HeroField } from "../hero-field";
import { Reveal } from "../motion/reveal";
import { openAuthModal } from "../auth-modal";

/**
 * Hero — the filament field is FULL-BLEED: its canvas spans the entire hero
 * body edge to edge (hero-field.tsx), behind the text, and the ribbon
 * bleeds off both the left and right viewport edges. The text keeps its
 * left ~52% column (the headline sets as exactly two lines at every
 * breakpoint, and the lead holds a 60 to 70 character measure); legibility
 * is guaranteed by the spine passing below the text block, the thin dim
 * entry, a left-edge scrim, and the CTA quiet zone. Column discipline
 * remains in force for every other section — this full-bleed treatment is
 * the hero's alone. Beneath the hero body, the 01 to 05 pipeline is a
 * DETACHED typographic row (pipeline-row.tsx) that closes the section; the
 * four trust chips live in the Solution section, where they substantiate
 * its claim instead of restating the pipeline's.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section id={section.id} aria-labelledby={headingId} className="scroll-mt-22 overflow-hidden border-b border-hairline pt-14 sm:pt-16">
      {/* The hero body: full-bleed field behind, text column in front. */}
      <div className="relative pb-64 lg:pb-0">
        <HeroField />
        <div data-measure="content" className="relative mx-auto w-full max-w-measure-content px-mk-pad">
          <div className="grid items-center gap-10 lg:grid-cols-[52fr_48fr] lg:gap-8">
          {/* data-hero-copy scopes the field's text-exclusion measurement
              (ink/hero-sdf.ts): every text rect inside thins the material. */}
          <div data-hero-copy className="flex flex-col items-start">
            <Reveal delay={0}>
              {/* Diamond terminus, no trailing rule: over the full-bleed
                  field the fading hairline had no right-hand anchor and
                  read as an unfinished stroke. */}
              <OrnamentalEyebrow variant="left" terminus="diamond">
                <span className="text-muted">Evidence in ink.</span> <span>Verdicts in brass.</span>
              </OrnamentalEyebrow>
            </Reveal>

            <Reveal delay={90}>
              {/* Sized so the two lines set cleanly in the text column at
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
              {/* Measure: 60 to 70 characters (34rem at 18px), about four
                  lines at desktop width, so the final line never orphans.
                  At lg only, the column would cap the measure at ~53
                  characters and strand "you own." alone; the narrower 26rem
                  cap there produces a clean five-line rag instead. */}
              <p data-lead className="mt-mk-headline max-w-[34rem] text-pretty text-mk-lead text-muted lg:max-w-[26rem] xl:max-w-[34rem]">
                Stop juggling a dozen investing tools. UAA is one research terminal where deterministic
                engines compute every metric and the AI only explains what they found. Every figure
                traces back to its source, in a database <span className="text-brand">you own</span>.
              </p>
            </Reveal>

            <Reveal delay={280}>
              <div className="mt-mk-lead flex flex-col items-start gap-3 sm:flex-row">
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
          <div aria-hidden="true" className="relative hidden h-[440px] w-full lg:block xl:h-[500px]" />
          </div>
        </div>
      </div>

      <div data-measure="content" className="mx-auto w-full max-w-measure-content px-mk-pad">
        {/* The detached pipeline row closes the hero: full width,
            typographic, independent. Gaps are spacing-scale values
            (mk-group above the rule, mk-group below it, mk-lead under
            the row) so the interval reads deliberate, not leftover. */}
        <Reveal delay={360} className="mt-mk-group border-t border-hairline pb-mk-lead pt-mk-group">
          <PipelineRow />
        </Reveal>
      </div>
    </section>
  );
}
