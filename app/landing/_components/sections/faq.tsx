import { ChevronDown } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * FAQ (Creative Direction §6.9). Native <details>/<summary> accordions —
 * keyboard-accessible and fully functional without JS (progressive enhancement,
 * no client component needed).
 *
 * Answers are corrected to what actually ships: Claude via the Anthropic API
 * on the user's own key, and US + India markets rather than US-only. Nothing
 * here promises a capability the app doesn't have.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need an account?",
    a: "No. UAA has no sign-up and no login. The only credential is your own Anthropic API key, for AI features.",
  },
  {
    q: "Does UAA send my data anywhere?",
    a: "Your research, notes, and portfolios are stored on your computer and never uploaded. When you use AI features, the prompt for that feature — company data and, where relevant, portfolio context — is sent to the Anthropic API with your key. Market data comes from public sources.",
  },
  {
    q: "Which markets are supported?",
    a: "U.S. and Indian equities today, with more on the way.",
  },
  {
    q: "What AI does it use?",
    a: "Claude (Anthropic) via your own API key, entered once in Settings. Every number in the app is computed locally by deterministic engines — the model only writes the narrative.",
  },
  {
    q: "Is there a subscription?",
    a: "No. The app is free; you’d only ever pay for optional premium data feeds.",
  },
];

export function Faq({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-24">
        <div className="flex max-w-2xl flex-col gap-4 text-center sm:mx-auto">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Frequently asked questions
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {FAQS.map(({ q, a }) => (
            <details
              key={q}
              className="group rounded-card border border-border bg-surface px-5 [&_summary::-webkit-details-marker]:hidden"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-4 py-4 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                {q}
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-faint transition-transform group-open:rotate-180"
                  strokeWidth={2}
                />
              </summary>
              <p className="pb-4 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
