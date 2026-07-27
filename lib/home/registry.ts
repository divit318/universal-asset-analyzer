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
  /* ---------------- Command row ---------------- */

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
    // The hero, but not full-bleed: it sits beside the book rail in the command
    // row, so it defaults to two-thirds and survives at half.
    defaultSize: SIZE.wide,
    minSize: SIZE.half,
    preferredLayout: "wide",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["ai", "portfolio-engine", "sector-rotation", "scanner"],
    dependencies: [],
    // required: false — a down Ollama yields the deterministic briefing, never an error.
    ai: { task: "daily-briefing", required: false },
    navTarget: null,
  },

  "book": {
    id: "book",
    title: "Book",
    description: "Health, return vs. benchmark, cash, and today's P&L.",
    loading: "eager",
    refresh: "on-focus",
    refreshIntervalMs: null,
    // Merges what portfolio-pulse (health) and portfolio-performance (return)
    // read — the same digest slices, no new endpoint.
    cache: { via: "digest", datasets: ["quotes.batch", "history"] },
    priority: 2,
    // The command row's one-third rail beside the brief.
    defaultSize: SIZE.rail,
    minSize: SIZE.rail,
    preferredLayout: "rail",
    screens: [...BREAKPOINTS],
    requires: ["portfolio"],
    dataSources: ["portfolio-engine", "yahoo"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/portfolio", label: "Open portfolio" },
  },

  /* ---------------- Change band ---------------- */

  "whats-changed": {
    id: "whats-changed",
    title: "Since Last Visit",
    description: "What moved while you were away — ranked, material changes only.",
    loading: "eager",
    refresh: "on-focus",
    refreshIntervalMs: null,
    // Pure digest slice: the diff is computed server-side during the digest
    // build, against the previous session's persisted baseline. No AI, no
    // extra fetch — it paints with the first deterministic pass.
    cache: { via: "digest", datasets: [] },
    priority: 3,
    defaultSize: SIZE.full,
    minSize: SIZE.full,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["portfolio-engine", "scanner", "watchlist", "sector-rotation"],
    dependencies: [],
    ai: null,
    // Terminal by design — each change chip carries its own deep link.
    navTarget: null,
  },

  /* ---------------- Attention row ---------------- */

  "attention-queue": {
    id: "attention-queue",
    title: "Attention",
    description: "One ranked, dismissible stream of everything that needs a decision.",
    loading: "eager",
    refresh: "on-focus",
    refreshIntervalMs: null,
    // Rides the digest (deterministic, no AI in its paint path). The dismissal
    // state joins in the digest build server-side; the queue never fetches.
    cache: { via: "digest", datasets: ["quotes.batch", "fundamentals"] },
    priority: 4,
    // The centerpiece: two-thirds of the attention row, survives at half.
    defaultSize: SIZE.wide,
    minSize: SIZE.half,
    preferredLayout: "wide",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["portfolio-engine", "watchlist", "calendar", "scanner", "notifications"],
    dependencies: [],
    ai: null,
    // Terminal by design — each row carries its own primary deep link, so the
    // card header has no single "open this".
    navTarget: null,
  },

  "radar": {
    id: "radar",
    title: "Radar",
    description: "Ideas entering the pipeline — scanner fits and buy candidates.",
    loading: "deferred",
    refresh: "on-focus",
    refreshIntervalMs: null,
    cache: { via: "digest", datasets: [] },
    priority: 5,
    // The attention row's one-third rail beside the queue.
    defaultSize: SIZE.rail,
    minSize: SIZE.rail,
    preferredLayout: "rail",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["scanner", "watchlist", "portfolio-engine"],
    dependencies: [],
    ai: null,
    navTarget: { href: "/scanner", label: "Scanner" },
  },

  /* ---------------- Tape ---------------- */

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
    priority: 6,
    defaultSize: SIZE.full,
    minSize: SIZE.full,
    preferredLayout: "full",
    screens: [...BREAKPOINTS],
    requires: [],
    dataSources: ["yahoo", "scanner", "sector-rotation"],
    dependencies: [],
    ai: null,
    // The link's label matches the destination's own <h1> and its nav entry.
    // Previously this module ("Market Intelligence") linked to a page whose
    // heading also said "Market Intelligence" under a nav entry that said
    // "Scanner", via a link labelled "Market scanner" — four names for two
    // things. This module keeps its own name (it shows the tape); the
    // destination is called Scanner everywhere.
    navTarget: { href: "/scanner", label: "Scanner" },
  },

  /* ---------------- Long read ---------------- */

  "ai-investment-brief": {
    id: "ai-investment-brief",
    title: "AI Investment Brief",
    description: "The long-form morning note: regime, opportunities, risks, and what to do.",
    loading: "deferred",
    refresh: "manual",
    refreshIntervalMs: null,
    // Same stream as Today's Brief — one model call feeds both. See HomeBrief.
    cache: { via: "stream", datasets: [] },
    priority: 7,
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

/**
 * Every navTarget must resolve to a route that actually exists (§19 Phase B).
 * A home module whose "open this" points at a deleted route is a dead end the
 * user hits from the most-visited page in the app — exactly the failure the IA
 * repair introduced risk of, when `/intelligence` was dissolved.
 *
 * `knownRoutes` is the set of real route pathnames, passed in (like
 * `componentIds` for `validateHomeComposition`) so this check stays free of the
 * filesystem and of the nav config. The query/hash is stripped before the
 * lookup, so `/portfolio?tab=performance` resolves against `/portfolio`.
 *
 * Returns a list of problems; empty means every navTarget is live.
 */
export function validateNavTargets(knownRoutes: Iterable<string>): string[] {
  const problems: string[] = [];
  const routes = new Set(knownRoutes);

  for (const d of Object.values(DEFINITIONS)) {
    if (!d.navTarget) continue;
    const path = d.navTarget.href.split(/[?#]/)[0];
    if (!routes.has(path)) {
      problems.push(`${d.id}: navTarget "${d.navTarget.href}" points at a dead route (${path})`);
    }
  }

  return problems;
}
