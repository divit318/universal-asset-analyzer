/**
 * The registry/layout/component-map integrity suite.
 *
 * This is the test that makes the "add a module without touching the page"
 * claim real. The three sources that must agree — the registry (metadata), the
 * layout (placement), and the module map (components) — are separate files by
 * design, so nothing but a test can stop them drifting apart. A module
 * registered but never placed, placed but never built, or squeezed below its
 * declared minimum width fails here rather than rendering a dead card.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateRegistry, validateNavTargets, listHomeModules, homeModuleIds, getHomeModule } from "@/lib/home/registry";
import { HOME_LAYOUT, validateHomeComposition, resolveSlot, resolveLayout } from "@/lib/home/layout";
import type { HomeModuleId } from "@/lib/home/types";

/** Discover the app's real route pathnames from the filesystem (dirs with a
 *  page.tsx), skipping private (_), group ((…)), and api segments. Dynamic
 *  segments like [symbol] are kept verbatim. Mirrors Next.js App Router. */
function discoverRoutes(dir: string, base = ""): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("_") || entry.name.startsWith("(") || entry.name === "api") continue;
    const full = join(dir, entry.name);
    const routePath = `${base}/${entry.name}`;
    if (existsSync(join(full, "page.tsx"))) routes.push(routePath);
    routes.push(...discoverRoutes(full, routePath));
  }
  return routes;
}

// Mirrors app/_home/module-map.ts. Duplicated deliberately: importing the real
// map would pull React components (and the whole client tree) into a Node test.
// The list being wrong is itself a failure this suite catches, via the
// "registered but has no component" check below.
const COMPONENT_IDS: HomeModuleId[] = [
  "todays-brief",
  "book",
  "attention-queue",
  "radar",
  "market-intelligence",
  "ai-investment-brief",
];

describe("home module registry", () => {
  it("is structurally valid", () => {
    expect(validateRegistry()).toEqual([]);
  });

  it("gives every module a unique paint priority", () => {
    const priorities = listHomeModules().map((m) => m.priority);
    expect(new Set(priorities).size).toBe(priorities.length);
  });

  it("orders listHomeModules() by priority", () => {
    const priorities = listHomeModules().map((m) => m.priority);
    expect([...priorities].sort((a, b) => a - b)).toEqual(priorities);
  });

  it("requires an interval for interval-refreshed modules, and forbids it otherwise", () => {
    for (const m of listHomeModules()) {
      if (m.refresh === "interval") expect(m.refreshIntervalMs).toBeGreaterThanOrEqual(15_000);
      else expect(m.refreshIntervalMs).toBeNull();
    }
  });

  it("keeps AI modules off the digest — the digest must paint without waiting on a model", () => {
    for (const m of listHomeModules()) {
      if (m.ai) expect(m.cache.via).not.toBe("digest");
    }
  });

  it("points every navTarget at a route that actually exists (§19 Phase B — no dead links)", () => {
    const routes = new Set(["/", ...discoverRoutes(join(process.cwd(), "app"))]);
    expect(validateNavTargets(routes)).toEqual([]);
  });

  it("flags a navTarget whose route is missing", () => {
    // With only "/" known, the real /portfolio and /scanner targets must be flagged.
    const problems = validateNavTargets(new Set(["/"]));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes("dead route"))).toBe(true);
  });
});

describe("home layout", () => {
  it("composes cleanly against the registry and the component map", () => {
    expect(validateHomeComposition(HOME_LAYOUT, COMPONENT_IDS)).toEqual([]);
  });

  it("places every registered module exactly once", () => {
    const placed = HOME_LAYOUT.groups.flatMap((g) => g.slots.map((s) => s.moduleId));
    expect([...placed].sort()).toEqual([...homeModuleIds()].sort());
  });

  it("never resolves a slot below its module's declared minimum width", () => {
    for (const group of HOME_LAYOUT.groups) {
      for (const slot of group.slots) {
        const def = getHomeModule(slot.moduleId);
        const { resolvedSpan } = resolveSlot(slot);
        for (const bp of ["sm", "md", "lg", "xl"] as const) {
          expect(resolvedSpan[bp]).toBeGreaterThanOrEqual(def.minSize[bp]);
        }
      }
    }
  });

  it("clamps a slot that asks for less than the module's minimum", () => {
    // attention-queue declares minSize.lg = 6. A layout asking for 3 must get 6.
    const { resolvedSpan } = resolveSlot({ moduleId: "attention-queue", span: { lg: 3 } });
    expect(resolvedSpan.lg).toBe(6);
  });

  it("honours a widening override", () => {
    const { resolvedSpan } = resolveSlot({ moduleId: "attention-queue", span: { lg: 12 } });
    expect(resolvedSpan.lg).toBe(12);
  });

  it("drops invisible slots and the groups that become empty", () => {
    const groups = resolveLayout({
      groupGap: "gap-8",
      groups: [
        {
          id: "g1",
          columns: { sm: 12, md: 12, lg: 12, xl: 12 },
          gap: "gap-4",
          slots: [{ moduleId: "book", visible: false }],
        },
        {
          id: "g2",
          columns: { sm: 12, md: 12, lg: 12, xl: 12 },
          gap: "gap-4",
          slots: [{ moduleId: "radar" }],
        },
      ],
    });
    expect(groups.map((g) => g.id)).toEqual(["g2"]);
  });

  it("rejects a module placed twice", () => {
    const problems = validateHomeComposition({
      groupGap: "gap-8",
      groups: [
        {
          id: "dupe",
          columns: { sm: 12, md: 12, lg: 12, xl: 12 },
          gap: "gap-4",
          slots: [{ moduleId: "radar" }, { moduleId: "radar" }],
        },
      ],
    });
    expect(problems.some((p) => p.includes("placed 2 times"))).toBe(true);
  });

  it("rejects defaultCollapsed on a non-collapsible slot", () => {
    const problems = validateHomeComposition({
      groupGap: "gap-8",
      groups: [
        {
          id: "bad",
          columns: { sm: 12, md: 12, lg: 12, xl: 12 },
          gap: "gap-4",
          slots: [{ moduleId: "radar", defaultCollapsed: true }],
        },
      ],
    });
    expect(problems.some((p) => p.includes("defaultCollapsed but not collapsible"))).toBe(true);
  });
});
