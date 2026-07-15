"use client";

/**
 * The layout renderer. Walks the layout config and places modules.
 *
 * This is the *only* file that knows how a module's declared 12-column span
 * becomes CSS. Modules don't, the registry doesn't, and the page doesn't — so
 * Phase 2 can move the whole homepage to a masonry, a dashboard grid, or
 * anything else by rewriting this one file.
 *
 * The span classes are written out longhand because Tailwind resolves class
 * names statically: a template literal like `col-span-${n}` produces no CSS.
 * The map is the price of keeping spans data-driven, and it is checked against
 * the layout by validateHomeComposition().
 */

import type { Breakpoint } from "@/lib/home/types";
import { resolveLayout, resolveSlot, type HomeLayoutConfig } from "@/lib/home/layout";
import { HOME_MODULES } from "./module-map";

/** span → the Tailwind class at each breakpoint. Static strings only. */
const SPAN: Record<Breakpoint, Record<number, string>> = {
  sm: {
    1: "col-span-1", 2: "col-span-2", 3: "col-span-3", 4: "col-span-4",
    5: "col-span-5", 6: "col-span-6", 7: "col-span-7", 8: "col-span-8",
    9: "col-span-9", 10: "col-span-10", 11: "col-span-11", 12: "col-span-12",
  },
  md: {
    1: "md:col-span-1", 2: "md:col-span-2", 3: "md:col-span-3", 4: "md:col-span-4",
    5: "md:col-span-5", 6: "md:col-span-6", 7: "md:col-span-7", 8: "md:col-span-8",
    9: "md:col-span-9", 10: "md:col-span-10", 11: "md:col-span-11", 12: "md:col-span-12",
  },
  lg: {
    1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3", 4: "lg:col-span-4",
    5: "lg:col-span-5", 6: "lg:col-span-6", 7: "lg:col-span-7", 8: "lg:col-span-8",
    9: "lg:col-span-9", 10: "lg:col-span-10", 11: "lg:col-span-11", 12: "lg:col-span-12",
  },
  xl: {
    1: "xl:col-span-1", 2: "xl:col-span-2", 3: "xl:col-span-3", 4: "xl:col-span-4",
    5: "xl:col-span-5", 6: "xl:col-span-6", 7: "xl:col-span-7", 8: "xl:col-span-8",
    9: "xl:col-span-9", 10: "xl:col-span-10", 11: "xl:col-span-11", 12: "xl:col-span-12",
  },
};

function spanClasses(span: Record<Breakpoint, number>): string {
  return [SPAN.sm[span.sm], SPAN.md[span.md], SPAN.lg[span.lg], SPAN.xl[span.xl]]
    .filter(Boolean)
    .join(" ");
}

export function ModuleGrid({ config }: { config?: HomeLayoutConfig }) {
  const groups = resolveLayout(config);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.id} className="flex flex-col gap-3">
          {group.label ? (
            <div className="flex flex-col gap-0.5">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted/60">{group.label}</h2>
              {group.description ? <p className="text-xs text-muted">{group.description}</p> : null}
            </div>
          ) : null}

          <div className={`grid grid-cols-12 ${group.gap}`}>
            {group.slots.map((slot) => {
              const resolved = resolveSlot(slot);
              const Module = HOME_MODULES[slot.moduleId];

              return (
                <div key={slot.moduleId} className={spanClasses(resolved.resolvedSpan)}>
                  <Module
                    collapsible={slot.collapsible}
                    defaultCollapsed={slot.defaultCollapsed}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
