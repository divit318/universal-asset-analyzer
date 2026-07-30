export type BootContext =
  | "home"
  | "research"
  | "compare"
  | "wire"
  | "portfolio"
  | "ic-report"
  | "valuation"
  | "engine"
  | "generic";

/** Status lines shown under the boot splash mark, ordered from "just started"
 * to "nearly there." The splash advances through these on a timer and holds
 * on the last one if data isn't ready yet — it never loops back to the start. */
export const BOOT_MESSAGES: Record<BootContext, string[]> = {
  generic: [
    "Connecting market feeds",
    "Loading financial statements",
    "Reading SEC filings",
    "Analyzing fundamentals",
    "Ranking opportunities",
    "Synthesizing evidence",
    "Comparing historical performance",
    "Building institutional research",
    "Preparing insights",
    "Generating conviction",
    "Finalizing intelligence",
  ],
  home: [
    "Connecting market feeds",
    "Loading financial statements",
    "Ranking opportunities",
    "Synthesizing evidence",
    "Preparing insights",
    "Finalizing intelligence",
  ],
  research: [
    "Reading filings",
    "Loading earnings history",
    "Building research workspace",
  ],
  compare: [
    "Loading historical prices",
    "Normalizing financial metrics",
    "Comparing valuation models",
    "Ranking assets",
  ],
  wire: [
    "Scanning global markets",
    "Detecting emerging themes",
    "Building market narrative",
    "Mapping cause and effect",
  ],
  portfolio: [
    "Loading holdings",
    "Calculating exposure",
    "Updating portfolio intelligence",
  ],
  "ic-report": [
    "Reading filings",
    "Consulting AI analysts",
    "Generating institutional report",
    "Synthesizing viewpoints",
  ],
  valuation: [
    "Opening your valuation case",
    "Solving what the price implies",
    "Discounting cash flows",
    "Running sensitivity analysis",
  ],
  // Market-wide rather than per-company, matching what the desk actually does.
  engine: [
    "Reading the market brief",
    "Detecting market regime",
    "Weighting factors by predictive power",
    "Ranking conviction",
  ],
};
