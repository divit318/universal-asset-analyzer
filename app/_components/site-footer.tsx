"use client";

import { usePathname } from "next/navigation";
import { BrandMark } from "./brand";

/**
 * The app's baseline — one hairline row at the bottom of every authenticated
 * page: the mark, the product's full name, and what it is.
 *
 * The app previously had no footer at all, which is why the product's real name
 * appeared nowhere inside it: the header shows the "asset/analyzer" wordmark and
 * page titles name the tool ("Universal Screener", "Today"), so a user who
 * scrolled past the header had no signature on screen. This is the cheapest
 * possible fix — a single 13px line, no links, no columns, no newsletter — and
 * it doubles as the local-first data statement that is the product's whole
 * premise — phrased to stay true with hosted AI narration (the audit's F-01).
 *
 * Deliberately NOT a lockup: the header already owns the one lockup per view,
 * and repeating the wordmark 40px below a data table is exactly the repetitive,
 * intrusive branding this is meant to avoid.
 */
export function SiteFooter() {
  const pathname = usePathname();

  // Same migration seam as SiteHeader: /landing ships its own (much richer)
  // footer and must not stack two.
  if (pathname === "/landing" || pathname.startsWith("/landing/")) return null;

  return (
    <footer className="mt-auto border-t border-border bg-surface/40">
      <div className="mx-auto flex w-full max-w-[1920px] flex-wrap items-center gap-x-3 gap-y-1 px-6 py-4">
        <BrandMark size="xs" className="text-muted" />
        <span className="text-micro font-medium text-muted">Universal Asset Analyzer</span>
        <span aria-hidden="true" className="text-micro text-border-strong">
          ·
        </span>
        <span className="text-micro text-faint">
          Your data lives in a local database. AI narration uses your Anthropic key.
        </span>
      </div>
    </footer>
  );
}
