import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: {
    default: "Universal Asset Analyzer",
    template: "%s · UAA",
  },
  description:
    "Institutional-grade equity research platform: AI-powered deep research, DCF modelling, quant screening, thematic analysis, and portfolio management — all running locally.",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
              </AppShell>
            </ToastProvider>
          </FocusProvider>
        </IOSProvider>
      </body>
    </html>
  );
}
