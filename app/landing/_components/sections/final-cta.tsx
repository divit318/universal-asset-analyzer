"use client";

import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { TrustStrip } from "../primitives/trust-strip";
import { openAuthModal } from "../auth-modal";
import { PRIMARY_ACTION, SECONDARY_ACTION } from "../../landing-config";

/**
 * Final CTA — a contained card with bright brass light streaks along its top
 * and bottom edges (gradient hairlines fading at the ends), the closing
 * headline, both global actions, and the stacked trust strip.
 */
/** Signature (3.3): both streaks sweep outward from centre over 800ms once
 *  the card lands (scale-x from 0, centre origin, ancestor [data-reveal]). */
function EdgeStreak({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 origin-center transition-transform delay-700 duration-[800ms] ease-out [[data-reveal=hidden]_&]:scale-x-0 [[data-reveal=hidden]_&]:delay-0 ${edge === "top" ? "top-0" : "bottom-0"}`}
    >
      <div className="mx-auto h-px w-4/5 bg-gradient-to-r from-transparent via-brand to-transparent" />
      <div className={`mx-auto h-3 w-2/3 bg-gradient-to-r from-transparent via-brand/40 to-transparent blur-md ${edge === "top" ? "-mt-1.5" : "-mb-1.5 -translate-y-1.5"}`} />
    </div>
  );
}

export function FinalCta({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
        <Reveal delay={0}>
          <div className="relative overflow-hidden rounded-[20px] border border-border bg-gradient-to-b from-surface to-surface-2 px-6 py-12 text-center sm:px-12">
            <EdgeStreak edge="top" />
            <EdgeStreak edge="bottom" />

            <div className="relative flex flex-col items-center">
              <OrnamentalEyebrow>Ready?</OrnamentalEyebrow>
              <span aria-hidden="true" className="mt-2 h-px w-10 bg-brand/50" />
              <TwoToneHeadline
                id={headingId}
                className="mt-mk-eyebrow"
                segments={[
                  { text: "Professional investing", block: true },
                  { text: "doesn't require ten tools.", tone: "accent", block: true },
                ]}
              />
              <p className="mt-mk-headline max-w-[62ch] text-pretty text-mk-lead text-muted">
                Research faster, think deeper, keep your data private.
              </p>

              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
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

              <TrustStrip className="mt-10" variant="stacked" />
            </div>
          </div>
        </Reveal>
    </SectionShell>
  );
}
