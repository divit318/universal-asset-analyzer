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
 * A module route inside the live app (e.g. appRoute("/screener")). Kept
 * relative to APP_ENTRY so the post-migration flip to "/app" carries every
 * deep link with it. The app is local-first with no auth wall, so these are
 * real destinations for a first-time visitor, not dead affordances.
 */
export const appRoute = (path: string): string =>
  APP_ENTRY === "/" ? path : `${APP_ENTRY}${path}`;

/**
 * One name per action, everywhere. The app is open, free, and local-first —
 * there is no auth wall — so the primary action ENTERS IT DIRECTLY (a link to
 * APP_ENTRY) in the nav, hero, pricing, footer, and final CTA alike; no modal
 * stands in front of an open door. The optional local account keeps its own
 * quiet affordances ("Sign in" in the nav, a text link under the final CTA).
 * The hero's secondary CTA scrolls to the live demo directly beneath it, so
 * it is named for the outcome, not the scroll.
 */
export const PRIMARY_ACTION = "Open the terminal";
export const SECONDARY_ACTION = "Analyze an asset";
export const FINAL_PRIMARY_ACTION = "Open the terminal";

/**
 * The four canonical trust claims. The trust strip appears exactly ONCE on
 * the page (the Solution section, per the hero and final-CTA rebuilds), so
 * the claims read as substantiation there instead of a repeated refrain.
 * Icons attach at the call site (lucide imports stay out of this config).
 */
export const TRUST_CLAIMS = [
  { label: "Local-first", sub: "Your database, on your disk" },
  { label: "Deterministic", sub: "Engines compute, AI explains" },
  { label: "Your own AI", sub: "Devin login or your own key" },
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
  { id: "hero", kicker: "Universal Asset Analyzer", title: "Investment research, running on your machine", top: true },
  { id: "demo", kicker: "Try it", title: "Analyzed live, right here", nav: "Demo" },
  { id: "problem", kicker: "The problem", title: "Research is fragmented across a dozen tools", nav: "Problem" },
  { id: "solution", kicker: "The solution", title: "One auditable analysis workbench" },
  { id: "privacy", kicker: "Local-first", title: "Your data lives on your computer" },
  { id: "features", kicker: "Capabilities", title: "One workflow, five instruments", nav: "Features" },
  { id: "comparison", kicker: "Compare", title: "Three tools, three different jobs", nav: "Compare" },
  { id: "pricing", kicker: "Pricing", title: "Free to run. Pro when you want us to run it.", nav: "Pricing" },
  { id: "faq", kicker: "Questions", title: "Frequently asked questions", nav: "FAQ" },
  { id: "cta", kicker: "Nothing in the way", title: "Already on your machine" },
];

/** The header anchor-nav items, derived from the IA so they can never drift. */
export const NAV_SECTIONS = SECTIONS.filter((s) => s.nav);
