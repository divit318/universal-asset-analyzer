import { Check } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Solution / Product Reveal — the "one workbench" beat that answers the Problem.
 * Static (Milestone 3): the dashboard is a hollow panel mock; its staged
 * "assembles itself" animation is Milestone 5 and the real screenshot is
 * Milestone 7.
 *
 * Copy is the approved Creative Direction final wording (§9).
 */
const BULLETS = [
  "Live market data",
  "SEC financials",
  "Dynamic screeners",
  "Portfolio analytics",
  "In-app AI analyst",
];

export function Solution({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <Reveal className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-24 lg:grid-cols-2">
        <div className="flex flex-col gap-5 text-center lg:text-left">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Meet the Universal Asset Analyzer.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-muted">
            One app for all your investment research, powered by local AI.
          </p>
          <ul className="flex flex-col gap-2.5 self-center lg:self-start">
            {BULLETS.map((b) => (
              <li key={b} className="flex items-center gap-2.5 text-sm text-foreground">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-muted text-brand">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* Hollow dashboard mock — three panels that will "assemble" in M5. */}
        <div aria-hidden="true" className="rounded-panel border border-border bg-surface p-3 shadow-card">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1 flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
              <div className="h-2 w-12 rounded-full bg-border-strong" />
              <div className="h-2 w-16 rounded-full bg-border" />
              <div className="h-2 w-10 rounded-full bg-border" />
              <div className="mt-2 h-2 w-14 rounded-full bg-border" />
            </div>
            <div className="col-span-2 flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
              <div className="h-2 w-20 rounded-full bg-border-strong" />
              <div className="flex h-20 items-end gap-1.5">
                {[40, 65, 50, 80, 60, 90, 72].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-brand/40" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            <div className="col-span-3 flex flex-col gap-2 rounded-card border border-border bg-surface-2 p-3">
              <div className="h-2 w-24 rounded-full bg-brand/50" />
              <div className="h-2 w-full rounded-full bg-border" />
              <div className="h-2 w-4/5 rounded-full bg-border" />
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
