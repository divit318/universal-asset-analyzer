import { SECTIONS } from "./landing-config";
import { resolveSection } from "./_components/section-registry";

/**
 * The landing page — the future root experience, built at /landing for now.
 *
 * Like the dashboard's page.tsx, this file holds no content and no layout
 * decisions: it walks the section registry (landing-config.ts) and renders the
 * page in IA order. Milestone 1 renders every section as an empty placeholder;
 * later milestones swap placeholders for real section components keyed by id,
 * without this file changing. Header and footer live in layout.tsx.
 *
 * Fully static (Server Component, no data fetching) for SEO and instant paint —
 * the reconciled stance on the PDFs' SSG/performance goals.
 */
export default function LandingPage() {
  return (
    <>
      {SECTIONS.map((section, i) => {
        const Section = resolveSection(section.id);
        return <Section key={section.id} section={section} index={i} />;
      })}
    </>
  );
}
