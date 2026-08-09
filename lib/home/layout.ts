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
export type SpacingToken = "gap-3" | "gap-4" | "gap-5" | "gap-6" | "gap-8";

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
 * The default homepage — "state + delta + queue" (audit 06, restructure B).
 * Three full-width zones in question order, then a demoted context shelf:
 *
 *   1. STATE — where do I stand. The book, flattened to a strip.
 *   2. DELTA — what changed since I was last here. Owns the diff AND the AI
 *      one-line verdict (the "so what" belongs beside the diff it captions).
 *   3. QUEUE — what do I do. Full width; the page's one ranked worklist.
 *   4. CONTEXT — ideas (Radar owns signals now) and the tape, collapsible.
 *
 * The old hero brief and the long read are retired in place (`visible: false`):
 * their unique content moved into the zones (audit IA-02/05, RD-01/04); their
 * data paths stay intact so restoring either is a one-line layout edit.
 */
export const HOME_LAYOUT: HomeLayoutConfig = {
  groupGap: "gap-6",
  groups: [
    // Zone 1: where do I stand.
    {
      id: "state",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "book", span: SIZE.full }],
    },
    // Zone 2: what changed. The first question a returning user asks, so it
    // sits directly under the state strip (audit IA-03).
    {
      id: "delta",
      columns: GRID,
      gap: "gap-4",
      slots: [{ moduleId: "whats-changed" }],
    },
    // Zone 3: what do I do. Signals are removed from the queue server-side —
    // the Radar is their sole owner (audit RD-02/IA-04).
    {
      id: "queue",
      columns: GRID,
      gap: "gap-5",
      slots: [{ moduleId: "attention-queue", span: SIZE.full }],
    },
    // Context shelf: present but demoted to disclosure.
    {
      id: "context",
      label: "Context",
      description: "Ideas entering the pipeline, and the tape.",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "radar", span: SIZE.full, collapsible: true },
        { moduleId: "market-intelligence", collapsible: true, defaultCollapsed: true },
      ],
    },
    // Retired in place: data paths intact, position withdrawn (audit IA-02,
    // IA-06). The AI verdict renders in the delta band; the full note is its
    // disclosure.
    {
      id: "retired",
      columns: GRID,
      gap: "gap-4",
      slots: [
        { moduleId: "todays-brief", visible: false },
        { moduleId: "ai-investment-brief", visible: false },
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
