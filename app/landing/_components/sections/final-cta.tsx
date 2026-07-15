import Link from "next/link";
import { APP_ENTRY } from "../../landing-config";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Final CTA (Creative Direction §6.10). Approved §9 closing copy. A subtle glass
 * / gradient wash gives the premium close the spec asks for, built from tokens
 * (no images, no new keyframes).
 */
export function FinalCta({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <div className="mx-auto w-full max-w-5xl px-6 py-24">
        <Reveal className="relative overflow-hidden rounded-panel border border-border bg-gradient-to-b from-surface to-surface-2 px-6 py-16 text-center shadow-card">
          {/* Decorative brand glow — purely presentational. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-24 mx-auto h-48 w-2/3 rounded-full bg-brand/10 blur-3xl"
          />
          <div className="relative flex flex-col items-center gap-5">
            <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
            <h2 id={headingId} className="max-w-3xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Professional investing doesn’t require ten tools.
            </h2>
            <p className="max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
              Research faster, think deeper, keep your data private.
            </p>
            <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
              <Link
                href={APP_ENTRY}
                className="inline-flex h-11 items-center justify-center rounded-control bg-brand px-7 text-sm font-semibold text-background outline-none transition hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Experience UAA
              </Link>
              <a
                href="#demo"
                className="inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface px-7 text-sm font-semibold text-foreground outline-none transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                Watch demo
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
