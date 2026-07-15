import type { Metadata } from "next";
import { LandingHeader } from "./_components/landing-header";
import { LandingFooter } from "./_components/landing-footer";

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
const TITLE = "Universal Asset Analyzer — The AI Terminal for Investors";
const DESCRIPTION =
  "Professional investment research, analysis, and portfolio tools — powered by local AI, running entirely on your computer. No cloud, no accounts.";

/**
 * SEO for the marketing surface. All of this is native Next Metadata — plain
 * <meta>/<title> tags, no analytics SDKs, no third-party scripts (reconciliation
 * §I: local-first, keep only the free/native SEO hygiene).
 *
 * Deferred on purpose: an og:image / twitter image (needs a real asset — arrives
 * with the screenshots in Milestone 7) and JSON-LD structured data + sitemap
 * (optional until there's a truly public deploy — reconciliation §I/§A4).
 */
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: [
    "investment research",
    "stock analysis",
    "local AI",
    "stock screener",
    "DCF valuation",
    "portfolio analytics",
  ],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    siteName: "Universal Asset Analyzer",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <LandingHeader />
      {children}
      <LandingFooter />
    </div>
  );
}
