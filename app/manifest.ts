import type { MetadataRoute } from "next";
import { BRAND_COLORS } from "@/lib/brand/mark";

/**
 * Web app manifest — so installing UAA to a dock, taskbar or iOS home screen
 * produces the real logo and the real name, not a screenshot of the first paint
 * with a stock Next.js icon.
 *
 * `theme_color`/`background_color` come from the same BRAND_COLORS table the
 * generated icons do, which is what keeps the splash screen the OS synthesises
 * from this file the same colour as the app's own boot splash.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Universal Asset Analyzer",
    short_name: "UAA",
    description:
      "Equity research: deep research, DCF modelling, quant screening and portfolio management — your data and every computed figure stay on your own machine.",
    start_url: "/",
    display: "standalone",
    background_color: BRAND_COLORS.dark.background,
    theme_color: BRAND_COLORS.dark.background,
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
      // `maskable` lets Android crop to its own shape without clipping the mark
      // — the 22% inset in markDocument({ padded: true }) is what makes the
      // same file safe in both roles.
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
