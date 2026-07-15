/**
 * Home Layout Configuration — where modules go, and nothing about what they are.
 *
 * This is the seam the whole Phase 1 architecture exists to create. Reordering
 * the homepage, regrouping it, changing how it reflows, collapsing a section by
 * default, or hiding a module entirely is a change *to this file only*. No
 * module knows its own position, and `app/page.tsx` contains no ordering logic
 * — it walks this config.
 *
 * Phase 2 can restructure the entire page here without opening a single module,
 * engine, or API route.
 *
 * Client-safe: pure data.
 */

import type { Breakpoint, HomeModuleId } from "./types";
import { BREAKPOINTS, SIZE } from "./types";
import { getHomeModule, homeModuleIds } from "./registry";

/** Tailwind gap tokens — never raw pixels, so the design system owns spacing. */
export type SpacingToken = "gap-3" | "gap-4" | "gap-6" | "gap-8";

export interface LayoutSlot {
  moduleId: HomeModuleId;
  /**
   * Column span per breakpoint, in 12ths. Omit to use the module's
   * `defaultSize`. Never allowed below the module's `minSize` — validated.
   */
  span?: Partial<Record<Breakpoint, number>>;
  /** A module can be switched off without deleting it or its data path. */
  visible?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface LayoutGroup {
  id: string;
  /** Optional visible heading. Groups exist for rhythm even without one. */
  label?: string;
  description?: string;
  /** Grid columns at each breakpoint. The page is a 12-col grid at lg+. */
  columns: Record<Breakpoint, number>;
  gap: SpacingToken;
  slots: LayoutSlot[];
}

export interface HomeLayoutConfig {
  /** Vertical rhythm between groups. */
  groupGap: SpacingToken;
  groups: LayoutGroup[];
}

/** Single-column below lg; a 12-column grid at lg and up. */
const GRID: Record<Breakpoint, number> = { sm: 12, md: 12, lg: 12, xl: 12 };

/**
 * The default homepage.
 *
 * The order answers the question the page exists to answer, top to bottom:
 * what changed (brief) → what should I do (actions) → how am I doing (pulse) →
 * what's the market doing (intelligence) → what's next (opportunities, events)
 * → where was I (continue).
 */
export const HOME_LAYOUT: HomeLayoutConfig = {
  groupGap: "gap-8",
  groups: [
    {
      id: "brief",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "todays-brief" }],
    },
    {
      id: "act",
      label: "What to do",
      description: "Ranked by the portfolio engine — highest decision score first.",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "recommended-actions" }],
    },
    {
      id: "position",
      label: "Where you stand",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "portfolio-pulse" },
        { moduleId: "portfolio-performance" },
      ],
    },
    {
      id: "market",
      label: "The market",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "market-intelligence" }],
    },
    {
      id: "explore",
      label: "What's next",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "opportunity-feed" },
        { moduleId: "watchlist-intelligence" },
        { moduleId: "upcoming-events" },
        { moduleId: "continue" },
      ],
    },
    {
      id: "note",
      label: "The long read",
      description: "A full morning note, written from the same data as the brief above.",
      columns: GRID,
      gap: "gap-4",
      slots: [
        // Collapsed by default: it's the deepest content on the page and the
        // user has already read the headline version at the top.
        { moduleId: "ai-investment-brief", span: SIZE.full, collapsible: true, defaultCollapsed: true },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface ResolvedSlot extends LayoutSlot {
  /** Fully-specified span — the module's default, with the slot's overrides applied. */
  resolvedSpan: Record<Breakpoint, number>;
}

/**
 * Applies a slot's span overrides on top of the module's declared default, and
 * clamps to the module's minimum. A layout can widen a module freely; it cannot
 * squeeze one below the width its author said it needs to stay readable.
 */
export function resolveSlot(slot: LayoutSlot): ResolvedSlot {
  const def = getHomeModule(slot.moduleId);
  const resolvedSpan = {} as Record<Breakpoint, number>;

  for (const bp of BREAKPOINTS) {
    const requested = slot.span?.[bp] ?? def.defaultSize[bp];
    resolvedSpan[bp] = Math.max(requested, def.minSize[bp]);
  }

  return { ...slot, resolvedSpan };
}

/** Slots the page should actually render, in order, with spans resolved. */
export function resolveLayout(config: HomeLayoutConfig = HOME_LAYOUT): LayoutGroup[] {
  return config.groups
    .map((g) => ({ ...g, slots: g.slots.filter((s) => s.visible !== false) }))
    .filter((g) => g.slots.length > 0);
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

/**
 * Cross-checks the layout against the registry. This is what stops the two
 * files from silently drifting: a module placed twice, a module that exists but
 * is never placed, or a slot squeezed below its module's minimum all fail here
 * rather than at render time.
 *
 * `componentIds` is the key set of `app/_home/module-map.ts`, passed in rather
 * than imported so this file stays free of React.
 */
export function validateHomeComposition(
  config: HomeLayoutConfig = HOME_LAYOUT,
  componentIds?: HomeModuleId[],
): string[] {
  const problems: string[] = [];
  const placed = new Map<HomeModuleId, number>();

  for (const group of config.groups) {
    for (const slot of group.slots) {
      placed.set(slot.moduleId, (placed.get(slot.moduleId) ?? 0) + 1);

      let def;
      try {
        def = getHomeModule(slot.moduleId);
      } catch {
        problems.push(`layout group "${group.id}" places unknown module "${slot.moduleId}"`);
        continue;
      }

      for (const bp of BREAKPOINTS) {
        const requested = slot.span?.[bp];
        if (requested != null && requested < def.minSize[bp]) {
          problems.push(
            `layout group "${group.id}": ${slot.moduleId} span.${bp}=${requested} is below its minSize.${bp}=${def.minSize[bp]}`,
          );
        }
        if (requested != null && requested > group.columns[bp]) {
          problems.push(
            `layout group "${group.id}": ${slot.moduleId} span.${bp}=${requested} exceeds the group's ${group.columns[bp]} columns`,
          );
        }
      }

      if (slot.defaultCollapsed && !slot.collapsible) {
        problems.push(`layout group "${group.id}": ${slot.moduleId} is defaultCollapsed but not collapsible`);
      }
    }
  }

  for (const [id, count] of placed) {
    if (count > 1) problems.push(`${id} is placed ${count} times — a module renders once`);
  }

  for (const id of homeModuleIds()) {
    if (!placed.has(id)) problems.push(`${id} is registered but never placed in the layout`);
  }

  if (componentIds) {
    for (const id of homeModuleIds()) {
      if (!componentIds.includes(id)) problems.push(`${id} is registered but has no component in module-map`);
    }
    for (const id of componentIds) {
      if (!homeModuleIds().includes(id)) problems.push(`module-map has a component for unregistered module "${id}"`);
    }
  }

  return problems;
}
