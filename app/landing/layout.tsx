import type { Metadata } from "next";
import { LandingHeader } from "./_components/landing-header";
import { LandingFooter } from "./_components/landing-footer";
import { InkField } from "./_components/ink/InkField";

/**
 * The marketing shell. Wraps every /landing route in its own header + footer,
 * distinct from the authenticated app chrome (which is suppressed on this
 * subtree — see app/_components/site-header.tsx).
 *
 * Note: the root layout already provides <html>/<body>, the fonts, the theme
 * script, and the single <main> landmark, so this layout adds only the
 * marketing chrome — it does not re-declare those. When /landing is promoted to
 * the site root, this shell moves with it unchanged.
 */
const TITLE = "Universal Asset Analyzer: The AI Terminal for Investors";
const DESCRIPTION =
  "Investment research, analysis, and portfolio tools with your data in a local database you own, and AI narration on your own Anthropic key.";

/**
 * SEO for the marketing surface. All of this is native Next Metadata — plain
 * <meta>/<title> tags, no analytics SDKs, no third-party scripts (reconciliation
 * §I: local-first, keep only the free/native SEO hygiene).
 *
 * The og:image is a real capture of the settled hero (public/landing/og.png,
 * 1200x630) so link previews carry the actual design. Still deferred: JSON-LD
 * structured data + sitemap (optional until there's a truly public deploy).
 */
export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "investment research",
    "stock analysis",
    "local-first",
    "stock screener",
    "DCF valuation",
    "portfolio analytics",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Universal Asset Analyzer",
    images: [{ url: "/landing/og.png", width: 1200, height: 630, alt: "Universal Asset Analyzer: every figure computed, every claim traced." }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/landing/og.png"],
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-mk-root className="flex flex-1 flex-col">
      <InkField />
      <LandingHeader />
      {children}
      <LandingFooter />
    </div>
  );
}
