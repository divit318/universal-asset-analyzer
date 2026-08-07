import { Cloud, ShieldCheck } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { IconTile } from "../primitives/icon-tile";
import { TrustStrip } from "../primitives/trust-strip";
import { ParticleField } from "../primitives/particle-field";

/**
 * Local-first — the product's moat. Both cards enter together (one Reveal);
 * then the RIGHT card's amber border draws itself around the perimeter over
 * 600ms (two clipped border layers sweeping clockwise) and the glow fades in
 * behind it. The left card does not animate further: the answer is the one
 * that finishes assembling itself.
 *
 * The lesser option is signalled through its neutral border and flat
 * background, never through illegibility (body stays text-muted, ≥4.5:1).
 */
export function Privacy({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <SectionHeader
        eyebrow="Local-first"
        headingId={headingId}
        segments={[
          { text: "Local-first." },
          { text: "Your data", tone: "accent" },
          { text: "stays yours." },
        ]}
        lead={
          <>
            Your portfolios, notes, and research live in a database on your disk, never on our
            servers, because there are none. AI narration runs on{" "}
            <span className="text-brand">Claude</span> with your own key.
          </>
        }
        className="items-center"
      />

      <Reveal delay={280} className="mt-mk-lead grid w-full gap-5 sm:grid-cols-2">
        <div className="flex h-full flex-col items-center gap-4 rounded-[20px] border border-border bg-surface-2 p-8 text-center">
          <IconTile icon={Cloud} shape="circle" tone="neutral" />
          <p className="text-mk-body font-semibold text-foreground">Traditional AI tools</p>
          <span aria-hidden="true" className="h-px w-14 bg-border-strong" />
          <p className="max-w-xs text-mk-body text-muted">
            Your research history lives in someone else&apos;s account system, on someone
            else&apos;s servers, behind someone else&apos;s subscription.
          </p>
        </div>

        {/* The answer card: border draws itself over 600ms after landing.
            Implementation: the resting border is transparent; two absolutely
            positioned, clipped copies of the amber border sweep in via
            clip-path transitions (left half then right half), then the glow
            fades in. All compositor-friendly (clip-path + opacity). */}
        <div className="group relative flex h-full flex-col items-center gap-4 overflow-hidden rounded-[20px] border border-brand/0 bg-brand-muted p-8 text-center shadow-glow-brand transition-[box-shadow] delay-[1300ms] duration-[700ms] [[data-reveal=hidden]_&]:shadow-none [[data-reveal=hidden]_&]:delay-0">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[20px] border border-brand transition-[clip-path] delay-700 duration-[300ms] ease-linear [clip-path:inset(0_50%_0_0)] [[data-reveal=hidden]_&]:delay-0 [[data-reveal=hidden]_&]:[clip-path:inset(0_100%_0_0)]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[20px] border border-brand transition-[clip-path] delay-[1000ms] duration-[300ms] ease-linear [clip-path:inset(0_0_0_50%)] [[data-reveal=hidden]_&]:delay-0 [[data-reveal=hidden]_&]:[clip-path:inset(0_0_0_100%)]"
          />
          <ParticleField variant="corner" className="bottom-0 right-0 h-40 w-40" />
          <IconTile icon={ShieldCheck} shape="circle" />
          <p className="relative text-mk-body font-semibold text-foreground">Universal Asset Analyzer</p>
          <span aria-hidden="true" className="h-px w-14 bg-brand/60" />
          <p className="relative max-w-xs text-mk-body text-muted">
            Your data and every computed figure stay on your machine. Only the AI prompts you
            trigger go to the Anthropic API, with your key, under your control.
          </p>
        </div>
      </Reveal>

      <Reveal delay={280} className="mt-mk-lead w-full">
        <TrustStrip variant="bare" />
      </Reveal>
    </SectionShell>
  );
}
