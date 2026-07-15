import { Search, SlidersHorizontal, PieChart, Calculator, Sparkles, type LucideIcon } from "lucide-react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../reveal";

/**
 * Feature Showcase — one story per real UAA module, in alternating text/image
 * splits (Creative Direction §6.5). Copy is the approved §9 final wording.
 *
 * Each "preview" is a static placeholder frame carrying an accessible
 * description of the screenshot that replaces it in Milestone 7. Milestone 4 is
 * static — no scroll reveals (that's M5) — and intentionally link-free: the CTA
 * hierarchy lives in the hero/header/footer/final-CTA, and deep-linking every
 * card into an app route would scatter paths the migration contract centralizes.
 */
interface Feature {
  /** The real module this maps to (reconciliation §H). */
  module: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Alt-equivalent for the preview placeholder; becomes real alt text in M7. */
  preview: string;
}

const FEATURES: Feature[] = [
  {
    module: "Research Hub",
    title: "Comprehensive company profiles",
    description: "All fundamental data and news in one place.",
    icon: Search,
    preview: "Research Hub — company profile with quote, fundamentals, filings, and news.",
  },
  {
    module: "Universal Screener",
    title: "Build any screener",
    description: "Filter thousands of stocks by any metric — including AI sentiment.",
    icon: SlidersHorizontal,
    preview: "Universal Screener — filter panel with a live, scored results grid.",
  },
  {
    module: "Portfolio Intelligence",
    title: "Intelligent portfolio tracker",
    description: "See gains, risk, and suggestions for your holdings.",
    icon: PieChart,
    preview: "Portfolio Intelligence — performance, risk, and position-level insights.",
  },
  {
    module: "Valuation Engine",
    title: "Built-in valuation models",
    description: "Cash flows, ratios, comps — all computed for you.",
    icon: Calculator,
    preview: "Valuation Engine — DCF and comparables with sensitivity analysis.",
  },
  {
    module: "AI Research Assistant",
    title: "AI research assistant",
    description: "Ask questions like “Summarize last quarter’s earnings call.”",
    icon: Sparkles,
    preview: "AI Research Assistant — conversational analysis grounded in the data.",
  },
];

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  const Icon = feature.icon;
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
      <div className={`flex flex-col gap-3 ${flip ? "lg:order-2" : ""}`}>
        <span className="flex h-10 w-10 items-center justify-center rounded-card border border-border bg-surface-2 text-brand">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <p className="text-label font-semibold uppercase tracking-widest text-faint">{feature.module}</p>
        <h3 className="text-balance text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          {feature.title}
        </h3>
        <p className="text-pretty text-base leading-relaxed text-muted">{feature.description}</p>
      </div>

      {/* Static preview placeholder — real screenshot lands in M7. Exposed as an
          image to assistive tech with the description as its accessible name. */}
      <div
        data-testid="feature-preview"
        role="img"
        aria-label={feature.preview}
        className={`overflow-hidden rounded-panel border border-border bg-surface shadow-card transition-transform duration-200 hover:-translate-y-1 ${flip ? "lg:order-1" : ""}`}
      >
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
        </div>
        <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 bg-background px-6 text-center">
          <Icon className="h-6 w-6 text-faint" strokeWidth={1.5} />
          <span className="text-label font-medium uppercase tracking-widest text-faint">{feature.module}</span>
        </div>
      </div>
    </div>
  );
}

export function Features({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-6 py-24">
        <Reveal className="flex max-w-2xl flex-col gap-4 text-center sm:mx-auto">
          <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
          <h2 id={headingId} className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {section.title}
          </h2>
        </Reveal>

        <div className="flex flex-col gap-16 sm:gap-20">
          {FEATURES.map((f, i) => (
            <Reveal key={f.module}>
              <FeatureRow feature={f} flip={i % 2 === 1} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
