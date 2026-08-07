import Link from "next/link";
import { Search, SlidersHorizontal, PieChart, Calculator, Sparkles, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionHeader } from "../primitives/section-header";
import { IconTile } from "../primitives/icon-tile";
import { MockupFrame } from "../primitives/mockup-frame";
import { ResearchHubMockup } from "../mockups/research-hub";
import { ScreenerMockup } from "../mockups/screener";
import { PortfolioMockup } from "../mockups/portfolio";
import { ValuationMockup } from "../mockups/valuation";
import { AiAssistantMockup } from "../mockups/ai-assistant";
import { APP_ENTRY } from "../../landing-config";

/**
 * Capabilities — ONE 12-column grid at the wide measure for every row: text
 * spans 4, a 1-column gutter, mockup spans 7; mirrored on alternating rows.
 * Text blocks are vertically centred against their frames (items-center) and
 * all five frames share the fixed 16:10 ratio at equal width, so the harness
 * reports five identical row heights.
 *
 * Timeline per row (3.3): text at 0ms of its entrance, mockup at 90ms; the
 * mockup's primary data element then animates ONCE via [data-reveal] CSS
 * (chart draw / donut sweep / bar growth / findings check-in), never on
 * re-entry, final-state under no-JS and reduced motion.
 *
 * This is the ONLY section (with compare) permitted the wide measure.
 */
interface Capability {
  module: string;
  title: string;
  description: string;
  cta: string;
  icon: LucideIcon;
  mockup: ComponentType;
  mockupLabel: string;
}

const CAPABILITIES: Capability[] = [
  {
    module: "Research Hub",
    title: "Comprehensive company profiles",
    description: "All fundamental data and news in one place.",
    cta: "Explore profiles",
    icon: Search,
    mockup: ResearchHubMockup,
    mockupLabel:
      "Illustrative Research Hub screen: an Apple Inc. profile with key metrics, a revenue chart, and recent news.",
  },
  {
    module: "Universal Screener",
    title: "Build any screener",
    description: "Filter thousands of stocks by any metric, including AI sentiment.",
    cta: "Try the screener",
    icon: SlidersHorizontal,
    mockup: ScreenerMockup,
    mockupLabel:
      "Illustrative Universal Screener screen: filter chips and a results table with AI sentiment ratings.",
  },
  {
    module: "Portfolio Intelligence",
    title: "Intelligent portfolio tracker",
    description: "See gains, risk, and suggestions for your holdings.",
    cta: "Track your portfolio",
    icon: PieChart,
    mockup: PortfolioMockup,
    mockupLabel:
      "Illustrative Portfolio Intelligence screen: performance chart, allocation donut, AI insights, and top movers.",
  },
  {
    module: "Valuation Engine",
    title: "Built-in valuation models",
    description: "Cash flows, ratios, and comps, all computed for you.",
    cta: "Explore models",
    icon: Calculator,
    mockup: ValuationMockup,
    mockupLabel:
      "Illustrative Valuation Engine screen: a DCF model with intrinsic value, upside, and projected cash flow bars.",
  },
  {
    module: "AI Research Assistant",
    title: "AI research assistant",
    description: "Ask questions like \u201CSummarize last quarter\u2019s earnings call.\u201D",
    cta: "Ask anything",
    icon: Sparkles,
    mockup: AiAssistantMockup,
    mockupLabel:
      "Illustrative AI Research Assistant screen: a question about Apple's earnings call and a cited, figure-by-figure answer.",
  },
];

function CapabilityRow({ capability, flip }: { capability: Capability; flip: boolean }) {
  const Mockup = capability.mockup;
  return (
    <div data-cap-row className="grid items-center gap-8 lg:grid-cols-12 lg:gap-0">
      <Reveal
        delay={0}
        className={`min-w-0 lg:col-span-4 ${flip ? "lg:col-start-9" : "lg:col-start-1"} lg:row-start-1`}
      >
        <div className="flex flex-col items-start">
          <IconTile icon={capability.icon} shape="square" />
          <p className="mt-5 text-mk-eyebrow uppercase text-brand">{capability.module}</p>
          <h3 className="mt-2.5 -indent-[0.02em] text-balance font-serif text-mk-feature text-foreground">
            {capability.title}
          </h3>
          <p className="mt-3 max-w-[46ch] text-pretty text-mk-body text-muted">{capability.description}</p>
          <Link
            href={APP_ENTRY}
            className="group mt-5 inline-flex items-center gap-1.5 rounded-control text-mk-body font-semibold text-brand outline-none transition-colors duration-[200ms] hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {capability.cta}
            <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px]">
              →
            </span>
          </Link>
        </div>
      </Reveal>

      <Reveal
        delay={90}
        className={`min-w-0 lg:col-span-7 ${flip ? "lg:col-start-1" : "lg:col-start-6"} lg:row-start-1`}
      >
        <MockupFrame label={capability.mockupLabel}>
          <Mockup />
        </MockupFrame>
      </Reveal>
    </div>
  );
}

export function Features({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`relative scroll-mt-22 border-b border-hairline py-mk-section ${index % 2 === 1 ? "bg-surface/40" : ""}`}
    >
      <div data-measure="content" className="mx-auto w-full max-w-measure-content px-mk-pad">
        <SectionHeader
          eyebrow="Capabilities"
          headingId={headingId}
          segments={[{ text: "Everything serious" }, { text: "research needs", tone: "accent" }]}
          lead={
            <>
              Powerful tools, unified by one platform.
              <br className="hidden sm:block" /> Built for how you research, think, and decide.
            </>
          }
          className="items-center"
        />
      </div>

      {/* The wide measure is permitted here ONLY. */}
      <div data-measure-wide className="mx-auto mt-mk-lead flex w-full max-w-measure-wide flex-col gap-18 px-mk-pad">
        {CAPABILITIES.map((c, i) => (
          <CapabilityRow key={c.module} capability={c} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
