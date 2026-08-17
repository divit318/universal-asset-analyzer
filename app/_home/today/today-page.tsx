"use client";

/**
 * The Today page — "The Morning Ledger" (approved prototype, 2026-08-15).
 *
 * One editorial column: STATE → VERDICT → SIGNALS → WEEK → BOOK → MARKETS,
 * separated by hairlines, with a section rail on wide screens and a 2px
 * brass reading thread along the viewport top. The digest paints the page
 * (one request, via HomeProvider); the AI verdict streams in behind it and
 * never blocks the render.
 *
 * The masthead paints immediately; the sections below arrive with the
 * shared reveal grammar as the reader reaches them (skipped for deep links
 * and reduced motion — a settled page, not a theater cue they scrolled
 * past).
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { prefersReducedMotion } from "@/app/_components/motion";
import { SymbolLinkRoot } from "../_atmosphere/symbol-link";
import { useHome } from "../home-provider";
import { BookSection } from "./book-section";
import { Masthead } from "./masthead";
import { Markets } from "./markets";
import { Signals } from "./signals";
import { Verdict } from "./verdict";
import { Week } from "./week";

const RAIL: { id: string; label: string }[] = [
  { id: "tdy-state", label: "State" },
  { id: "tdy-verdict", label: "Verdict" },
  { id: "tdy-signals", label: "Signals" },
  { id: "tdy-week", label: "Week" },
  { id: "tdy-book", label: "Book" },
  { id: "tdy-markets", label: "Markets" },
];

/**
 * The section rail — the page's one scroll instrument. A hairline spine
 * fills with brass as the reader descends (rAF-gated transform, nothing
 * else animates), and the diamond of the section under the reading line
 * lights. Wide screens only; it never competes with the content.
 */
function SectionRail() {
  const [active, setActive] = useState<string>(RAIL[0].id);
  // The portal TARGET is state, captured in an effect — never `document.body`
  // read during render. Reading it at render time crashed the whole page
  // ("Target container is not a DOM element", caught by app/error.tsx) when a
  // dev full-refresh replaced <body> between render and commit: the portal
  // held a detached node, React threw while mounting it, and the error
  // boundary swapped the page out — the visible symptom being action items
  // that painted but no longer responded to clicks. Holding the LIVE body in
  // state makes the portal target's liveness part of React's own dataflow.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const fillRef = useRef<HTMLSpanElement | null>(null);

  // Rendered through a portal: the app shell's route-arrival animation keeps
  // a transform applied (fill-mode: both), which silently turns any inner
  // `position: fixed` into "fixed inside the content" — the rail then sits
  // mid-document and scrolls with the page. document.body has no transform,
  // so the rail is genuinely viewport-fixed there.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setPortalTarget(document.body));
    return () => cancelAnimationFrame(raf);
  }, []);

  const mounted = portalTarget != null && portalTarget.isConnected;

  useEffect(() => {
    if (!mounted) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-32% 0px -58% 0px" },
    );
    for (const { id } of RAIL) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }

    let queued = false;
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (fillRef.current) {
          fillRef.current.style.transform = `scaleY(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
        }
        queued = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      obs.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <nav
      aria-label="Today sections"
      data-testid="tdy-rail"
      className="fixed left-6 top-1/2 z-40 hidden -translate-y-1/2 min-[1420px]:block"
    >
      <div className="relative flex flex-col gap-4 py-1 pl-4">
        {/* The spine: track + scroll-linked brass fill. */}
        <span aria-hidden="true" className="absolute bottom-1 left-[2px] top-1 w-px bg-surface-3" />
        <span
          ref={fillRef}
          aria-hidden="true"
          className="absolute bottom-1 left-[2px] top-1 w-px origin-top bg-brand"
          style={{ transform: "scaleY(0)" }}
        />
        {RAIL.map(({ id, label }) => {
          const isActive = active === id;
          return (
            <a
              key={id}
              href={`#${id}`}
              aria-current={isActive ? "true" : undefined}
              className={`group relative flex items-center gap-2.5 font-mono text-[9px] uppercase tracking-[0.2em] transition-colors duration-(--duration-base) ${
                isActive ? "text-brand" : "text-faint hover:text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute -left-[16.5px] h-[5px] w-[5px] flex-none rotate-45 transition-[background-color,border-color,box-shadow] duration-(--duration-base) ${
                  isActive
                    ? "border border-brand bg-brand shadow-[0_0_8px_color-mix(in_srgb,var(--brand)_40%,transparent)]"
                    : "border border-faint bg-transparent group-hover:border-muted"
                }`}
              />
              {label}
            </a>
          );
        })}
      </div>
    </nav>,
    document.body,
  );
}

export function TodayPage() {
  const { digest } = useHome();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Below-fold sections arrive with the reveal grammar as the reader reaches
  // them. Deep links and reduced motion get the settled page instantly.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-tdy-reveal]"));
    for (const t of targets) t.classList.add("tdy-reveal");
    if (prefersReducedMotion() || window.location.hash.length > 1 || typeof IntersectionObserver === "undefined") {
      for (const t of targets) t.classList.add("is-in");
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("is-in");
          obs.unobserve(e.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    for (const t of targets) obs.observe(t);
    return () => obs.disconnect();
  }, []);

  const generatedTime = digest.data
    ? new Date(digest.data.generatedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : null;

  return (
    <SymbolLinkRoot className="relative flex flex-1 flex-col overflow-x-clip">
      <SectionRail />
      <div ref={rootRef} className="flex flex-1 flex-col">
        <Masthead />
        <div data-tdy-reveal>
          <Verdict />
        </div>
        <div data-tdy-reveal>
          <Signals />
        </div>
        <div data-tdy-reveal>
          <Week />
        </div>
        <div data-tdy-reveal>
          <BookSection />
        </div>
        <div data-tdy-reveal>
          <Markets />
        </div>

        {/* The seal — the product's thesis, closing the ledger. */}
        <div className="border-t border-hairline">
          <div className="tdy-shell flex flex-wrap items-center justify-between gap-3 py-7">
            <p className="flex items-center gap-3 font-serif text-sm text-muted">
              <span className="tdy-eyebrow-diamond" aria-hidden="true" />
              Every figure computed. Every claim traced.
            </p>
            <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-faint tabular-nums">
              Generated locally{generatedTime ? ` · ${generatedTime}` : ""} · your database, your keys
            </p>
          </div>
        </div>
      </div>
    </SymbolLinkRoot>
  );
}
