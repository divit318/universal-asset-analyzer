/**
 * Home Module Contract — the interface every homepage section implements.
 *
 * The homepage is a *composition* of modules, not a page with sections. It
 * holds no business logic: it reads the layout config, resolves each slot to a
 * module definition here, and hands the definition to a shell that renders it.
 * Adding a module means adding a definition + a component and naming it in the
 * layout — no edit to `app/page.tsx`.
 *
 * The split that makes Phase 2 (the visual overhaul) cheap:
 *
 *   metadata (this file, registry.ts, layout.ts)  — pure data, no React
 *        ↓
 *   data (digest.ts and the engines it composes) — pure TS, server-side
 *        ↓
 *   shell (app/_home/module-shell.tsx)           — state machine + lifecycle
 *        ↓
 *   presentation (app/_home/modules/*)           — markup only
 *
 * Phase 2 rewrites the bottom two layers and the design tokens. It must not
 * need to touch this file, the registry, the layout config, or any engine.
 *
 * Client-safe: pure types and data, no server imports.
 */

import type { DatasetId } from "../platform/types";
import type { TaskType } from "../ai/task-registry";

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export type HomeModuleId =
  | "todays-brief"
  | "book"
  | "whats-changed"
  | "attention-queue"
  | "radar"
  | "market-intelligence"
  | "ai-investment-brief";

/* ------------------------------------------------------------------ */
/* Sizing & layout vocabulary                                          */
/* ------------------------------------------------------------------ */

/** Grid columns the homepage renders at each breakpoint. Layout is 12-col at `xl`. */
export type Breakpoint = "sm" | "md" | "lg" | "xl";

export const BREAKPOINTS: readonly Breakpoint[] = ["sm", "md", "lg", "xl"] as const;

/**
 * A module's footprint, in 12-column units, at each breakpoint. Modules declare
 * a *default* and a *minimum*; the layout config may widen a module beyond its
 * default but may never render it below its minimum — that's the contract that
 * lets Phase 2 re-flow the grid without a module silently becoming unreadable.
 */
export type ModuleSize = Record<Breakpoint, number>;

/** Named footprints, so definitions read as intent rather than arithmetic. */
export const SIZE = {
  /** Full-bleed row. */
  full: { sm: 12, md: 12, lg: 12, xl: 12 } as ModuleSize,
  /** Half on large screens, full below. */
  half: { sm: 12, md: 12, lg: 6, xl: 6 } as ModuleSize,
  /** Two-thirds — the "primary column" of an asymmetric row. */
  wide: { sm: 12, md: 12, lg: 8, xl: 8 } as ModuleSize,
  /** One-third — the "rail" of an asymmetric row. */
  rail: { sm: 12, md: 12, lg: 4, xl: 4 } as ModuleSize,
  /** Quarter — only viable for dense stat strips. */
  quarter: { sm: 12, md: 6, lg: 3, xl: 3 } as ModuleSize,
} as const;

/** How a module *wants* to be laid out. The layout config may override; this is the hint. */
export type PreferredLayout = "full" | "wide" | "rail" | "half" | "quarter";

/* ------------------------------------------------------------------ */
/* Loading, refresh, and cache policy                                  */
/* ------------------------------------------------------------------ */

/**
 * When the module's data is requested.
 *
 * `eager` and `deferred` differ in *priority*, not correctness — both fetch on
 * mount. `deferred` exists because the homepage fires one digest request plus a
 * handful of module-owned requests, and the ones below the fold should not
 * compete with the ones above it. `lazy` genuinely waits for viewport entry.
 */
export type LoadingStrategy = "eager" | "deferred" | "lazy";

/**
 * What causes the module's data to be re-requested after the first load.
 *
 * `interval` is the only strategy that polls; everything else is user- or
 * event-driven. A module that names `interval` MUST also give a
 * `refreshIntervalMs`, and the registry test enforces it — an interval strategy
 * with no interval is the kind of bug that looks fine until nothing ever
 * updates.
 */
export type RefreshStrategy =
  /** Re-requested only when the user asks (the shell's refresh affordance). */
  | "manual"
  /** Polls on a timer while the tab is visible. */
  | "interval"
  /** Re-requested when the tab regains focus. */
  | "on-focus"
  /** Never re-requested after first load (static or session-scoped content). */
  | "static";

/**
 * Cache policy. Modules do NOT own caches — `lib/platform/` does. A module
 * either reads a platform dataset (naming it here, so the policy stays in
 * `platform/registry.ts` and nowhere else) or reads the shared home digest,
 * which is itself assembled from platform-routed fetches.
 *
 * This field is therefore a *declaration of what the module depends on*, not a
 * place to configure a TTL. Adding a TTL here would recreate the exact
 * five-competing-caches problem the platform layer was built to kill.
 */
export interface ModuleCachePolicy {
  /** Where the module's data comes from. */
  via: "digest" | "dataset" | "stream" | "none";
  /** Platform datasets this module's data is ultimately built from. */
  datasets: DatasetId[];
}

/* ------------------------------------------------------------------ */
/* Preconditions                                                       */
/* ------------------------------------------------------------------ */

/**
 * What must be true for the module to render content rather than an empty
 * state.
 *
 * The brief called these "required permissions". UAA has no auth and no
 * multi-user model, so there is nothing to authorize — modelling these as
 * permissions would be theatre. What actually gates a module is *capability*:
 * a Portfolio Pulse with no holdings has nothing to say, and it should say so
 * rather than render a zeroed-out card. The shell reads these to pick the empty
 * state and its call-to-action.
 */
export type Capability =
  /** At least one portfolio holding. */
  | "portfolio"
  /** At least one watchlist entry. */
  | "watchlist"
  /** A Scanner snapshot has been persisted at least once. */
  | "scanner-snapshot"
  /** Ollama is reachable. AI modules degrade to a deterministic fallback, never fail. */
  | "ollama"
  /** At least one recorded decision (the journal's calibration floor). */
  | "decisions";

/** Upstream feeds a module reads. Surfaced in the provenance/debug view. */
export type HomeDataSource =
  | "portfolio-engine"
  | "scanner"
  | "sector-rotation"
  | "watchlist"
  | "calendar"
  | "notifications"
  | "decision-journal"
  | "yahoo"
  | "ai";

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * The events a module's shell emits. Phase 2 attaches motion to these; Phase 1
 * only guarantees they fire at the right moments and carry no styling meaning.
 *
 * Deliberately *not* implemented as animations here. The point is that a module
 * never needs to know it is being animated — the shell owns the transitions, so
 * Phase 2 can swap in a motion library at one seam.
 */
export type ModuleLifecycleEvent =
  | "mount"
  | "unmount"
  | "loading"
  | "success"
  | "error"
  | "refresh"
  | "expand"
  | "collapse"
  | "reorder"
  | "resize";

export type ModuleLifecycleListener = (
  event: ModuleLifecycleEvent,
  moduleId: HomeModuleId,
) => void;

/* ------------------------------------------------------------------ */
/* The contract                                                        */
/* ------------------------------------------------------------------ */

export interface HomeModuleDefinition {
  id: HomeModuleId;
  title: string;
  description: string;

  /** Data acquisition. */
  loading: LoadingStrategy;
  refresh: RefreshStrategy;
  /** Required iff `refresh === "interval"`; must be null otherwise. */
  refreshIntervalMs: number | null;
  cache: ModuleCachePolicy;

  /** Layout. A module never positions itself — `layout.ts` decides where it goes. */
  priority: number;
  defaultSize: ModuleSize;
  minSize: ModuleSize;
  preferredLayout: PreferredLayout;
  /** Breakpoints at which the module is rendered at all. */
  screens: Breakpoint[];

  /** Preconditions and provenance. */
  requires: Capability[];
  dataSources: HomeDataSource[];
  /** Other modules whose data this one reads. Cycles are rejected by the registry. */
  dependencies: HomeModuleId[];

  /** Null for deterministic modules. AI modules must still render without Ollama. */
  ai: { task: TaskType; /** false = module has a deterministic fallback */ required: boolean } | null;

  /** Where "open this" goes. Null for modules that are terminal. */
  navTarget: { href: string; label: string } | null;
}
