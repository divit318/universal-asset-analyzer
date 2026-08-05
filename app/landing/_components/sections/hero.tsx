"use client";

import type { LandingSection } from "../../landing-config";
import { HeroStipple } from "../hero-stipple";
import { openAuthModal } from "../auth-modal";

/**
 * Hero — the page's single <h1> and the scene-setting section.
 *
 * Copy contract (owner-approved, 2026-08-05): every line here grounds only in
 * outcome-independent invariants — deterministic engines compute every metric
 * (ARCHITECTURE.md "Engines Decide, AI Explains"), every figure traces to its
 * source (lib/ai/grounding.ts, lib/provenance.ts), state is a local SQLite
 * database the user owns (README). No claim, in either direction, about where
 * AI generation runs.
 *
 * The previously approved headline was:
 *   "Stop juggling a dozen investing tools."  (Creative Direction §9)
 * It was not discarded — it now opens the supporting paragraph as the problem
 * statement (owner's Row-10 override). The kicker is the committed brand
 * motto (docs/brand-guidelines.md §1). The headline serif is the brand book's
 * judgment voice (§4), used for marketing headlines and nothing else here.
 *
 * CTA wiring: "Get started" opens the auth modal on Create account (the pill
 * header's "Sign in" opens the other tab); "Watch demo" keeps the committed
 * label and jumps to the in-page demo.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="scroll-mt-20 border-b border-border bg-background"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-7 px-6 pt-28 text-center sm:pt-36">
        {/* Kicker — the committed motto (brand book §1). */}
        <p
          className="animate-fade-rise text-label font-semibold uppercase tracking-[0.22em] text-muted"
          style={{ animationDuration: "500ms" }}
        >
          Evidence in ink. <span className="text-brand">Verdicts in brass.</span>
        </p>

        <div
          className="flex animate-fade-rise flex-col items-center gap-5"
          style={{ animationDuration: "500ms", animationDelay: "80ms" }}
        >
          <h1
            id={headingId}
            className="max-w-3xl text-balance font-serif text-4xl font-semibold tracking-tight text-foreground sm:text-6xl"
          >
            <span className="block">Every figure computed.</span>
            <span className="block text-brand">Every claim traced.</span>
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Stop juggling a dozen investing tools. UAA is one research terminal where
            deterministic engines compute every metric and the analysis only explains what
            they found — every figure traces back to its source, in a database you own.
          </p>
        </div>

        {/* CTA hierarchy: primary opens Create account; secondary jumps to the
            in-page demo (committed label). */}
        <div
          className="flex animate-fade-rise flex-col items-center gap-3 sm:flex-row"
          style={{ animationDuration: "500ms", animationDelay: "180ms" }}
        >
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="group inline-flex h-11 items-center justify-center gap-2 rounded-control bg-brand px-6 text-sm font-semibold text-background outline-none transition hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Get started
            <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-0.5">
              →
            </span>
          </button>
          <a
            href="#demo"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-border bg-surface px-6 text-sm font-semibold text-foreground outline-none transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Watch demo
            <span aria-hidden="true">↓</span>
          </a>
        </div>

        {/* The Traceable Figure — engraved-stipple illustration anchoring the
            hero. Decorative (aria-hidden inside); generated, reproducible art:
            scripts/generate-hero-stipple.ts. */}
        <div
          data-testid="hero-stipple"
          className="animate-fade-rise -mb-px w-full"
          style={{ animationDuration: "700ms", animationDelay: "300ms" }}
        >
          <HeroStipple />
        </div>
      </div>
    </section>
  );
}
