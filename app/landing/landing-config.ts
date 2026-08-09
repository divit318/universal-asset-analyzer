/**
 * Landing site configuration — the single source of truth for the marketing
 * experience's structure and its portable routing seams.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MIGRATION CONTRACT
 *
 * This experience lives at /landing today and is designed to become the site
 * root (/) later, with the authenticated app moving to /app (or /dashboard).
 * When that happens, ONLY routing changes — not components. Every path the
 * marketing UI depends on is centralized here:
 *
 *   - LANDING_HOME : where the logo/brand links (the marketing home).
 *   - APP_ENTRY    : where "Experience UAA" sends the visitor (the live app).
 *
 * Components import these constants; they never hardcode "/landing". Promoting
 * the site is then: flip LANDING_HOME to "/", flip APP_ENTRY to "/app", move
 * the route folder, and update the SiteHeader suppression predicate. No section
 * component is rewritten.
 * ───────────────────────────────────────────────────────────────────────────── */

/** The marketing home. Becomes "/" post-migration. */
export const LANDING_HOME = "/landing";

/** Where the primary CTA enters the live application. */
export const APP_ENTRY = "/";

/**
 * One name per action, everywhere: nav, hero, pricing, final CTA, footer all
 * use PRIMARY_ACTION. The hero's secondary CTA scrolls to the in-page demo
 * (no demo video asset exists in the repo), so it is named for what it does.
 * The FINAL CTA's secondary action must point forward, not back up the page:
 * it enters the live app, so the page escalates instead of looping.
 */
export const PRIMARY_ACTION = "Get started";
export const SECONDARY_ACTION = "See it in action";
export const FINAL_SECONDARY_ACTION = "Open the live app";

/**
 * The four canonical trust claims. Trust strips appear four times on the page
 * and all argue these same four things, so the page makes one consistent case.
 * Icons attach at the call site (lucide imports stay out of this config).
 */
export const TRUST_CLAIMS = [
  { label: "Local-first", sub: "Your database, on your disk" },
  { label: "Deterministic", sub: "Engines compute, AI explains" },
  { label: "Your own key", sub: "Your provider bills you directly" },
  { label: "No subscription", sub: "Free and complete today" },
] as const;

/**
 * The information architecture, in scroll order. This drives both the page
 * (which renders a section per entry) and the header anchor nav (entries with a
 * `nav` label). Reordering the page = reordering this array. Adding a section =
 * adding an entry. Section content components are keyed by `id` in later
 * milestones; Milestone 1 renders each as an empty placeholder.
 *
 * Order follows the approved Creative Direction IA (which outranks the leaner
 * Deep Research list in our precedence order).
 */
export interface LandingSection {
  /** Stable DOM id and anchor target (e.g. "#features"). Never change once shipped. */
  id: string;
  /** Working title shown in the skeleton and used as the section's accessible name. */
  title: string;
  /** Short kicker/eyebrow above the title. */
  kicker: string;
  /** If set, the section appears in the header anchor nav with this label. */
  nav?: string;
  /** The hero is the page's single <h1>; every other section is an <h2>. */
  top?: boolean;
}

export const SECTIONS: LandingSection[] = [
  { id: "hero", kicker: "Universal Asset Analyzer", title: "The AI terminal for investors", top: true },
  { id: "problem", kicker: "The problem", title: "Research is fragmented across a dozen tools", nav: "Problem" },
  { id: "solution", kicker: "The solution", title: "One intelligent analysis workbench" },
  { id: "privacy", kicker: "Local-first", title: "Your data lives on your computer" },
  { id: "features", kicker: "Capabilities", title: "Everything serious research needs", nav: "Features" },
  { id: "demo", kicker: "Try it", title: "See UAA in action", nav: "Demo" },
  { id: "comparison", kicker: "Compare", title: "How UAA stacks up", nav: "Compare" },
  { id: "pricing", kicker: "Pricing", title: "Free to run. Pro when you want us to run it.", nav: "Pricing" },
  { id: "faq", kicker: "Questions", title: "Frequently asked questions", nav: "FAQ" },
  { id: "cta", kicker: "Ready?", title: "Experience Universal Asset Analyzer" },
];

/** The header anchor-nav items, derived from the IA so they can never drift. */
export const NAV_SECTIONS = SECTIONS.filter((s) => s.nav);
