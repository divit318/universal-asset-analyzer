import Link from "next/link";
import { Search, SlidersHorizontal, PieChart, Calculator, Sparkles, type LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import type { SectionProps } from "../section-registry";
import { Reveal } from "../motion/reveal";
import { SectionHeader } from "../primitives/section-header";
import { IconTile } from "../primitives/icon-tile";
import { PanelFrame } from "../primitives/panel-frame";
import { ResearchHubPanel } from "../mockups/research-hub";
import { ScreenerPanel } from "../mockups/screener";
import { PortfolioPanel } from "../mockups/portfolio";
import { ValuationPanel } from "../mockups/valuation";
import { AiAssistantPanel } from "../mockups/ai-assistant";
import { PANEL_DATA } from "../mockups/panel-data";
import { appRoute } from "../../landing-config";

/**
 * Capabilities — ONE 12-column grid at the wide measure for every row: text
 * spans 4, panel spans 8; mirrored on alternating rows. The panels are the
 * page's product evidence, so they take the widest share the measure allows
 * (the old 1-column gutter is spent on panel width instead).
 *
 * The five rows are ONE workflow, not five features: each carries a stage
 * label (01 Discover → 05 Question) so the section reads as the product's
 * operating loop — discover in the Screener, understand in Research, value
 * in the DCF, decide against the portfolio, question the AI last, grounded
 * in everything the engines computed above it.
 *
 * Every panel shows REAL product output baked into panel-data.ts by
 * scripts/landing-panel-data.ts (engines + live data, provenance recorded).
 * A panel with no real data does not render: the AI exchange is dropped
 * whenever the generator could not capture a genuine response.
 *
 * Timeline per row (3.3): text at 0ms of its entrance, panel at 90ms; the
 * panel's primary data element then animates ONCE via [data-mock] CSS
 * (chart draw / donut sweep / bar growth / counter roll), never on
 * re-entry, final-state under no-JS and reduced motion.
 *
 * This is the ONLY section (with compare) permitted the wide measure.
 */
interface Capability {
  /** Workflow stage: number + verb, e.g. "01" + "Discover". */
  stage: string;
  verb: string;
  module: string;
  title: string;
  description: string;
  cta: string;
  /** Real in-app destination. The app is local-first: no auth wall. */
  href: string;
  icon: LucideIcon;
  mockup: ComponentType;
  mockupLabel: string;
  /** Real source line rendered in the frame's provenance footer. */
  provenance: string;
}

const META = PANEL_DATA.meta;
const VAL = PANEL_DATA.valuation;
const VAL_BASE = VAL.scenarios.find((s) => s.id === "base")!;

const CAPABILITIES: (Capability | null)[] = [
  {
    stage: "01",
    verb: "Discover",
    module: "Universal Screener",
    title: "Rank any universe",
    description:
      "Equities, ETFs, REITs, crypto, commodities, bonds, FX: pick a class, and the filters adapt to it. Every match carries a deterministic score, a confidence, and the reason it passed.",
    cta: "Run a screen",
    href: appRoute("/screener"),
    icon: SlidersHorizontal,
    mockup: ScreenerPanel,
    mockupLabel: `Universal Screener panel showing a real pipeline run: ${PANEL_DATA.screener.total} of ${PANEL_DATA.screener.universe} names matched four filters, top rows with deterministic rank scores.`,
    provenance: `runScreen · ${PANEL_DATA.screener.total} of ${PANEL_DATA.screener.universe} matched · universe built ${(PANEL_DATA.screener.builtAt ?? "").slice(0, 10)}`,
  },
  {
    stage: "02",
    verb: "Understand",
    module: "Research Hub",
    title: "Profiles with provenance",
    description:
      "Price, fundamentals, reported statements, and live news on one screen, each figure carrying its source and as-of date.",
    cta: "Open Research",
    href: appRoute("/research"),
    icon: Search,
    mockup: ResearchHubPanel,
    mockupLabel: `Research Hub panel with real data for ${PANEL_DATA.research.name} (${PANEL_DATA.research.symbol}): key metrics, reported revenue by fiscal year, and live headlines as of ${PANEL_DATA.research.asOf}.`,
    provenance: `${PANEL_DATA.research.symbol} · quote, statements, news · data as of ${PANEL_DATA.research.asOf}`,
  },
  {
    stage: "03",
    verb: "Value",
    module: "Valuation Engine",
    title: "A valuation you can audit",
    description:
      "Fair value, computed deterministically from assumptions shown on screen — each with its source. Change an input and the answer moves; nothing is hallucinated.",
    cta: "Open the valuation workspace",
    href: appRoute("/valuation"),
    icon: Calculator,
    mockup: ValuationPanel,
    mockupLabel: `Valuation Engine panel showing the shipped DCF's real output for ${VAL.name} (${VAL.symbol}): fair value ${VAL_BASE.fairValue} against spot ${VAL.spotDisplay}, with every assumption, its source, the labelled cash flow chart, and the derivation to per-share value.`,
    provenance: `${VAL.symbol} · ${VAL.method} · engine ${META.gitSha} · data as of ${VAL.asOf}`,
  },
  {
    stage: "04",
    verb: "Decide",
    module: "Portfolio Intelligence",
    title: "The whole book, graded",
    description:
      "Value, allocation, concentration, and a health grade recomputed from your actual lots on every change — what a position does to the book, not just to itself.",
    cta: "Open the portfolio",
    href: appRoute("/portfolio"),
    icon: PieChart,
    mockup: PortfolioPanel,
    mockupLabel: `Portfolio Intelligence panel showing the real demo book: value ${PANEL_DATA.portfolio.valueDisplay}, health ${PANEL_DATA.portfolio.health} (${PANEL_DATA.portfolio.healthGrade}), engine-computed trajectory, allocation, and live movers.`,
    provenance: `demo book · engine snapshots · movers as of ${PANEL_DATA.portfolio.moversAsOf}`,
  },
  PANEL_DATA.assistant
    ? {
        stage: "05",
        verb: "Question",
        module: "AI Research Assistant",
        title: "AI that explains, not invents",
        description:
          "Ask about any figure and the answer is grounded in engine output, with the model and sources named. It critiques your assumptions; it never emits a price target.",
        cta: "Meet the copilot",
        href: appRoute("/research"),
        icon: Sparkles,
        mockup: AiAssistantPanel,
        mockupLabel: `AI Research Assistant panel showing a real captured exchange: the assistant explains the engine's ${PANEL_DATA.assistant.context.symbol} fair value of ${PANEL_DATA.assistant.context.fairValue}, quoting only engine figures, with sources and the answering model named.`,
        provenance: `${PANEL_DATA.assistant.context.symbol} case · ${PANEL_DATA.assistant.model} · captured ${PANEL_DATA.assistant.generatedAt}`,
      }
    : null,
];

function CapabilityRow({ capability, flip }: { capability: Capability; flip: boolean }) {
  const Mockup = capability.mockup;
  return (
    <div data-cap-row className="grid items-start gap-8 lg:grid-cols-12 lg:gap-x-10">
      <Reveal
        delay={0}
        className={`min-w-0 lg:col-span-4 ${flip ? "lg:col-start-9" : "lg:col-start-1"} lg:row-start-1`}
      >
        {/* Copy aligns to the panel's top edge with a fixed 2.5rem offset,
            one rule for every row, instead of floating centred. */}
        <div className="flex flex-col items-start lg:pt-10">
          <div className="flex w-full items-center gap-4">
            <IconTile icon={capability.icon} shape="square" />
            {/* The workflow stage: this row's place in the loop. */}
            <p aria-hidden="true" className="flex items-baseline gap-2 font-mono text-mk-small tracking-wide">
              <span className="tabular-nums text-brand">{capability.stage}</span>
              <span className="uppercase tracking-[0.14em] text-muted">{capability.verb}</span>
            </p>
          </div>
          <p className="mt-5 text-mk-eyebrow uppercase text-brand">
            <span className="sr-only">{`Step ${capability.stage}, ${capability.verb}: `}</span>
            {capability.module}
          </p>
          <h3 className="mt-2.5 -indent-[0.02em] text-balance font-serif text-mk-feature text-foreground">
            {capability.title}
          </h3>
          <p className="mt-3 max-w-[46ch] text-pretty text-mk-body text-muted">{capability.description}</p>
          <Link
            href={capability.href}
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
        className={`min-w-0 lg:col-span-8 ${flip ? "lg:col-start-1" : "lg:col-start-5"} lg:row-start-1`}
      >
        <PanelFrame label={capability.mockupLabel} provenance={capability.provenance}>
          <Mockup />
        </PanelFrame>
      </Reveal>
    </div>
  );
}

export function Features({ section, index }: SectionProps) {
  const headingId = `${section.id}-heading`;
  const capabilities = CAPABILITIES.filter((c): c is Capability => c != null);

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
          segments={[{ text: "One workflow," }, { text: "five instruments.", tone: "accent" }]}
          lead={
            <>
              Discover, understand, value, decide, question — real screens, real engine output.
              <br className="hidden sm:block" /> Every figure below is computed, sourced, and dated.
            </>
          }
          className="items-center"
        />
      </div>

      {/* The wide measure is permitted here ONLY. */}
      <div data-measure-wide className="mx-auto mt-mk-lead flex w-full max-w-measure-wide flex-col gap-18 px-mk-pad">
        {capabilities.map((c, i) => (
          <CapabilityRow key={c.module} capability={c} flip={i % 2 === 1} />
        ))}
      </div>
    </section>
  );
}
