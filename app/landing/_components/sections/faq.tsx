"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { prefersReducedMotion, onNextFrame } from "../motion/engine";

/**
 * FAQ — The Lattice, in Movement IV's Silence: NO canvas ink. The lattice
 * is a static SVG background pattern at 6% opacity, motionless.
 *
 * Answer text reveals with a line-by-line wipe (per-line 180ms, staggered
 * 60ms) so it reads as being written rather than unfolded; the accordion
 * height still animates via the CSS grid-rows trick and stays fully
 * keyboard operable with aria-expanded/aria-controls. Reduced motion and
 * no-JS: answers render complete, instantly.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need an account?",
    a: "Not to run it. UAA ships an optional local account, with credentials in your own database and never on a server, to protect shared machines; the sign-in gate is off by default. AI features additionally use your own AI provider: a Devin CLI login (no API key) or your own provider API key.",
  },
  {
    q: "Does UAA send my data anywhere?",
    a: "Your research, notes, and portfolios are stored on your computer and never uploaded. When you use AI features, only that feature's prompt (company data and, where relevant, portfolio context) is sent to the one AI provider serving the request: your Devin login or your own API key. Market data comes from public sources.",
  },
  {
    q: "Which markets are supported?",
    a: "U.S. and Indian markets are first-class today, and analysis spans seven asset classes — equities, ETFs, REITs, crypto, commodities, bonds, and currencies — through public data sources. More markets are on the way.",
  },
  {
    q: "What AI does it use?",
    a: "Your own. By default UAA routes through your Devin CLI login, with no API key at all; or bring your own Anthropic, OpenAI, Gemini, or OpenRouter key, entered once in Settings. Every number in the app is computed locally by deterministic engines; the model only writes the narrative.",
  },
  {
    q: "Is there a subscription?",
    a: "The local product is free, and your only running cost is your own AI usage, billed by your provider. A paid Pro tier (managed AI, licensed data, sync) is planned but not yet available; see Pricing to register interest.",
  },
];

/** Answer paragraph whose words wipe in line by line on open. */
function AnswerText({ text, open }: { text: string; open: boolean }) {
  const ref = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!open || prefersReducedMotion()) {
      delete el.dataset.wipe;
      return;
    }
    // Group words into rendered lines by offsetTop, stagger 60ms per line.
    const words = Array.from(el.querySelectorAll<HTMLElement>("[data-word]"));
    let lastTop = -Infinity;
    let line = -1;
    for (const w of words) {
      if (w.offsetTop > lastTop + 2) {
        line++;
        lastTop = w.offsetTop;
      }
      w.style.transitionDelay = `${line * 60}ms`;
    }
    el.dataset.wipe = "armed";
    onNextFrame(() => {
      if (ref.current) ref.current.dataset.wipe = "go";
    });
  }, [open]);

  return (
    <p ref={ref} className="px-5 pb-4 text-mk-body text-muted">
      {text.split(" ").map((word, i) => (
        <span
          key={i}
          data-word
          className="inline-block whitespace-pre transition-[opacity,transform] duration-[180ms] ease-out [[data-wipe=armed]_&]:translate-y-1 [[data-wipe=armed]_&]:opacity-0"
        >
          {word}
          {" "}
        </span>
      ))}
    </p>
  );
}

export function Faq({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const [open, setOpen] = useState(0);

  return (
    <SectionShell
      id={section.id}
      headingId={headingId}
      band={index % 2 === 1}
      className="overflow-hidden"
      breakout={
        /* The lattice: a static constellation, structure at rest. */
        <svg aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-16 mx-auto h-[calc(100%-8rem)] w-full max-w-[1200px] opacity-[0.06]">
          <defs>
            <pattern id="faq-lattice" width="92" height="92" patternUnits="userSpaceOnUse">
              <circle cx="18" cy="22" r="1.6" fill="var(--brand)" />
              <circle cx="66" cy="58" r="1.6" fill="var(--brand)" />
              <circle cx="40" cy="80" r="1.2" fill="var(--brand)" />
              <path d="M18 22 L66 58 L40 80" fill="none" stroke="var(--brand)" strokeWidth="0.75" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#faq-lattice)" />
        </svg>
      }
    >
      <div className="relative mx-auto flex w-full max-w-measure-prose flex-col">
          <SectionHeader
            eyebrow="Questions"
            headingId={headingId}
            segments={[{ text: "Frequently" }, { text: "asked questions", tone: "accent" }]}
            lead="Everything you need to know about UAA."
            className="items-center"
          />

        <Reveal delay={280} stagger={60} className="mt-mk-lead flex flex-col gap-3">
            {FAQS.map(({ q, a }, i) => {
              const isOpen = open === i;
              const panelId = `faq-panel-${i}`;
              const buttonId = `faq-button-${i}`;
              return (
                <div key={q} className="rounded-xl border border-hairline bg-surface/70">
                  <h3>
                    <button
                      type="button"
                      id={buttonId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpen(isOpen ? -1 : i)}
                      className="flex w-full items-center justify-between gap-4 rounded-xl px-5 py-4 text-left text-mk-body font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                    >
                      {q}
                      <span
                        aria-hidden="true"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-[200ms] ${
                          isOpen ? "border-brand/40 bg-brand/10 text-brand" : "border-border bg-surface-2 text-muted"
                        }`}
                      >
                        {isOpen ? <Minus className="h-3.5 w-3.5" strokeWidth={2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2} />}
                      </span>
                    </button>
                  </h3>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={buttonId}
                    className={`grid transition-[grid-template-rows] duration-[280ms] ease-[var(--ease-precise)] motion-reduce:transition-none ${
                      isOpen ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]"
                    }`}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <AnswerText text={a} open={isOpen} />
                    </div>
                  </div>
                </div>
              );
            })}
        </Reveal>
      </div>
    </SectionShell>
  );
}
