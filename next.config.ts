import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "pdfkit"],
  // No floating Next.js dev-tools badge ("N · 1 Issue") in the corner — it
  // reads as product chrome in demos/recordings. Build/type errors still
  // surface through the terminal and the full-screen error overlay.
  devIndicators: false,
  // Dev-only: allow the browser-preview proxy (served from 127.0.0.1) to load
  // Next.js dev resources (HMR, RSC payloads) cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  // Tree-shake barrel imports from heavy client libs so a page only ships the
  // icons/chart pieces it actually uses instead of the whole package.
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
    ],
  },
  // Drop console.* from production client bundles (keep warn/error for triage).
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  // Scanner was renamed to The Wire (app/scanner -> app/wire); keep old links working.
  // The DCF calculator became the Valuation workspace (app/dcf -> app/valuation):
  // it is no longer a calculator but a view onto one persisted ValuationCase, and
  // the Register lives beneath it. Query strings are preserved, so an old
  // /dcf?symbol=AAPL bookmark still lands on that company's case.
  async redirects() {
    return [
      { source: "/scanner", destination: "/wire", permanent: true },
      { source: "/dcf", destination: "/valuation", permanent: true },
      // The Knowledge Graph became Exposure (app/knowledge-graph -> app/exposure).
      // Not a rename: the old page drew companies, sectors, watchlists and news
      // as interchangeable circles, and the new one answers a single question
      // ("what do I actually own, and what moves with it?") from the portfolio
      // ledger. Old links land on the thing that replaced them.
      { source: "/knowledge-graph", destination: "/exposure", permanent: true },
    ];
  },
};

export default nextConfig;
