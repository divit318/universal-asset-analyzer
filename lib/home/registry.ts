/**
 * Home Module Registry — the single source of truth for what a homepage module
 * *is*.
 *
 * Modules register their metadata here. They do not register their components:
 * a React import in this file would make the registry client-only and stop the
 * server, the tests, and the layout validator from reading it. The id→component
 * map lives in `app/_home/module-map.ts`, and `validateHomeComposition()` below
 * is what guarantees the two never drift apart.
 *
 * To add a module:
 *   1. add its id to `HomeModuleId` (types.ts)
 *   2. add a definition here
 *   3. add its component to `app/_home/module-map.ts`
 *   4. place it in `layout.ts`
 * `app/page.tsx` is never touched.
 */

import type { HomeModuleDefinition, HomeModuleId } from "./types";
import { SIZE, BREAKPOINTS } from "./types";

/**
 * Priority orders *work*, not position — the shell uses it to decide what to
 * fetch and paint first when several modules load at once. Position is the
 * layout config's job. Lower number = more important.
 */
const DEFINITIONS: Record<HomeModuleId, HomeModuleDefinition> = {
  /* ---------------- Narrative (AI) ---------------- */

  "todays-brief": {
    id: "todays-brief",
    title: "Today's Brief",
    description: "What changed overnight, and the one thing worth your attention today.",
    loading: "eager",
    // The brief is generated once per hour per portfolio-state (see the cache key
    // in lib/home/brief.ts); polling it would just re-serve the same cached text.
    refresh: "manual",
    refreshIntervalMs: null,
    cache: { via: "stream", datasets: [] },
    priority: 1,
    defaultSize: SIZE.full,
    minSize: SIZE.full,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["ai", "portfolio-engine", "sector-rotation", "scanner"],
    dependencies: [],
    // required: false — a down Ollama yields the deterministic briefing, never an error.
    ai: { task: "daily-briefing", required: false },
    navTarget: null,
  },

  "ai-investment-brief": {
    id: "ai-investment-brief",
    title: "AI Investment Brief",
    description: "The long-form morning note: regime, opportunities, risks, and what to do.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    // Same stream as Today's Brief — one model call feeds both. See HomeBrief.
    cache: { via: "stream", datasets: [] },
    priority: 6,
    // Full-width by default (it's a long read), but it survives at half — the
    // section headings stack and the prose reflows.
    defaultSize: SIZE.full,
    minSize: SIZE.half,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["ai", "portfolio-engine", "sector-rotation", "scanner"],
    dependencies: ["todays-brief"],
    ai: { task: "daily-briefing", required: false },
    navTarget: null,
  },

  /* ---------------- Action ---------------- */

  "recommended-actions": {
    id: "recommended-actions",
    title: "Top Recommended Actions",
    description: "Ranked decisions from the portfolio engine — score, confidence, expected impact.",
    loading: "eager",
    refresh: "on-focus",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: ["quotes.batch", "fundamentals"] },
    priority: 2,
    defaultSize: SIZE.full,
    minSize: SIZE.full,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["portfolio-engine", "watchlist", "notifications"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/portfolio?tab=decisions", label: "All decisions" },
  },

  /* ---------------- Portfolio ---------------- */

  "portfolio-pulse": {
    id: "portfolio-pulse",
    title: "Portfolio Pulse",
    description: "Health, movers, concentration, drift, and cash — at a glance.",
    loading: "eager",
    refresh: "on-focus",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: ["quotes.batch"] },
    priority: 3,
    defaultSize: SIZE.wide,
    minSize: SIZE.half,
    preferredLayout: "wide",
    screens: [...BREAKPOINTS],
    requires: ["portfolio"],
    dataSources: ["portfolio-engine"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/portfolio", label: "Open portfolio" },
  },

  "portfolio-performance": {
    id: "portfolio-performance",
    title: "Portfolio Performance",
    description: "Money-weighted return (XIRR) against the benchmark.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: ["history", "quotes.batch"] },
    priority: 7,
    // A four-column rail beside Portfolio Pulse. It holds three stats, so it
    // does not shrink further — min is its default.
    defaultSize: SIZE.rail,
    minSize: SIZE.rail,
    preferredLayout: "rail",
    screens: [...BREAKPOINTS],
    requires: ["portfolio"],
    dataSources: ["portfolio-engine", "yahoo"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/portfolio?tab=performance", label: "Full performance" },
  },

  /* ---------------- Market ---------------- */

  "market-intelligence": {
    id: "market-intelligence",
    title: "Market Intelligence",
    description: "Indices, volatility, breadth, rates, commodities, currencies, and crypto.",
    loading: "eager",
    // The one module where the number on screen is genuinely live. Quotes carry a
    // 15s TTL in the platform registry, so a 60s poll costs at most one provider
    // round-trip per minute regardless of how many tabs are open.
    refresh: "interval",
    refreshIntervalMs: 60 * 1000,
    cache: { via: "digest", datasets: ["quotes.batch", "sectorRotation"] },
    priority: 4,
    defaultSize: SIZE.full,
    minSize: SIZE.full,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["yahoo", "scanner", "sector-rotation"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/scanner", label: "Market scanner" },
  },

  "opportunity-feed": {
    id: "opportunity-feed",
    title: "Opportunity Feed",
    description: "Scanner signals ranked by fit to your portfolio, not by raw score.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: [] },
    priority: 5,
    defaultSize: SIZE.half,
    minSize: SIZE.half,
    preferredLayout: "half",
    screens: [...BREAKPOINTS],
    requires: ["scanner-snapshot"],
    dataSources: ["scanner", "portfolio-engine"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/scanner", label: "Run scanner" },
  },

  "watchlist-intelligence": {
    id: "watchlist-intelligence",
    title: "Watchlist Intelligence",
    description: "Buy candidates, near-buys, triggered alerts, and upcoming earnings.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: ["quotes.batch"] },
    priority: 8,
    defaultSize: SIZE.half,
    minSize: SIZE.half,
    preferredLayout: "half",
    screens: [...BREAKPOINTS],
    requires: ["watchlist"],
    dataSources: ["watchlist", "portfolio-engine"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/watchlist", label: "Open watchlist" },
  },

  /* ---------------- Context ---------------- */

  "upcoming-events": {
    id: "upcoming-events",
    title: "Upcoming Events",
    description: "Earnings, dividends, and economic events across your holdings and watchlist.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: [] },
    priority: 9,
    defaultSize: SIZE.half,
    minSize: SIZE.half,
    preferredLayout: "half",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["calendar", "portfolio-engine", "watchlist"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/calendar", label: "Full calendar" },
  },

  continue: {
    id: "continue",
    title: "Continue Where You Left Off",
    description: "Your recent research, screens, and reports.",
    loading: "lazy",
    refresh: "static",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: [] },
    priority: 10,
    defaultSize: SIZE.half,
    minSize: SIZE.half,
    preferredLayout: "half",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["portfolio-engine", "watchlist"],
    dependencies: [],
    ai: null,
    navTarget: null,
  },
};

/* ------------------------------------------------------------------ */
/* Accessors                                                           */
/* ------------------------------------------------------------------ */

export function getHomeModule(id: HomeModuleId): HomeModuleDefinition {
  const def = DEFINITIONS[id];
  if (!def) throw new Error(`Unknown home module: ${id}`);
  return def;
}

/** All modules, ordered by fetch/paint priority (not by layout position). */
export function listHomeModules(): HomeModuleDefinition[] {
  return Object.values(DEFINITIONS).sort((a, b) => a.priority - b.priority);
}

export function homeModuleIds(): HomeModuleId[] {
  return Object.keys(DEFINITIONS) as HomeModuleId[];
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

/**
 * Structural checks on the registry itself. Run by the unit tests, so a
 * malformed definition fails CI rather than rendering a dead card.
 *
 * Returns a list of problems; empty means healthy.
 */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const defs = Object.values(DEFINITIONS);

  for (const d of defs) {
    if (d.refresh === "interval" && d.refreshIntervalMs == null) {
      problems.push(`${d.id}: refresh="interval" requires refreshIntervalMs`);
    }
    if (d.refresh !== "interval" && d.refreshIntervalMs != null) {
      problems.push(`${d.id}: refreshIntervalMs is only meaningful with refresh="interval"`);
    }
    if (d.refresh === "interval" && (d.refreshIntervalMs ?? 0) < 15 * 1000) {
      problems.push(`${d.id}: refresh interval under 15s would outpace the quote TTL`);
    }

    // A module may be widened by the layout but never rendered below its minimum.
    for (const bp of BREAKPOINTS) {
      if (d.defaultSize[bp] < d.minSize[bp]) {
        problems.push(`${d.id}: defaultSize.${bp} (${d.defaultSize[bp]}) is below minSize.${bp} (${d.minSize[bp]})`);
      }
      if (d.defaultSize[bp] > 12 || d.minSize[bp] < 1) {
        problems.push(`${d.id}: size at ${bp} is outside the 1-12 grid`);
      }
    }

    if (d.ai && d.cache.via === "digest") {
      problems.push(`${d.id}: AI modules must not ride the digest — AI is slow and the digest must paint immediately`);
    }

    for (const dep of d.dependencies) {
      if (!DEFINITIONS[dep]) problems.push(`${d.id}: depends on unknown module "${dep}"`);
      if (dep === d.id) problems.push(`${d.id}: depends on itself`);
    }
  }

  // Dependency cycles: a module that waits on a module that waits on it never paints.
  for (const d of defs) {
    const seen = new Set<HomeModuleId>();
    const walk = (id: HomeModuleId): boolean => {
      if (id === d.id && seen.size > 0) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return (DEFINITIONS[id]?.dependencies ?? []).some(walk);
    };
    if (d.dependencies.some(walk)) problems.push(`${d.id}: dependency cycle`);
  }

  const priorities = defs.map((d) => d.priority);
  if (new Set(priorities).size !== priorities.length) {
    problems.push("duplicate priority values — paint order would be non-deterministic");
  }

  return problems;
}
