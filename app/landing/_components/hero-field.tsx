"use client";

import { useEffect, useRef } from "react";
import { createHeroField } from "./ink/hero-field";

/**
 * HeroField — the hero's dedicated flow-field canvas (ink/hero-field.ts).
 * FULL-BLEED: the canvas spans the entire hero body, edge to edge, and the
 * spine's endpoints sit outside [0,1] so the ribbon bleeds off BOTH the
 * left and right viewport edges with no visible start or end. (The old
 * "ink zone right column" confinement is revoked for the hero only; column
 * discipline still governs every other section.) Text stays legible
 * because the spine passes BELOW the text block, the entry is thin and
 * dim by construction, and a subtle left-edge scrim guarantees contrast.
 */
export function HeroField() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const field = createHeroField(canvas);
    return () => field.destroy();
  }, []);

  return (
    /* Below lg the hero body is text-height only, so the full-bleed field
       would run straight through the copy: the ribbon instead gets its own
       full-width band beneath the text. At lg+ it is the full hero body. */
    <div aria-hidden="true" data-ink-target="hero-ink" className="absolute inset-x-0 bottom-0 h-80 lg:inset-0 lg:h-auto">
      <canvas ref={ref} aria-hidden="true" data-hero-field className="h-full w-full" />
      {/* Safety scrim: background at 0.55 alpha on the left edge fading to
          transparent at 45% width, between the canvas and the text. */}
      <div
        data-hero-scrim
        className="pointer-events-none absolute inset-y-0 left-0 w-[45%]"
        style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--background) 55%, transparent), transparent)" }}
      />
      {/* CTA quiet zone: a soft radial wash of the page background anchored
          to the CTA cluster. Generous falloff, low peak, no perceptible
          edge; because it is the background colour it inverts correctly in
          light mode. Hidden below lg, where the field is a bottom band that
          never runs behind the CTAs. */}
      <div
        data-hero-cta-scrim
        className="pointer-events-none absolute hidden lg:block"
        style={{
          left: "0%",
          bottom: "-8%",
          width: "50%",
          height: "62%",
          background:
            "radial-gradient(ellipse closest-side at 50% 55%, color-mix(in srgb, var(--background) 40%, transparent), color-mix(in srgb, var(--background) 18%, transparent) 55%, transparent 80%)",
        }}
      />
    </div>
  );
}
