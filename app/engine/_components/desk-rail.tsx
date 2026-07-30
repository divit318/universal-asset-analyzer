/**
 * Section rail — the desk's long-page navigator.
 *
 * The engine is one continuous page by design (a desk, not a set of tabs), which
 * makes "where am I and what else is there" a real problem. The rail answers both
 * at once: a fixed column of dots, one per section, that highlights the section
 * currently in view and jumps to any other.
 *
 * It also doubles as a progress indicator. Each dot carries its section's load
 * state, so while the heavier sections are still computing the rail shows exactly
 * which parts of the desk are live and which are still arriving — the reader can
 * see the page filling in rather than guessing.
 *
 * The current section is the last one whose top has passed a probe line near the
 * top of the viewport. That specific rule matters: an IntersectionObserver band
 * gets this wrong on this page, because the scorecard section is tall enough to
 * span the whole viewport and therefore keeps "intersecting" while the reader is
 * well past it into Health or Validation. Comparing section tops to a probe line
 * is the only formulation that stays correct regardless of section height.
 */

"use client";

import { useEffect, useState } from "react";

export type RailState = "loading" | "ready" | "empty" | "error";

export interface RailSection {
  id: string;
  label: string;
  state: RailState;
}

export function DeskRail({ sections }: { sections: RailSection[] }) {
  const [activeId, setActiveId] = useState<string | null>(sections[0]?.id ?? null);

  const ids = sections.map((s) => s.id).join("|");

  useEffect(() => {
    const sectionIds = ids.split("|").filter(Boolean);
    if (sectionIds.length === 0) return;

    let frame = 0;

    function measure() {
      frame = 0;

      // At the bottom of the document, no further scrolling is possible, so the
      // trailing sections can never bring their tops up to the probe. Without this
      // the rail would pin to whichever tall section last crossed it (the
      // scorecard) and the final sections could never be shown as current.
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 24;
      if (atBottom) {
        setActiveId(sectionIds[sectionIds.length - 1]);
        return;
      }

      // A quarter down the viewport: below the sticky header, and high enough that
      // the section under the reader's eye is the one reported.
      const probe = window.innerHeight * 0.25;
      let current = sectionIds[0];
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Last section whose top has crossed the probe wins; if none has (we're at
        // the very top of the page), the first section stays current.
        if (el.getBoundingClientRect().top <= probe) current = id;
      }
      setActiveId(current);
    }

    // rAF-coalesced: scroll fires far more often than the rail needs to update,
    // and eight getBoundingClientRect reads per frame is cheap but not free.
    function onScroll() {
      if (frame === 0) frame = requestAnimationFrame(measure);
    }

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // Keyed on the section id list, not the array reference, so this re-binds when
    // a section mounts or unmounts as its data lands.
  }, [ids]);

  function jump(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label="Desk sections"
      // Hidden below xl: on narrow viewports it would either overlap content or
      // steal horizontal space the tables need.
      className="pointer-events-none fixed left-4 top-1/2 z-30 hidden -translate-y-1/2 xl:block"
    >
      <ul className="pointer-events-auto flex flex-col gap-1">
        {sections.map((s) => {
          const active = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => jump(s.id)}
                aria-current={active ? "true" : undefined}
                className="group flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <span
                  aria-hidden
                  className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                    active ? "w-5 bg-brand" : "w-1.5 bg-border-strong group-hover:bg-muted"
                  } ${s.state === "loading" ? "animate-pulse" : ""}`}
                />
                <span
                  className={`whitespace-nowrap text-label font-medium uppercase tracking-widest transition-[opacity,color] duration-200 ${
                    active
                      ? "text-foreground opacity-100"
                      : "text-muted opacity-0 group-hover:opacity-100"
                  }`}
                >
                  {s.label}
                  {s.state === "error" && <span className="ml-1 text-negative">!</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
