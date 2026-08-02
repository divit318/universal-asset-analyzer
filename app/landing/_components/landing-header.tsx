"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { BrandLockup } from "@/app/_components/brand";
import { ThemeToggle } from "@/app/_components/theme";
import { LANDING_HOME, APP_ENTRY, NAV_SECTIONS } from "../landing-config";

/**
 * The marketing site's own top navigation — deliberately NOT the authenticated
 * app's SiteHeader (which is suppressed on this subtree; see site-header.tsx).
 * Logo, in-page anchor nav derived from the section registry, and the CTA
 * hierarchy from the Creative Direction: "Experience UAA" (primary) links into
 * the live app; "Watch demo" (secondary) is reinterpreted as a jump to the
 * in-page demo section (no video asset exists yet — see reconciliation §G).
 *
 * Reuses the existing ThemeToggle so dark/light continues to work through the
 * repo's [data-theme] mechanism with no new theming system.
 */
export function LandingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/85 backdrop-blur-xl">
      <nav aria-label="Primary" className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-6">
        {/* Lockup → marketing home (portable: LANDING_HOME becomes "/" post-migration).
            Same component, same size token as the app header, so crossing from
            the marketing site into the product does not change the logo. */}
        <BrandLockup href={LANDING_HOME} size="md" className="mr-4" />

        {/* Desktop anchor nav — generated from the IA registry */}
        <div className="hidden items-center gap-0.5 md:flex">
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-control px-3 py-1.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {s.nav}
            </a>
          ))}
        </div>

        {/* Right cluster: theme toggle + CTAs */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <a
            href="#demo"
            className="hidden rounded-control px-3 py-1.5 text-sm font-medium text-muted outline-none transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand/40 sm:inline-flex"
          >
            Watch demo
          </a>
          <Link
            href={APP_ENTRY}
            className="rounded-control bg-brand px-3.5 py-1.5 text-sm font-semibold text-background outline-none transition-colors hover:bg-brand-strong focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            Experience UAA
          </Link>

          {/* Mobile menu toggle */}
          <button
            className="rounded-control p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground md:hidden"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="landing-mobile-nav"
          >
            {mobileOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown — same anchor set, stacked */}
      {mobileOpen && (
        <div
          id="landing-mobile-nav"
          className="animate-menu-drop overflow-hidden border-t border-border bg-surface md:hidden"
        >
          <div
            className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-4"
            onClick={() => setMobileOpen(false)}
          >
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-control px-2 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {s.nav}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
