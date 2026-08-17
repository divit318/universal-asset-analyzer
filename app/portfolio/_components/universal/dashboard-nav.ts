/**
 * The Portfolio page's tab vocabulary, shared between the page (which renders
 * the tab bar and owns the active-tab state) and the dashboard components that
 * navigate INTO a tab (the key-facts strip, concentration finding actions,
 * health improvement links). One definition, so a component can never link to a
 * tab id the page does not recognise.
 *
 * Ordered by where the tab sits in the user's loop: establish the current state,
 * then analyse it, then act on it, then explore hypotheticals. Reading the bar
 * left to right is the same journey as working the portfolio top to bottom.
 */

import type { TabItem } from "@/app/_components/ui";

export type Tab =
  | "dashboard"
  | "holdings"
  | "performance"
  | "risk"
  | "intelligence"
  | "decisions"
  | "optimize"
  | "simulator";

export const TABS: TabItem<Tab>[] = [
  { id: "dashboard",   label: "Dashboard"   },
  { id: "holdings",    label: "Holdings"    },
  // Money-weighted return and the benchmark comparison. The engine behind this
  // (lib/portfolio-performance.ts, /api/portfolio/performance) was fully built
  // and tested but had no caller on this page, so the Portfolio could not answer
  // "am I beating the market?" or "what is my annualized return?" at all.
  { id: "performance", label: "Performance" },
  { id: "risk",        label: "Risk Lab"    },
  // The portfolio critic: what the wrappers hide (look-through concentration,
  // fund overlap), what the ticker count overstates (correlated clusters), and
  // what the trading pattern may indicate. Sits between analysis (Risk Lab) and
  // action (Decisions) because its findings are exactly what should be in hand
  // before deciding anything.
  { id: "intelligence", label: "Intelligence" },
  { id: "decisions",   label: "Decisions"   },
  // The Idea Pipeline tab moved to the Watchlist (2026-08): unowned ideas are
  // watchlist state, and two surfaces over one table answered the same
  // question differently. `?tab=pipeline` deep links redirect there.
  { id: "optimize",    label: "Optimize"    },
  { id: "simulator",   label: "Simulator"   },
];

export const TAB_IDS: string[] = TABS.map((t) => t.id);
