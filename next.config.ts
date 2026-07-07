import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["exceljs", "pdfkit"],
  // Tree-shake barrel imports from heavy client libs so a page only ships the
  // icons/chart pieces it actually uses instead of the whole package.
  experimental: {
    optimizePackageImports: [
      "recharts",
      "framer-motion",
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
};

export default nextConfig;
