"use client";

import Link from "next/link";
import { useRef } from "react";
import type { LandingSection } from "../../landing-config";
import { APP_ENTRY, PRIMARY_ACTION, SECONDARY_ACTION } from "../../landing-config";
import { MeridianField } from "../meridian/MeridianField";
import { PipelineRow } from "../pipeline-row";
import { Reveal } from "../motion/reveal";
import { useScrollVelocity } from "../motion/hooks";
import series from "../ink/hero-series.json";

/**
 * Hero — the Meridian act. The section is a 230–250svh pin: a full-viewport
 * observatory plate (MeridianField) stays fixed while the visitor's scroll
 * resolves the dust above the engraved limb into the constellation of the
 * committed market record. The words never move; only the sky computes.
 *
 * Contracts preserved from the previous hero: exactly one h1 carrying the
 * two approved lines; the thesis kicker readable on the page (now engraved
 * on the limb as real SVG text); the lead naming what ships; primary CTA a
 * LINK into the open app; secondary CTA an anchor to #demo; the 01–05
 * pipeline row visible inside the section from first paint; a single
 * canvas, aria-hidden. Every text block carries data-mk-keepout so the
 * field's ink thins beneath it — words own their darkness.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;
  const cueRef = useRef<HTMLDivElement | null>(null);
  const cueShown = useRef(true);

  // The cue explains the pin, then leaves the moment the visitor uses it.
  useScrollVelocity((s) => {
    const show = s.scrollY < 60;
    if (show !== cueShown.current) {
      cueShown.current = show;
      if (cueRef.current) cueRef.current.style.opacity = show ? "1" : "0";
    }
  });

  return (
    <>
    <section id={section.id} aria-labelledby={headingId} className="relative h-[205svh] border-b border-hairline sm:h-[225svh] lg:h-[245svh]">
      <div className="sticky top-0 flex h-svh flex-col overflow-hidden">
        <MeridianField />

        {/* The words: still, in the quiet zone BENEATH the dome. The top
            padding places the headline's first baseline below the limb's
            apex (24% of the viewport) with clearance for its feather. */}
        <div className="relative z-10 mx-auto flex w-full max-w-measure-content flex-1 flex-col justify-start px-mk-pad pt-[max(6.5rem,24svh)] sm:pt-[max(7rem,29svh)]">
          <Reveal delay={0}>
            <h1 id={headingId} data-mk-keepout className="font-serif text-mk-colossal -indent-[0.03em]">
              <span className="block text-foreground">Investment research,</span>
              <span className="mk-gild block pr-[0.06em] italic">running on your machine.</span>
            </h1>
          </Reveal>

          <Reveal delay={140}>
            <p data-mk-keepout data-lead className="mt-6 max-w-[36rem] text-pretty text-mk-lead text-muted sm:mt-7">
              UAA is one research terminal for market data, filings, screening, valuation, and
              portfolio intelligence. Deterministic engines compute every metric, the AI only
              explains what they found, and each figure traces back to its source, in a database{" "}
              <span className="text-brand">you own</span>.
            </p>
          </Reveal>

          <Reveal delay={260}>
            <div data-mk-keepout className="mt-9 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              {/* prefetch={false} on every APP_ENTRY link on this page: the
                  marketing surface must not speculatively load the app
                  shell, and under UAA_AUTH_GATE=on a signed-out prefetch
                  caches the gate's redirect, which the post-sign-in
                  router.push would then replay. */}
              <Link href={APP_ENTRY} prefetch={false} className="mk-btn mk-btn-primary group inline-flex h-13 gap-2 px-8 text-sm">
                {PRIMARY_ACTION}
                <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px] motion-reduce:transition-none">
                  →
                </span>
              </Link>
              <a href="#demo" className="mk-btn mk-btn-quiet inline-flex h-13 gap-2 px-8 text-sm">
                {SECONDARY_ACTION}
                <span aria-hidden="true">↓</span>
              </a>
            </div>
          </Reveal>

          {/* The pin's one instruction. Names the metaphor, then gets out
              of the way on first scroll. Dropped on short viewports where
              the composition has no air to spare. */}
          <Reveal delay={420}>
            <div
              ref={cueRef}
              aria-hidden="true"
              className="mt-12 hidden items-center gap-3 transition-opacity duration-[640ms] sm:flex [@media(max-height:720px)]:hidden motion-reduce:transition-none"
            >
              <span className="h-px w-10 bg-gradient-to-r from-brand/60 to-transparent" />
              <span className="font-mono text-[10px] uppercase tracking-[0.34em] text-brand/70">Scroll to resolve</span>
            </div>
          </Reveal>
        </div>

        {/* The engraved caption strip: the 01–05 pipeline closes the plate.
            On phones the plate has no room for it (the mobile strip below
            takes over, OUTSIDE section#hero so hero-scoped queries and
            screen readers each meet exactly one copy per breakpoint). */}
        <div className="relative z-10 mx-auto hidden w-full max-w-measure-content px-mk-pad pb-5 sm:pb-7 md:block">
          <Reveal delay={520}>
            <div data-mk-keepout className="border-t border-hairline pt-5">
              <div className="mb-4 flex items-baseline justify-between gap-4">
                <span aria-hidden="true" className="h-1 w-1 rotate-45 bg-brand/60" />
                {/* Plate caption: derived from the asset's own metadata so
                    the line can never drift from what drives the field. */}
                <p data-hero-attribution className="select-none text-right font-mono text-[10px] uppercase tracking-[0.2em] text-foreground/40">
                  {series.index} · {series.start.slice(0, 4)}–{series.end.slice(0, 4)} · plotted on the limb · computed locally
                </p>
              </div>
              <PipelineRow />
            </div>
          </Reveal>
        </div>
      </div>
    </section>

    {/* Mobile pipeline strip: the plate's caption, read after the act. */}
    <div className="border-b border-hairline md:hidden">
      <div className="mx-auto w-full max-w-measure-content px-mk-pad py-8">
        <PipelineRow />
      </div>
    </div>
    </>
  );
}
