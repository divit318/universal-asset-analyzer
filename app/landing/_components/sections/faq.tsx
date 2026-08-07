"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionShell } from "../primitives/section-shell";
import { SectionHeader } from "../primitives/section-header";
import { ParticleField } from "../primitives/particle-field";

/**
 * FAQ — a one-open-at-a-time controlled accordion. Closed rows show a plus in
 * a circular tile, the open row a minus; height animates via the CSS
 * grid-rows trick (0fr → 1fr) and collapses to an instant state change under
 * prefers-reduced-motion. Full ARIA: the trigger is a button with
 * aria-expanded/aria-controls, the panel a labelled region.
 *
 * Answers state only what ships: local database, BYO key, US + India markets.
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
    a: "U.S. and Indian equities today, with more on the way.",
  },
  {
    q: "What AI does it use?",
    a: "Claude (Anthropic) via your own API key, entered once in Settings. Every number in the app is computed locally by deterministic engines; the model only writes the narrative.",
  },
  {
    q: "Is there a subscription?",
    a: "The local product is free, and your only running cost is your own Anthropic API usage. A paid Pro tier (managed AI, licensed data, sync) is planned but not yet available; see Pricing to register interest.",
  },
];

export function Faq({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const [open, setOpen] = useState(0);

  return (
    <SectionShell
      id={section.id}
      headingId={headingId}
      band={index % 2 === 1}
      className="overflow-hidden"
      breakout={<ParticleField variant="edge-pair" className="inset-x-0 top-16 mx-auto h-[500px] w-full max-w-[1400px]" />}
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
                      <p className="px-5 pb-4 text-mk-body text-muted">{a}</p>
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
