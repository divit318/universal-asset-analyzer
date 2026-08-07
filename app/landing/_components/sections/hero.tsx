"use client";

import type { LandingSection } from "../../landing-config";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "../../landing-config";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { TrustStrip } from "../primitives/trust-strip";
import { HeroFlow } from "../hero-flow";
import { Reveal } from "../motion/reveal";
import { openAuthModal } from "../auth-modal";

/**
 * Hero — the page's single <h1>, the scroll-scrubbed HeroFlow illustration
 * (canvas; waypoints and labels derive from its spine sampler), and the
 * contained trust strip. Entrance follows the page timeline: eyebrow 0ms,
 * headline 90ms, lead 180ms, CTAs/illustration 280ms.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section id={section.id} aria-labelledby={headingId} className="scroll-mt-22 overflow-hidden border-b border-hairline pt-32 sm:pt-36">
      <div data-measure="content" className="mx-auto flex w-full max-w-measure-content flex-col items-center px-mk-pad">
        <Reveal delay={0}>
          <OrnamentalEyebrow>
            <span className="text-muted">Evidence in ink.</span> <span>Verdicts in brass.</span>
          </OrnamentalEyebrow>
        </Reveal>

        <Reveal delay={90}>
          <TwoToneHeadline
            as="h1"
            id={headingId}
            size="hero"
            className="mt-mk-eyebrow"
            segments={[
              { text: "Every figure computed.", block: true },
              { text: "Every claim traced.", tone: "accent", block: true },
            ]}
          />
        </Reveal>

        <Reveal delay={180}>
          <p data-lead className="mt-mk-headline max-w-measure-prose text-pretty text-center text-mk-lead text-muted">
            Stop juggling a dozen investing tools. UAA is one research terminal where deterministic
            engines compute every metric and the analysis only explains what they found, and every
            figure traces back to its source, in a database <span className="text-brand">you own</span>.
          </p>
        </Reveal>

        <Reveal delay={280}>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row">
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

      {/* The thesis flow: scroll-scrubbed canvas + spine-derived waypoints.
          Full-bleed up to the wide measure; aspect-ratio reserves the box
          before script runs (zero CLS). */}
      <Reveal delay={280} className="relative mx-auto -mt-2 w-full max-w-measure-wide px-mk-pad sm:-mt-6">
        <HeroFlow />
      </Reveal>

      <div className="mx-auto w-full max-w-measure-content px-mk-pad pb-mk-group">
        <Reveal delay={360}>
          <TrustStrip variant="contained" />
        </Reveal>
      </div>
    </section>
  );
}
