import type { LandingSection } from "../landing-config";

/**
 * Milestone 1 skeleton: an empty, correctly-ordered section shell. It carries
 * the stable DOM id (anchor target), the section's accessible heading, and
 * generous vertical rhythm so the page's structure and scroll flow are visible
 * before any real content exists.
 *
 * Later milestones replace these placeholders one at a time with real section
 * components keyed by `section.id`. Nothing here hardcodes copy, images, or
 * layout that a real section would need to fight — it is intentionally hollow.
 */
export function SectionPlaceholder({ section, index }: { section: LandingSection; index: number }) {
  const Heading = section.top ? "h1" : "h2";
  const headingId = `${section.id}-heading`;
  // Alternate the surface so stacked empty sections read as distinct bands.
  const banded = index % 2 === 1;

  return (
    <section
      id={section.id}
      aria-labelledby={headingId}
      className={`scroll-mt-20 border-b border-border ${banded ? "bg-surface" : "bg-background"}`}
    >
      <div className="mx-auto flex min-h-[60vh] w-full max-w-7xl flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <p className="text-label font-semibold uppercase tracking-widest text-brand">{section.kicker}</p>
        <Heading
          id={headingId}
          className={`max-w-3xl text-balance font-semibold tracking-tight text-foreground ${
            section.top ? "text-4xl sm:text-6xl" : "text-2xl sm:text-4xl"
          }`}
        >
          {section.title}
        </Heading>
        <p className="text-sm text-faint">
          {/* Skeleton marker — removed as each section is implemented. */}
          Section placeholder · <span className="font-mono">#{section.id}</span>
        </p>
      </div>
    </section>
  );
}
