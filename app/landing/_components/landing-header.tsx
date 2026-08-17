"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "@/app/_components/brand";
import { ThemeToggle } from "@/app/_components/theme";
import { Drawer } from "@/app/_components/dialog";
import { APP_ENTRY, LANDING_HOME, NAV_SECTIONS, PRIMARY_ACTION } from "../landing-config";
import { AuthModalHost, openAuthModal } from "./auth-modal";
import { useScrollVelocity } from "./motion/hooks";

/**
 * The marketing nav — a full-width hairline bar that is almost not there.
 * At the top of the page it is pure typography on the plate: lockup on the
 * content axis, thin anchor links, a ghost "Sign in", and the one machined
 * CTA. Past 100px a warm veil (background at 4/5 opacity + blur) and a
 * bottom hairline arrive over 200ms so the bar reads as chrome only once
 * there is content to protect. No pill, no card, no rounded chrome — the
 * nav must lose every fight for attention with the hero behind it.
 *
 * Behavior is unchanged from the pill era: the scrolled state still keys
 * off the shared rAF loop, active-section highlighting still runs on ONE
 * IntersectionObserver, the single brass indicator still slides between
 * links (now along the bar's bottom edge, like an instrument index), and
 * mobile still collapses to lockup + hamburger opening the full-screen
 * Drawer (focus trap / Escape / scroll lock intact).
 */
export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const linksRef = useRef<HTMLDivElement | null>(null);
  const underlineRef = useRef<HTMLSpanElement | null>(null);

  // Pill scroll state rides the ONE shared rAF loop (3.4) — no extra
  // scroll listener. setState only fires on threshold crossings.
  const scrolledRef = useRef(false);
  useScrollVelocity((s) => {
    const past = s.scrollY > 100;
    if (past !== scrolledRef.current) {
      scrolledRef.current = past;
      setScrolled(past);
    }
  });

  // Slide the single underline to the active link (transform-only).
  useEffect(() => {
    const links = linksRef.current;
    const underline = underlineRef.current;
    if (!links || !underline) return;
    const activeEl = active ? links.querySelector<HTMLAnchorElement>(`a[href="#${active}"]`) : null;
    if (!activeEl) {
      underline.style.opacity = "0";
      return;
    }
    const lr = links.getBoundingClientRect();
    const ar = activeEl.getBoundingClientRect();
    underline.style.opacity = "1";
    underline.style.transform = `translateX(${ar.left - lr.left + 12}px) scaleX(${(ar.width - 24) / 100})`;
  }, [active]);

  useEffect(() => {
    const targets = NAV_SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (targets.length === 0) return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // The first IA-ordered section currently on screen wins.
        const current = NAV_SECTIONS.find((s) => visible.has(s.id));
        setActive(current ? current.id : null);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: 0 },
    );
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <nav
        aria-label="Primary"
        className={`w-full border-b transition-[background-color,border-color,box-shadow,backdrop-filter] duration-[200ms] ${
          scrolled ? "border-hairline bg-background/85 shadow-popover backdrop-blur-md" : "border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-measure-content items-center gap-5 px-mk-pad">
          <BrandLockup href={LANDING_HOME} size="md" className="shrink-0" />

          {/* A thin rule separates the mark from the instrument's index. */}
          <span aria-hidden="true" className="hidden h-4 w-px bg-border-strong/70 lg:block" />

          {/* Anchor nav derived from the IA registry, with the active
              section highlighted. lg, not md: six links + auth pair need
              ~900px. The container spans the bar's full height so the ONE
              sliding indicator rides its bottom edge. */}
          <div ref={linksRef} className="relative hidden h-full flex-1 items-center justify-center gap-1 lg:flex">
            <span
              ref={underlineRef}
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-px w-[100px] origin-left bg-brand opacity-0 transition-[transform,opacity] duration-[200ms] motion-reduce:transition-none"
            />
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                aria-current={active === s.id ? "true" : undefined}
                className={`px-3 py-1.5 text-[13px] font-medium tracking-[0.01em] outline-none transition-colors duration-[200ms] focus-visible:ring-2 focus-visible:ring-brand/40 ${
                  active === s.id ? "text-brand" : "text-muted hover:text-foreground"
                }`}
              >
                {s.nav}
              </a>
            ))}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => openAuthModal("signin")}
              className="hidden px-2.5 py-1.5 text-[13px] font-medium text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 sm:inline-flex"
            >
              Sign in
            </button>
            {/* prefetch={false}: see hero.tsx — no speculative app-shell load,
                and no cached gate redirect poisoning post-sign-in navigation. */}
            <Link
              href={APP_ENTRY}
              prefetch={false}
              className="mk-btn mk-btn-primary group hidden h-9 gap-1.5 px-4 text-[13px] sm:inline-flex"
            >
              {PRIMARY_ACTION}
              <span aria-hidden="true" className="transition-transform duration-[200ms] group-hover:translate-x-[3px] motion-reduce:transition-none">
                →
              </span>
            </Link>

            {/* Mobile/tablet menu toggle */}
            <button
              type="button"
              className="p-1.5 text-muted outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              aria-haspopup="dialog"
            >
              <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      {/* Full-screen mobile overlay — the shared Drawer primitive stretched to
          the viewport: focus-trapped, Escape closes, background scroll locked. */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} label="Menu" className="max-w-full">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <BrandLockup href={LANDING_HOME} size="md" />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-control p-1.5 text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Menu" id="landing-mobile-nav" className="flex flex-col gap-1 px-3 py-4">
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setMobileOpen(false)}
              className="rounded-control px-3 py-3 text-mk-lead font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {s.nav}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border px-5 py-5">
          <button
            type="button"
            onClick={() => { setMobileOpen(false); openAuthModal("signin"); }}
            className="inline-flex h-11 items-center justify-center rounded-control border border-border bg-surface text-sm font-semibold text-foreground outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Sign in
          </button>
          <Link
            href={APP_ENTRY}
            prefetch={false}
            onClick={() => setMobileOpen(false)}
            className="inline-flex h-11 items-center justify-center rounded-control bg-brand text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            {PRIMARY_ACTION}
          </Link>
        </div>
      </Drawer>

      <AuthModalHost />
    </header>
  );
}
