"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { BrandLockup } from "@/app/_components/brand";
import { ThemeToggle } from "@/app/_components/theme";
import { Drawer } from "@/app/_components/dialog";
import { LANDING_HOME, NAV_SECTIONS } from "../landing-config";
import { AuthModalHost, openAuthModal } from "./auth-modal";

/**
 * The marketing site's navigation — a floating pill bar, centred and fixed,
 * that gains its shadow/blur only once the hero has scrolled past (a bar that
 * casts a shadow while there is nothing under it reads as a mistake).
 *
 * Right cluster is the auth entry: ghost "Sign in" opens the modal on the
 * Sign in tab, filled "Get started" on Create account. The modal host lives
 * here (this header is on every landing view); the hero's CTA reaches it via
 * openAuthModal() — see auth-modal.tsx for why that seam is event-based.
 *
 * Mobile: the pill collapses to lockup + hamburger; the menu is the shared
 * Drawer primitive, which brings the focus trap, Escape-to-close and scroll
 * lock with it.
 *
 * Reuses the existing ThemeToggle so dark/light continues to work through the
 * repo's [data-theme] mechanism with no new theming system.
 */
export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pastHero, setPastHero] = useState(false);

  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) {
      // No hero on this view — treat any scroll as "past it".
      const onScroll = () => setPastHero(window.scrollY > 8);
      onScroll();
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    const io = new IntersectionObserver(
      ([entry]) => setPastHero(!entry.isIntersecting),
      // Fire once the hero's bottom clears the pill, not the viewport bottom.
      { rootMargin: "-72px 0px 0px 0px", threshold: 0 },
    );
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  const linkClass =
    "rounded-full px-3 py-1.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40";

  return (
    <header className="fixed inset-x-0 top-3 z-40 px-3 sm:top-4">
      <nav
        aria-label="Primary"
        className={`mx-auto flex h-12 w-full max-w-3xl items-center gap-1 rounded-full border px-2.5 transition-all duration-[280ms] lg:max-w-4xl ${
          pastHero
            ? "border-border bg-surface/85 shadow-popover backdrop-blur-xl"
            : "border-transparent bg-surface/60 backdrop-blur-md"
        }`}
      >
        <BrandLockup href={LANDING_HOME} size="md" className="ml-1 mr-2 shrink-0" />

        {/* Centre: anchor nav derived from the IA registry. lg, not md: with
            six links plus the auth pair the pill needs ~900px, and at tablet
            widths the overflow pushed the CTAs past the viewport edge
            (measured 74px of horizontal scroll at 768). */}
        <div className="hidden flex-1 items-center justify-center gap-0.5 lg:flex">
          {NAV_SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} className={linkClass}>
              {s.nav}
            </a>
          ))}
        </div>

        {/* Right cluster: theme, then the auth pair */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => openAuthModal("signin")}
            className="hidden rounded-full px-3 py-1.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 sm:inline-flex"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => openAuthModal("signup")}
            className="hidden rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40 sm:inline-flex"
          >
            Get started
          </button>

          {/* Mobile/tablet menu toggle */}
          <button
            type="button"
            className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            aria-haspopup="dialog"
          >
            <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </nav>

      {/* Mobile sheet — the shared Drawer primitive: focus-trapped, Escape
          closes, background scroll locked. */}
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} label="Menu" className="max-w-xs">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <BrandLockup href={LANDING_HOME} size="md" />
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>
        </div>
        <nav aria-label="Menu" id="landing-mobile-nav" className="flex flex-col gap-1 px-3 py-4">
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setMobileOpen(false)}
              className="rounded-control px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              {s.nav}
            </a>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-border px-5 py-5">
          <button
            type="button"
            onClick={() => { setMobileOpen(false); openAuthModal("signin"); }}
            className="inline-flex h-10 items-center justify-center rounded-control border border-border bg-surface text-sm font-semibold text-foreground transition-colors hover:bg-surface-2"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMobileOpen(false); openAuthModal("signup"); }}
            className="inline-flex h-10 items-center justify-center rounded-control bg-brand text-sm font-semibold text-background transition-colors hover:bg-brand-strong"
          >
            Get started
          </button>
        </div>
      </Drawer>

      <AuthModalHost />
    </header>
  );
}
