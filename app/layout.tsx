import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { SiteFooter } from "./_components/site-footer";
import { SiteHeader } from "./_components/site-header";
import { CommandPalette } from "./_components/command-palette";
import { AppAssistant } from "./_components/ai-assistant";
import { ToastProvider } from "./_components/toast";
import { THEME_INIT_SCRIPT } from "./_components/theme";
import { AppShell } from "./_components/app-shell";
import { IOSProvider } from "@/lib/ios-context";
import { FocusProvider } from "@/lib/focus-context";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* The judgment serif — the brand book's third voice (§4: "The Analyst").
   Source Serif 4 is the free stand-in it names for Tiempos Text. Loaded here
   but applied only through the --font-judgment token (font-serif utility):
   marketing headlines and judgment prose, never chrome or tables. */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Universal Asset Analyzer",
    template: "%s · UAA",
  },
  description:
    "Institutional-grade equity research platform: AI-powered deep research, DCF modelling, quant screening, thematic analysis, and portfolio management — all running locally.",
  applicationName: "Universal Asset Analyzer",
  /*
   * No `icons` key on purpose. Next's file conventions already emit the tab and
   * home-screen icons from app/{favicon.ico,icon.svg,apple-icon.png}, all three
   * generated from the mark's geometry by `node scripts/generate-brand-assets.ts`;
   * declaring them here as well produces duplicate <link rel="icon"> tags whose
   * order decides which one wins. Installed-app icons live in app/manifest.ts.
   *
   * Before this, app/favicon.ico was still the stock Next.js placeholder — the
   * browser tab was the one surface where UAA's branding was not merely weak but
   * someone else's.
   */
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[300] focus:rounded-lg focus:border focus:border-accent focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-accent"
        >
          Skip to main content
        </a>
        <IOSProvider>
          <FocusProvider>
            <ToastProvider>
              <AppShell>
                <SiteHeader />
                <CommandPalette />
                {/* useSearchParams() (for page-context awareness) requires a
                    Suspense boundary — same reason app/{watchlist,research,portfolio}
                    wrap themselves for useArrivalTarget(). */}
                <Suspense fallback={null}>
                  <AppAssistant />
                </Suspense>
                <main id="main-content" className="flex flex-1 flex-col">
                  {children}
                </main>
                <SiteFooter />
              </AppShell>
            </ToastProvider>
          </FocusProvider>
        </IOSProvider>
      </body>
    </html>
  );
}
