import Link from "next/link";
import { Check } from "lucide-react";
import { APP_ENTRY } from "../../landing-config";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Pricing / Download (Creative Direction §6.8). Copy is the approved §9 wording,
 * corrected where it claimed something unshipped (reconciliation §A3): UAA is a
 * local app you run, not a packaged download, so this says "free to use" and the
 * CTA enters the app rather than pointing at a non-existent installer. Markets
 * reflect what actually ships (US + India).
 */
const INCLUDED = [
  "Every module — research, screener, portfolio, valuation, AI",
  "U.S. and Indian market data from public sources",
  "Local AI analysis — no cloud keys, no metering",
  "Your data stays on your machine",
];

export function Pricing({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto flex w-full max-w-3xl flex-col items-center gap-8 px-6 py-24 text-center">
        <div className="flex max-w-2xl flex-col items-center gap-4">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Get started in minutes — for free.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            UAA is free to use and runs entirely on your machine. Optional professional data feeds
            are the only thing you’d ever pay for.
          </p>
        </div>

        <div className="w-full max-w-md rounded-panel border border-border bg-surface p-8 text-left shadow-card">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tracking-tight text-foreground">$0</span>
            <span className="text-sm text-muted">/ forever</span>
          </div>
          <p className="mt-1 text-caption uppercase tracking-widest text-faint">Free — runs locally</p>

          <ul className="mt-6 flex flex-col gap-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-foreground">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {item}
              </li>
            ))}
          </ul>

          <Link
            href={APP_ENTRY}
            className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-control bg-brand text-sm font-semibold text-background outline-none transition hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Experience UAA
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
