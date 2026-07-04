import type { OpportunityCategory, VolatilityTier } from "@/lib/opportunity-engine";

/** One color per category, cycling through the app's shared chart palette (app/globals.css). */
export const CATEGORY_COLOR: Record<OpportunityCategory, string> = {
  high_conviction: "var(--accent)",
  portfolio_improver: "var(--chart-5)",
  value: "var(--chart-1)",
  growth: "var(--positive)",
  quality_compounder: "var(--chart-3)",
  momentum_leader: "var(--chart-2)",
  emerging_theme: "var(--chart-4)",
  sector_rotation: "var(--chart-1)",
  defensive: "var(--muted)",
  dividend: "var(--warning)",
};

/** Border color encodes risk tier — low risk reads as calm, high risk as alert. */
export const RISK_BORDER_COLOR: Record<VolatilityTier, string> = {
  Low: "var(--positive)",
  Medium: "var(--warning)",
  High: "var(--negative)",
};
