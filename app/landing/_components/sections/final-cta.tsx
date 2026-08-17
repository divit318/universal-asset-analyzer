"use client";

import Link from "next/link";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { OrnamentalEyebrow } from "../primitives/ornamental-eyebrow";
import { TwoToneHeadline } from "../primitives/two-tone-headline";
import { openAuthModal } from "../auth-modal";
import { PIPELINE_STAGES } from "../pipeline-row";
import { FINAL_PRIMARY_ACTION, APP_ENTRY } from "../../landing-config";

/**
 * Final CTA, the friction-removal close. Everything above this section has
 * argued value; a visitor who reaches it is persuaded, and what stops them
 * now is practical. So this section answers the practical questions as a
 * compact spec block instead of restating benefits: what starting takes,
 * how long a first analysis measures, the API key situation stated up
 * front, the true price with the reason it can be free, and how to leave.
 *
 * The Seal ink composition and the fourth trust-chip strip are gone: the
 * chips live once on the page (Solution section), and the close carries no
 * decoration between the argument and the action. One primary action opens
 * the live app directly (it is open and free, so a single unambiguous
 * action beats two competing ones); the optional local account is a quiet
 * text link, not a rival button.
 *
 * Every claim in SPEC_ROWS is verified against the shipped product: the
 * auth gate is off by default (proxy.ts), the first-analysis timings were
 * measured against the running app (uncached tickers rendered the computed
 * analysis in 20 to 30 seconds; a cached ticker in about 3 seconds), the
 * 15 to 40 second verdict window is the app's own stated typical
 * (decision-hero.tsx), pricing matches the
 * Pricing section ($0 today, Pro planned and not billable), and export is
 * real (/api/export/* plus the SQLite file itself).
 */
const SPEC_ROWS: { label: string; body: string }[] = [
  {
    label: "To start",
    body: "One click. The button above opens the app in this browser. An account is optional and stays local; it exists for shared machines.",
  },
  {
    label: "First analysis",
    body: "Type a ticker. Live market data is pulled once and every figure computes locally: we measured 20 to 30 seconds for a first analysis, about 3 seconds once cached.",
  },
  {
    label: "AI narration",
    body: "Optional, on your own provider: a Devin CLI login (no API key) or an Anthropic, OpenAI, Gemini, or OpenRouter key pasted once in Settings. Verdicts stream in, typically 15 to 40 seconds. Every computed figure works without it.",
  },
  {
    label: "Price",
    body: "$0. The full local product, nothing held back. It can be free because your machine does the work and your AI provider bills you directly; there is no server cost to recover. A planned Pro tier adds hosted services on top, and nothing is billable today.",
  },
  {
    label: "Your data",
    body: "One SQLite database on your disk. Export any analysis to Excel, or copy the file itself; leaving is a file copy, not a request.",
  },
];

export function FinalCta({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <SectionShell id={section.id} headingId={headingId} band={index % 2 === 1}>
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
        <Reveal delay={0}>
          <OrnamentalEyebrow>Nothing in the way</OrnamentalEyebrow>
        </Reveal>
        <Reveal delay={90}>
          <TwoToneHeadline
            id={headingId}
            className="mt-mk-eyebrow"
            segments={[
              { text: "The whole terminal,", block: true },
              { text: "already on your machine.", tone: "accent", block: true },
            ]}
          />
        </Reveal>

        {/* The action sits directly under the argument: no decoration, no
            subhead, nothing between the headline and the click. */}
        <Reveal delay={180} className="mt-mk-headline flex flex-col items-center gap-3">
          {/* prefetch={false}: see hero.tsx — landing links into the app
              navigate on click only. */}
          <Link
            href={APP_ENTRY}
            prefetch={false}
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-control bg-brand px-7 text-sm font-semibold text-background outline-none transition-[background-color,border-color,transform] duration-[120ms] hover:-translate-y-px hover:bg-brand-strong active:translate-y-0 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {FINAL_PRIMARY_ACTION}
            <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px]">
              →
            </span>
          </Link>
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="rounded-control text-mk-small text-muted underline-offset-4 outline-none transition-colors duration-[120ms] hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            or create a local account first
          </button>
        </Reveal>

        {/* The friction-removal block: specification, not marketing. */}
        <Reveal delay={280} className="mt-mk-lead w-full">
          <dl className="w-full divide-y divide-hairline rounded-panel border border-border bg-surface/70 text-left">
            {SPEC_ROWS.map((row) => (
              <div key={row.label} className="grid gap-1 px-5 py-4 sm:grid-cols-[9.5rem_1fr] sm:gap-4 sm:px-6">
                <dt className="pt-0.5 font-mono text-micro uppercase tracking-widest text-brand">{row.label}</dt>
                <dd className="text-pretty text-mk-body text-muted">{row.body}</dd>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* Sign-off: the hero opened with the 01→05 pipeline waiting to run;
            the page closes with the same five stages, each sealed with a
            diamond. Decorative recap, so it is hidden from the a11y tree —
            the argument it summarizes is the page above it. */}
        <Reveal delay={380} className="mt-mk-group">
          <p
            aria-hidden="true"
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 font-mono text-micro uppercase tracking-widest text-muted"
          >
            {PIPELINE_STAGES.map((stage) => (
              <span key={stage.n} className="flex items-center gap-3 whitespace-nowrap">
                <span>
                  <span className="text-brand">{stage.n}</span> {stage.label}
                </span>
                <span aria-hidden="true" className="inline-block h-1 w-1 rotate-45 bg-brand/60" />
              </span>
            ))}
            <span className="text-foreground">run complete</span>
          </p>
        </Reveal>
      </div>
    </SectionShell>
  );
}
