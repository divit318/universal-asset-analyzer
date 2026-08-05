import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "pdfkit"],
  // Dev-only: allow the browser-preview proxy (served from 127.0.0.1) to load
  // Next.js dev resources (HMR, RSC payloads) cross-origin.
  allowedDevOrigins: ["127.0.0.1"],
  // Tree-shake barrel imports from heavy client libs so a page only ships the
  // icons/chart pieces it actually uses instead of the whole package.
  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "d3-force",
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
    ];
  },
};

export default nextConfig;
