import {
  LayoutDashboard,
  Compass,
  Microscope,
  Briefcase,
  ListFilter,
  Radar,
  Network,
  Waypoints,
  Search,
  GitCompare,
  Calculator,
  FileText,
  Cog,
  History,
  Bookmark,
  NotebookPen,
  CalendarDays,
  type LucideIcon,
} from "lucide-react";

/* ============================================================================
   Information architecture — single source of truth for the header nav AND
   the ⌘K command palette. Top level is organized by USER OBJECTIVE (what you
   are trying to do), not by tool. Every tool is reachable in ≤2 clicks from the
   nav, or instantly from ⌘K.
   ========================================================================== */

export interface NavTool {
  href: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  /** Whether this tool takes a ?symbol= deep-link (used by the palette). */
  symbolParam?: "symbol" | "symbols";
  /** Extra search terms for the command palette. */
  keywords?: string[];
}

export interface NavObjective {
  id: string;
  label: string;
  href: string;
  tagline: string;
  icon: LucideIcon;
  tools: NavTool[];
}

export const NAV: NavObjective[] = [
  {
    id: "today",
    label: "Today",
    href: "/",
    tagline: "Your market & portfolio at a glance",
    icon: LayoutDashboard,
    tools: [],
  },
  {
    id: "discover",
    label: "Discover",
    href: "/screener",
    tagline: "Find your next idea",
    icon: Compass,
    tools: [
      { href: "/screener", label: "Screener", desc: "Filter by fundamentals, scores & AI criteria", icon: ListFilter, keywords: ["filter", "screen", "quant", "fundamental"] },
      { href: "/scanner", label: "Scanner", desc: "Live news & event-driven signals", icon: Radar, keywords: ["news", "events", "signals", "catalysts"] },
      { href: "/thematic", label: "Thematic", desc: "Map a macro theme's supply chain", icon: Network, keywords: ["theme", "supply chain", "macro", "industry"] },
      // Engine + Backtest generate and validate ideas system-wide — a Discover
      // job, not a single-company Research one (§4.3).
      { href: "/engine", label: "Quant Engine", desc: "10-factor systematic scorecard", icon: Cog, keywords: ["quant", "factor", "scorecard", "systematic", "kelly"] },
      { href: "/backtest", label: "Signal Backtest", desc: "Do the engine's signals actually work?", icon: History, keywords: ["backtest", "validation", "efficacy", "signal", "edge", "hit rate"] },
    ],
  },
  {
    id: "research",
    label: "Research",
    href: "/research",
    tagline: "Analyze any company, end to end",
    icon: Microscope,
    tools: [
      { href: "/research", label: "Research Hub", desc: "Quote, charts, filings & AI copilot", icon: Search, symbolParam: "symbol", keywords: ["quote", "chart", "filings", "copilot", "stock", "fund", "etf"] },
      { href: "/compare", label: "Compare", desc: "Up to 5 names side by side", icon: GitCompare, symbolParam: "symbols", keywords: ["versus", "vs", "side by side"] },
      { href: "/dcf", label: "DCF Valuation", desc: "Intrinsic value & sensitivity", icon: Calculator, symbolParam: "symbol", keywords: ["valuation", "intrinsic", "cash flow", "wacc"] },
      { href: "/ic-report", label: "IC Report", desc: "9-agent institutional deep dive", icon: FileText, symbolParam: "symbol", keywords: ["committee", "thesis", "bull", "bear", "deep dive"] },
      // Promoted from two levels deep inside the dissolved /intelligence (§4.3).
      // Its deep-link is scope+id, not a plain ?symbol=, so no symbolParam here.
      { href: "/knowledge-graph", label: "Knowledge Graph", desc: "Explore how your names connect", icon: Waypoints, keywords: ["graph", "network", "relationships", "connections", "map"] },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio",
    href: "/portfolio",
    tagline: "Manage what you own & watch",
    icon: Briefcase,
    tools: [
      { href: "/portfolio", label: "Portfolio", desc: "Holdings, P&L & AI CIO memo", icon: Briefcase, keywords: ["holdings", "pnl", "cio", "positions", "decisions"] },
      { href: "/watchlist", label: "Watchlist", desc: "Track names, alerts & notes", icon: Bookmark, keywords: ["watch", "alerts", "notes", "targets"] },
      { href: "/journal", label: "Decision Journal", desc: "Log calls, measure your track record", icon: NotebookPen, keywords: ["journal", "decisions", "track record", "conviction", "calibration", "hit rate"] },
      { href: "/calendar", label: "Calendar", desc: "Earnings & ex-dividend dates", icon: CalendarDays, keywords: ["earnings", "dividend", "dates", "events"] },
    ],
  },
];

/** Flattened list of every navigable tool (for the command palette). */
export const ALL_TOOLS: (NavTool & { objective: string })[] = NAV.flatMap((o) =>
  o.tools.map((t) => ({ ...t, objective: o.label })),
);

/** Which objective owns a given pathname (for active-state highlighting). */
export function activeObjective(pathname: string): string | null {
  if (pathname === "/") return "today";
  for (const o of NAV) {
    if (o.tools.some((t) => pathname === t.href || pathname.startsWith(t.href + "/"))) {
      return o.id;
    }
  }
  return null;
}
