import Link from "next/link";
import { Badge } from "@/app/_components/ui";
import { APP_ENTRY, type LandingSection } from "../../landing-config";

/**
 * Hero — the page's single <h1> and the scene-setting section.
 *
 * Copy is the approved Creative Direction final wording (§9). Visual language is
 * the repo's own design system (blue --brand, Geist, dark-default) — NOT the
 * PDF's coral/Inter, which would fork the token set.
 *
 * Milestone 2 is deliberately STATIC: the product reveal is an empty framed
 * placeholder. Its entrance choreography arrives in Milestone 5 (via the repo's
 * CSS keyframe system, no animation library) and the real app screenshot in
 * Milestone 7. Nothing here hardcodes motion or imagery those milestones own.
 */
export function Hero({ section }: { section: LandingSection }) {
  const headingId = `${section.id}-heading`;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className="scroll-mt-20 border-b border-border bg-background"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-8 px-6 pb-20 pt-20 text-center sm:pt-28">
        {/* On-load staged entrance — pure CSS (works without JS), one-shot, and
            neutralized under prefers-reduced-motion by globals.css. */}
        <div className="animate-fade-rise" style={{ animationDuration: "500ms" }}>
          <Badge variant="brand">Runs 100% on your computer</Badge>
        </div>

        <div
          className="flex animate-fade-rise flex-col items-center gap-5"
          style={{ animationDuration: "500ms", animationDelay: "120ms" }}
        >
          <h1
            id={headingId}
            className="max-w-3xl text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-6xl"
          >
            Stop juggling a dozen investing tools.
          </h1>
          <p className="max-w-2xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
            Universal Asset Analyzer combines market data, filings, valuation models, and an AI
            research assistant — all on your computer.
          </p>
        </div>

        {/* CTA hierarchy: primary into the app, secondary to the in-page demo
            (the PDF's "Watch 90-second Demo" reinterpreted — no video asset yet). */}
        <div
          className="flex animate-fade-rise flex-col items-center gap-3 sm:flex-row"
          style={{ animationDuration: "500ms", animationDelay: "240ms" }}
        >
          <Link
            href={APP_ENTRY}
            className="inline-flex h-11 items-center justify-center rounded-control bg-brand px-6 text-sm font-semibold text-background outline-none transition hover:-translate-y-0.5 hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Experience UAA
          </Link>
          <a
            href="#demo"
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-control border border-border bg-surface px-6 text-sm font-semibold text-foreground outline-none transition hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Watch demo
            <span aria-hidden="true">↓</span>
          </a>
        </div>

        {/* Product reveal — placeholder frame. A faux app window whose content
            (real screenshot) lands in Milestone 7. Purely presentational and
            hidden from assistive tech. Enters last in the on-load sequence. */}
        <div
          data-testid="hero-product-reveal"
          aria-hidden="true"
          className="mt-6 w-full max-w-4xl animate-fade-rise overflow-hidden rounded-panel border border-border bg-surface shadow-card"
          style={{ animationDuration: "700ms", animationDelay: "360ms" }}
        >
          <div className="flex items-center gap-1.5 border-b border-border bg-surface-2 px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          </div>
          {/* Finished on-brand faux dashboard — token-driven, theme-aware, image-free.
              (A real app screenshot can swap in here later via next/image.) */}
          <div className="flex aspect-[16/9] gap-3 bg-background p-3 text-left">
            <div className="hidden w-1/6 flex-col gap-2 rounded-card border border-border bg-surface-2 p-2.5 sm:flex">
              <div className="h-2 w-3/4 rounded-full bg-brand/50" />
              <div className="h-2 w-full rounded-full bg-border" />
              <div className="h-2 w-2/3 rounded-full bg-border" />
              <div className="h-2 w-full rounded-full bg-border" />
              <div className="mt-auto h-2 w-1/2 rounded-full bg-border" />
            </div>
            <div className="flex flex-1 flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex flex-col gap-1.5 rounded-card border border-border bg-surface-2 p-2.5">
                    <div className="h-1.5 w-2/3 rounded-full bg-border" />
                    <div className="h-2.5 w-1/2 rounded-full bg-foreground/70" />
                  </div>
                ))}
              </div>
              <div className="flex flex-1 items-end gap-1.5 rounded-card border border-border bg-surface-2 p-3">
                {[42, 60, 48, 75, 58, 84, 66, 92].map((h, i) => (
                  <div key={i} className="flex-1 rounded-sm bg-brand/40" style={{ height: `${h}%` }} />
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-card border border-border bg-surface-2 p-2.5">
                <span className="h-4 w-4 shrink-0 rounded-full bg-brand/60" />
                <div className="flex flex-1 flex-col gap-1">
                  <div className="h-1.5 w-full rounded-full bg-border" />
                  <div className="h-1.5 w-4/5 rounded-full bg-border" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
